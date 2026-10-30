import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAdapter } from "../src/adapters/mock-adapter.js";
import { MediaPoolManager } from "../src/media-pool/media-pool-manager.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("MediaPoolManager initializes 6-slot slides pool and 18-slot graphics pool", () => {
  const mock = new MockAdapter();
  const manager = new MediaPoolManager(mock);

  const cfg = manager.getConfig();
  assert.equal(cfg.totalSlots, 24);
  assert.equal(cfg.slides.startSlot, 1);
  assert.equal(cfg.slides.endSlot, 6);
  assert.equal(cfg.slides.count, 6);
  assert.equal(cfg.graphics.startSlot, 7);
  assert.equal(cfg.graphics.endSlot, 24);
  assert.equal(cfg.graphics.count, 18);

  const slideSlots = manager.getSlots("slides");
  assert.equal(slideSlots.length, 6);
  assert.equal(slideSlots[0]?.slot, 1);
  assert.equal(slideSlots[5]?.slot, 6);

  const graphicsSlots = manager.getSlots("graphics");
  assert.equal(graphicsSlots.length, 18);
  assert.equal(graphicsSlots[0]?.slot, 7);
  assert.equal(graphicsSlots[17]?.slot, 24);
});

test("MediaPoolManager circular slide buffer advances and clears stale (N - 2) slot", async () => {
  const mock = new MockAdapter();
  const manager = new MediaPoolManager(mock);

  // Initial state: slot 1 active, sequence 1
  assert.equal(manager.getSlideBufferState().activeSlot, 1);
  assert.equal(manager.getSlideBufferState().sequence, 1);

  // Step 1: Advance to Slot 2 (seq 2). Not yet progressed +2, so no deletion
  const step1 = await manager.advanceSlide();
  assert.equal(step1.activeSlot, 2);
  assert.equal(step1.sequence, 2);
  assert.equal(step1.clearedSlot, null);
  assert.equal(mock.mediaPlayers.get(1)?.stillSlot, 2);

  // Step 2: Advance to Slot 3 (seq 3). Progressed +2 from slot 1 -> slot 1 deleted!
  const step2 = await manager.advanceSlide();
  assert.equal(step2.activeSlot, 3);
  assert.equal(step2.sequence, 3);
  assert.equal(step2.clearedSlot, 1);
  assert.equal(mock.mediaPlayers.get(1)?.stillSlot, 3);

  // Step 3: Advance to Slot 4 (seq 4). Slot 2 deleted!
  const step3 = await manager.advanceSlide();
  assert.equal(step3.activeSlot, 4);
  assert.equal(step3.sequence, 4);
  assert.equal(step3.clearedSlot, 2);

  // Step 4: Advance to Slot 5 (seq 5). Slot 3 deleted!
  const step4 = await manager.advanceSlide();
  assert.equal(step4.activeSlot, 5);
  assert.equal(step4.clearedSlot, 3);

  // Step 5: Advance to Slot 6 (seq 6). Slot 4 deleted!
  const step5 = await manager.advanceSlide();
  assert.equal(step5.activeSlot, 6);
  assert.equal(step5.clearedSlot, 4);

  // Step 6: Wraps around to Slot 1 (seq 7). Slot 5 deleted!
  const step6 = await manager.advanceSlide();
  assert.equal(step6.activeSlot, 1);
  assert.equal(step6.clearedSlot, 5);

  // Step 7: Wraps around to Slot 2 (seq 8). Slot 6 deleted!
  const step7 = await manager.advanceSlide();
  assert.equal(step7.activeSlot, 2);
  assert.equal(step7.clearedSlot, 6);
});

test("MediaPoolManager uploads and clears stills in graphics slots", async () => {
  const mock = new MockAdapter();
  const manager = new MediaPoolManager(mock);

  const fakeRgba = Buffer.alloc(100, 0xaa);
  const slot7 = await manager.uploadStill(7, fakeRgba, "pastor-name-strap");

  assert.equal(slot7.slot, 7);
  assert.equal(slot7.pool, "graphics");
  assert.equal(slot7.isUsed, true);
  assert.equal(slot7.name, "pastor-name-strap");
  assert.equal(mock.uploadedStills.get(6)?.name, "pastor-name-strap"); // 0-based in mock

  // Set Media Player 2 to slot 7
  await manager.setMediaPlayerSource(2, 7);
  assert.equal(mock.mediaPlayers.get(2)?.stillSlot, 7);

  // Clear slot 7
  const cleared = await manager.clearSlot(7);
  assert.equal(cleared.isUsed, false);
  assert.equal(mock.uploadedStills.has(6), false);
});

test("REST API routes for media pool and media players", async () => {
  const config = loadConfig({ BACKEND: "mock", PISWITCH_PORT: "0" });
  const mock = new MockAdapter();
  const { app } = buildApp(config, mock);

  // 1. GET /api/v1/video-mixer/media-pool
  const res1 = await app.inject({
    method: "GET",
    url: "/api/v1/video-mixer/media-pool",
  });
  assert.equal(res1.statusCode, 200);
  const data1 = JSON.parse(res1.body);
  assert.equal(data1.config.slides.count, 6);
  assert.equal(data1.config.graphics.count, 18);
  assert.equal(data1.slideBuffer.activeSlot, 1);

  // 2. PUT upload still to graphics slot 8
  const fakeData = Buffer.alloc(50, 0xbb);
  const resUpload = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/media-pool/slots/8?name=scripture-reading",
    headers: { "content-type": "application/octet-stream" },
    payload: fakeData,
  });
  assert.equal(resUpload.statusCode, 200);
  const uploadData = JSON.parse(resUpload.body);
  assert.equal(uploadData.slot, 8);
  assert.equal(uploadData.pool, "graphics");

  // 3. PUT set media player 2 to slot 8
  const resPlayer = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/media-players/2/source",
    payload: { slot: 8 },
  });
  assert.equal(resPlayer.statusCode, 200);
  const playerData = JSON.parse(resPlayer.body);
  assert.equal(playerData.player, 2);
  assert.equal(playerData.stillSlot, 8);

  // 4. POST advance slide
  const resAdvance = await app.inject({
    method: "POST",
    url: "/api/v1/video-mixer/media-pool/slides/advance",
  });
  assert.equal(resAdvance.statusCode, 200);
  const advData = JSON.parse(resAdvance.body);
  assert.equal(advData.activeSlot, 2);
  assert.equal(advData.sequence, 2);

  // 5. DELETE clear slot 8
  const resDelete = await app.inject({
    method: "DELETE",
    url: "/api/v1/video-mixer/media-pool/slots/8",
  });
  assert.equal(resDelete.statusCode, 200);
  const delData = JSON.parse(resDelete.body);
  assert.equal(delData.cleared, true);
});
