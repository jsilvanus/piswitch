import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { MockAdapter } from "../src/adapters/mock-adapter.js";
import { loadConfig } from "../src/config.js";

test("GET /api/v1/video-mixer returns mixer state", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const res = await app.inject({ method: "GET", url: "/api/v1/video-mixer" });
  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.connected, true);
  assert.equal(data.programInput, 1);
  assert.equal(data.previewInput, 2);
  await app.close();
});

test("GET /api/v1/atem alias returns same mixer state", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const res = await app.inject({ method: "GET", url: "/api/v1/atem" });
  assert.equal(res.statusCode, 200);
  const data = res.json();
  assert.equal(data.connected, true);
  assert.equal(data.programInput, 1);
  assert.equal(data.previewInput, 2);
  await app.close();
});

test("PUT program and preview switch inputs and return state", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const pgmRes = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/program",
    payload: { input: 3 },
  });
  assert.equal(pgmRes.statusCode, 200);
  assert.equal(pgmRes.json().programInput, 3);

  const pvwRes = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/preview",
    payload: { input: 4 },
  });
  assert.equal(pvwRes.statusCode, 200);
  assert.equal(pvwRes.json().previewInput, 4);

  await app.close();
});

test("POST cut swaps program and preview", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  await app.inject({ method: "PUT", url: "/api/v1/video-mixer/program", payload: { input: 1 } });
  await app.inject({ method: "PUT", url: "/api/v1/video-mixer/preview", payload: { input: 2 } });

  const cutRes = await app.inject({ method: "POST", url: "/api/v1/video-mixer/cut" });
  assert.equal(cutRes.statusCode, 200);
  assert.equal(cutRes.json().programInput, 2);
  assert.equal(cutRes.json().previewInput, 1);

  await app.close();
});

test("POST auto triggers transition", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const autoRes = await app.inject({ method: "POST", url: "/api/v1/video-mixer/auto" });
  assert.equal(autoRes.statusCode, 200);
  await app.close();
});

test("POST ftb toggles fade to black", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const ftb1 = await app.inject({ method: "POST", url: "/api/v1/video-mixer/ftb" });
  assert.equal(ftb1.statusCode, 200);
  assert.equal(ftb1.json().fadeToBlack.fullyBlack, true);

  const ftb2 = await app.inject({ method: "POST", url: "/api/v1/video-mixer/ftb" });
  assert.equal(ftb2.statusCode, 200);
  assert.equal(ftb2.json().fadeToBlack.fullyBlack, false);

  await app.close();
});

test("PUT DSK controls on-air and tie", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const onAir = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/dsk/1/on-air",
    payload: { onAir: true },
  });
  assert.equal(onAir.statusCode, 200);
  assert.equal(onAir.json().downstreamKeyers[0].onAir, true);

  const tie = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/dsk/1/tie",
    payload: { tie: true },
  });
  assert.equal(tie.statusCode, 200);
  assert.equal(tie.json().downstreamKeyers[0].tie, true);

  await app.close();
});

test("503 returned when mixer is not connected with proper error codes", async () => {
  const mixer = new MockAdapter({ connected: false });
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  const mixerRes = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/program",
    payload: { input: 1 },
  });
  assert.equal(mixerRes.statusCode, 503);
  assert.equal(mixerRes.json().error.code, "MIXER_NOT_CONNECTED");

  // ATEM alias returns ATEM_NOT_CONNECTED for backward compatibility
  const atemRes = await app.inject({
    method: "PUT",
    url: "/api/v1/atem/program",
    payload: { input: 1 },
  });
  assert.equal(atemRes.statusCode, 503);
  assert.equal(atemRes.json().error.code, "ATEM_NOT_CONNECTED");

  await app.close();
});

test("422 returned for invalid input values", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  for (const bad of [0, -1, 999, "bad"]) {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/video-mixer/program",
      payload: { input: bad },
    });
    assert.equal(res.statusCode, 422);
  }

  await app.close();
});

test("PUT and POST USK controls setup, on-air, and DVE fly key", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);

  // Setup USK 1 with Media Player 1, slot 7, DVE type
  const setupRes = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/usk/1/setup",
    payload: {
      mediaPlayer: 1,
      slot: 7,
      type: "dve",
      flyEnabled: true,
    },
  });
  assert.equal(setupRes.statusCode, 200);

  // Trigger Fly key in from Left
  const flyRes = await app.inject({
    method: "POST",
    url: "/api/v1/video-mixer/usk/1/fly",
    payload: { direction: "left" },
  });
  assert.equal(flyRes.statusCode, 200);
  assert.equal(flyRes.json().ok, true);

  // Turn USK 1 off air
  const offRes = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/usk/1/on-air",
    payload: { onAir: false },
  });
  assert.equal(offRes.statusCode, 200);

  await app.close();
});
