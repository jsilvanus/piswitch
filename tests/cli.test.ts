import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../src/cli.js";
import { buildApp } from "../src/app.js";
import { MockAdapter } from "../src/adapters/mock-adapter.js";
import { loadConfig } from "../src/config.js";

test("CLI commands against mock server", async () => {
  const mixer = new MockAdapter();
  const { app } = buildApp(loadConfig({ PISWITCH_BACKEND: "mock" }), mixer);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  try {
    // 1. Status
    const statusExit = await runCli(["status", "--url", address, "--json"]);
    assert.equal(statusExit, 0);

    // 2. Program
    const pgmExit = await runCli(["program", "3", "--url", address]);
    assert.equal(pgmExit, 0);
    assert.equal(mixer.getState().programInput, 3);

    // 3. Preview
    const pvwExit = await runCli(["preview", "4", "--url", address]);
    assert.equal(pvwExit, 0);
    assert.equal(mixer.getState().previewInput, 4);

    // 4. CUT
    const cutExit = await runCli(["cut", "--url", address]);
    assert.equal(cutExit, 0);
    assert.equal(mixer.getState().programInput, 4);
    assert.equal(mixer.getState().previewInput, 3);

    // 5. AUTO
    const autoExit = await runCli(["auto", "--url", address]);
    assert.equal(autoExit, 0);

    // 6. FTB
    const ftbExit = await runCli(["ftb", "--url", address]);
    assert.equal(ftbExit, 0);
    assert.equal(mixer.getState().fadeToBlack.fullyBlack, true);

    // 7. DSK
    const dskExit = await runCli(["dsk", "1", "on", "--url", address]);
    assert.equal(dskExit, 0);
    assert.equal(mixer.getState().downstreamKeyers[0]?.onAir, true);
  } finally {
    await app.close();
  }
});
