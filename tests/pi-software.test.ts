import { test } from "node:test";
import assert from "node:assert/strict";
import { PiSoftwareAdapter } from "../src/adapters/pi-software-adapter.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("PiSoftwareAdapter switches inputs, cuts and manages DSK", async () => {
  const mixer = new PiSoftwareAdapter();

  assert.equal(mixer.getState().backend, "pi");
  assert.equal(mixer.getState().programInput, 1);
  assert.equal(mixer.getState().previewInput, 2);

  await mixer.setProgram(3);
  assert.equal(mixer.getState().programInput, 3);

  await mixer.setPreview(4);
  assert.equal(mixer.getState().previewInput, 4);

  // CUT swaps
  await mixer.cut();
  assert.equal(mixer.getState().programInput, 4);
  assert.equal(mixer.getState().previewInput, 3);

  // Tie toggle on cut
  await mixer.setDownstreamKeyTie(0, true);
  await mixer.cut();
  assert.equal(mixer.getState().downstreamKeyers[0]?.onAir, true);
});

test("PiSoftwareAdapter dynamically registers and unregisters phone cameras", async () => {
  const mixer = new PiSoftwareAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "pi" }), mixer);

  // Register phone camera via API
  const regRes = await app.inject({
    method: "POST",
    url: "/api/v1/video-mixer/inputs/phone",
    payload: {
      id: 5,
      name: "Pastor iPhone 15",
      streamUrl: "rtsp://mediamtx:8554/phone-pastor",
      deviceInfo: "iOS 18 WebRTC",
    },
  });
  assert.equal(regRes.statusCode, 201);
  assert.equal(regRes.json().ok, true);

  // Check inputs endpoint
  const inputsRes = await app.inject({
    method: "GET",
    url: "/api/v1/video-mixer/inputs",
  });
  assert.equal(inputsRes.statusCode, 200);
  const inputs = inputsRes.json().inputs;
  const phone = inputs.find((i: any) => i.id === 5);
  assert.ok(phone);
  assert.equal(phone.name, "Pastor iPhone 15");
  assert.equal(phone.kind, "phone");
  assert.equal(phone.available, true);

  // We can switch preview/program to phone camera!
  await app.inject({
    method: "PUT",
    url: "/api/v1/video-mixer/preview",
    payload: { input: 5 },
  });
  assert.equal(mixer.getState().previewInput, 5);

  await app.inject({ method: "POST", url: "/api/v1/video-mixer/cut" });
  assert.equal(mixer.getState().programInput, 5);

  // Unregister phone camera
  const delRes = await app.inject({
    method: "DELETE",
    url: "/api/v1/video-mixer/inputs/phone/5",
  });
  assert.equal(delRes.statusCode, 200);

  const updatedInputs = (await app.inject({ method: "GET", url: "/api/v1/video-mixer/inputs" })).json().inputs;
  const updatedPhone = updatedInputs.find((i: any) => i.id === 5);
  assert.equal(updatedPhone.available, false);

  await app.close();
});
