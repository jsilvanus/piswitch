import { test } from "node:test";
import assert from "node:assert/strict";
import { AtemAdapter, type AtemClient } from "../src/adapters/atem-adapter.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function fakeClient(): AtemClient & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const listeners = new Map<string, (...args: never[]) => void>();
  const state = {
    video: {
      mixEffects: [
        {
          programInput: 1,
          previewInput: 2,
          transitionPosition: { inTransition: false, remainingFrames: 0 },
          fadeToBlack: { isFullyBlack: false, inTransition: false, remainingFrames: 0 },
        },
      ],
      downstreamKeyers: [
        { onAir: false, inTransition: false, properties: { tie: true } },
        { onAir: true, inTransition: false, properties: { tie: false } },
      ],
    },
  };
  return {
    calls,
    state,
    async connect() {
      listeners.get("connected")?.();
    },
    async disconnect() {},
    async changeProgramInput(...args: unknown[]) {
      calls.push(["program", ...args]);
    },
    async changePreviewInput(...args: unknown[]) {
      calls.push(["preview", ...args]);
    },
    async cut(...args: unknown[]) {
      calls.push(["cut", ...args]);
    },
    async autoTransition(...args: unknown[]) {
      calls.push(["auto", ...args]);
    },
    async fadeToBlack(...args: unknown[]) {
      calls.push(["ftb", ...args]);
    },
    async setDownstreamKeyTie(...args: unknown[]) {
      calls.push(["tie", ...args]);
    },
    async uploadStill(...args: unknown[]) {
      calls.push(["still", args[0], (args[1] as Buffer).length, args[2]]);
    },
    async setMediaPlayerSource(...args: unknown[]) {
      calls.push(["mp", ...args]);
    },
    async setDownstreamKeyFillSource(...args: unknown[]) {
      calls.push(["fill", ...args]);
    },
    async setDownstreamKeyCutSource(...args: unknown[]) {
      calls.push(["cut-src", ...args]);
    },
    async setDownstreamKeyOnAir(...args: unknown[]) {
      calls.push(["onair", ...args]);
    },
    on(event: string, listener: (...args: never[]) => void) {
      listeners.set(event, listener);
      return this;
    },
  } as unknown as AtemClient & { calls: unknown[][] };
}

test("AtemAdapter connects, sends commands to hardware client and emits state", async () => {
  const client = fakeClient();
  const adapter = new AtemAdapter({ createClient: () => client });
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "atem" }), adapter);

  await adapter.connect("192.168.1.50");
  assert.equal(adapter.getState().connected, true);
  assert.equal(adapter.getState().programInput, 1);
  assert.equal(adapter.getState().previewInput, 2);

  // CUT via API
  const cutRes = await app.inject({ method: "POST", url: "/api/v1/video-mixer/cut" });
  assert.equal(cutRes.statusCode, 200);
  assert.deepEqual(client.calls[0], ["cut", 0]);

  // AUTO
  const autoRes = await app.inject({ method: "POST", url: "/api/v1/video-mixer/auto" });
  assert.equal(autoRes.statusCode, 200);
  assert.deepEqual(client.calls[1], ["auto", 0]);

  // FTB
  const ftbRes = await app.inject({ method: "POST", url: "/api/v1/video-mixer/ftb" });
  assert.equal(ftbRes.statusCode, 200);
  assert.deepEqual(client.calls[2], ["ftb", 0]);

  // Program & Preview
  await app.inject({ method: "PUT", url: "/api/v1/video-mixer/program", payload: { input: 3 } });
  assert.deepEqual(client.calls[3], ["program", 3, 0]);

  await app.inject({ method: "PUT", url: "/api/v1/video-mixer/preview", payload: { input: 4 } });
  assert.deepEqual(client.calls[4], ["preview", 4, 0]);

  await adapter.disconnect();
  assert.equal(adapter.getState().connected, false);

  await app.close();
});
