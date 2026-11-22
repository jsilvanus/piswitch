import { test } from "node:test";
import assert from "node:assert/strict";
import { AtemAdapter, isRelevantAtemPath, type AtemClient } from "../src/adapters/atem-adapter.js";
import type { VideoMixerState } from "../src/types.js";

function setup(stateMinIntervalMs: number) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const me = {
    programInput: 1,
    previewInput: 2,
    transitionPosition: { inTransition: false, remainingFrames: 0 },
    fadeToBlack: { isFullyBlack: false, inTransition: false, remainingFrames: 0 },
  };
  const state = { video: { mixEffects: [me], downstreamKeyers: [] as unknown[] } };
  const client = {
    state,
    async connect() {
      listeners.get("connected")?.();
    },
    async disconnect() {},
    on(event: string, l: (...args: unknown[]) => void) {
      listeners.set(event, l);
      return this;
    },
  } as unknown as AtemClient;
  const adapter = new AtemAdapter({ createClient: () => client, stateMinIntervalMs });
  const emitted: VideoMixerState[] = [];
  adapter.onStateChange((s) => emitted.push(s));
  const fire = (paths?: string[]) => listeners.get("stateChanged")?.(state, paths);
  return { adapter, me, emitted, fire };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("path filter recognises what getState reads", () => {
  assert.equal(isRelevantAtemPath("video.mixEffects.0.programInput"), true);
  assert.equal(isRelevantAtemPath("video.downstreamKeyers.1.onAir"), true);
  assert.equal(isRelevantAtemPath("audio.channels.1"), false);
  assert.equal(isRelevantAtemPath("info.lastTime"), false);
});

test("unchanged state does not re-emit", async () => {
  const { adapter, emitted, fire } = setup(0);
  await adapter.connect("1.2.3.4");
  assert.equal(emitted.length, 1); // connected
  fire(["video.mixEffects.0.programInput"]);
  fire();
  fire(["video.mixEffects.0.previewInput"]);
  assert.equal(emitted.length, 1);
  await adapter.disconnect();
});

test("irrelevant paths are ignored even when state differs", async () => {
  const { adapter, me, emitted, fire } = setup(0);
  await adapter.connect("1.2.3.4");
  me.programInput = 5;
  fire(["audio.channels.1", "info.lastTime"]);
  assert.equal(emitted.length, 1);
  fire(["video.mixEffects.0.programInput"]);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1]?.programInput, 5);
  await adapter.disconnect();
});

test("bursts coalesce and a trailing emit delivers the final state", async () => {
  const { adapter, me, emitted, fire } = setup(60);
  await adapter.connect("1.2.3.4");
  assert.equal(emitted.length, 1);
  await sleep(70); // let the interval after the connect emit pass
  for (let i = 3; i <= 8; i++) {
    me.programInput = i;
    fire(["video.mixEffects.0.programInput"]);
  }
  assert.equal(emitted.length, 2); // first one immediate, rest held
  assert.equal(emitted[1]?.programInput, 3);
  await sleep(120);
  assert.equal(emitted.length, 3);
  assert.equal(emitted[2]?.programInput, 8);
  await adapter.disconnect();
});

test("disconnect emits immediately and cancels a pending trailing emit", async () => {
  const { adapter, me, emitted, fire } = setup(200);
  await adapter.connect("1.2.3.4");
  me.programInput = 9;
  fire(["video.mixEffects.0.programInput"]); // held (just emitted on connect)
  await adapter.disconnect();
  assert.equal(emitted.at(-1)?.connected, false);
  const n = emitted.length;
  await sleep(250);
  assert.equal(emitted.length, n);
});
