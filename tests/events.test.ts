import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAdapter } from "../src/adapters/mock-adapter.js";
import { SwitchEventBroker } from "../src/events.js";

test("SwitchEventBroker broadcasts video-mixer and atem events to subscribers", () => {
  const broker = new SwitchEventBroker();
  const mixer = new MockAdapter();

  const events: any[] = [];
  const unsubscribe = broker.subscribe((e) => {
    events.push(e);
  });

  broker.emit({ type: "video-mixer", data: mixer.getState() });
  broker.emit({ type: "atem", data: mixer.getState() });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "video-mixer");
  assert.equal(events[1].type, "atem");

  unsubscribe();
  broker.emit({ type: "video-mixer", data: mixer.getState() });
  assert.equal(events.length, 2); // no more events after unsubscribe
});
