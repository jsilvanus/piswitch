import { test } from "node:test";
import assert from "node:assert/strict";
import { RoutingStore } from "../src/routing/routing-store.js";
import { buildApp } from "../src/app.js";
import { MockAdapter } from "../src/adapters/mock-adapter.js";
import { loadConfig } from "../src/config.js";

test("RoutingStore resolves buses dynamically with reservations and fallbacks", () => {
  const store = new RoutingStore();

  // Both buses free initially
  assert.equal(store.isBusFree("pi1"), true);
  assert.equal(store.isBusFree("pi2"), true);

  // Normal lookup with both free
  const initial = store.resolveBusForInput(5);
  assert.equal(initial.bus, "pi1");
  assert.equal(initial.hdmi, "hdmi0");
  assert.equal(initial.atlonaInput, 3);

  // Pre-warming lookup when active on pi1 -> picks alternate pi2 (Option 2)
  store.setActiveBusOnAir("pi1");
  const preWarmed = store.resolveBusForInput(6, true);
  assert.equal(preWarmed.bus, "pi2");
  assert.equal(preWarmed.hdmi, "hdmi1");
  assert.equal(preWarmed.atlonaInput, 4);
  assert.equal(preWarmed.mode, "pre-warmed");

  // Reserve pi2 for projectors
  store.setBusReservation("pi2", "projectors");
  assert.equal(store.isBusFree("pi2"), false);

  // When pi2 is busy, falls back to pi1 even if pre-warming requested (Option 1)
  const fallback = store.resolveBusForInput(6, true);
  assert.equal(fallback.bus, "pi1");
  assert.equal(fallback.hdmi, "hdmi0");
  assert.equal(fallback.mode, "direct-swap");
});

test("GET and PUT /api/v1/video-mixer/routing manages config and reservations at runtime", async () => {
  const mixer = new MockAdapter();
  const store = new RoutingStore();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer, store);

  // GET routing
  const getRes = await app.inject({ method: "GET", url: "/api/v1/video-mixer/routing" });
  assert.equal(getRes.statusCode, 200);
  const data = getRes.json();
  assert.equal(data.config.atemDynamicInput, 4);
  assert.equal(data.config.atlonaAtemOutput, 5);

  // PUT routing to reserve pi1 for PiProgram
  const putRes = await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/routing",
    payload: {
      reservations: {
        pi1: "piprogram",
      },
      config: {
        defaultAtemBus: "pi2",
      },
    },
  });
  assert.equal(putRes.statusCode, 200);
  assert.equal(store.isBusFree("pi1"), false);
  assert.equal(store.getConfig().defaultAtemBus, "pi2");

  await app.close();
});
