import assert from "node:assert/strict";
import test from "node:test";
import { createHarness } from "./helpers.mjs";

test("new and upgraded profiles default to the document's orientation", async () => {
  for (const value of [undefined, null, "180", 90, 270, true, {}, 0]) {
    const harness = createHarness({ storage: { printRotationDegrees: value } });
    const settings = await harness.run("print-settings.js");
    assert.equal(await settings.readPrintRotation(), 0);
  }
});

test("the correction persists across jobs and remains isolated between profiles", async () => {
  const storage = {};
  const first = createHarness({ storage });
  const settings = await first.run("print-settings.js");
  await settings.savePrintRotation(180);
  const reopened = await createHarness({ storage }).run("print-settings.js");
  const other = await createHarness().run("print-settings.js");
  assert.equal(await reopened.readPrintRotation(), 180);
  assert.equal(await other.readPrintRotation(), 0);
  await reopened.savePrintRotation(0);
  assert.equal(await settings.readPrintRotation(), 0);
  assert.deepEqual(first.calls.reads, ["printRotationDegrees"]);
});

test("unsupported corrections cannot be saved", async () => {
  const harness = createHarness();
  const settings = await harness.run("print-settings.js");
  for (const value of [90, -180, 360, "180", NaN, undefined]) {
    await assert.rejects(settings.savePrintRotation(value), /0 or 180/);
  }
  assert.equal(harness.calls.writes.length, 0);
});

test("the settings popup loads and saves the correction", async () => {
  const storage = { printRotationDegrees: 180 };
  const harness = createHarness({ storage });
  await harness.run("options.js");
  const select = harness.elements.printRotation;
  assert.equal(select.value, "180");
  assert.equal(select.disabled, false);
  select.value = "0";
  await select.emit("change");
  assert.equal(storage.printRotationDegrees, 0);
  assert.match(harness.elements.settingsStatus.textContent, /^Saved/);
});

test("failed saves restore the last saved choice and show an error", async () => {
  const storage = { printRotationDegrees: 180 };
  const harness = createHarness({ storage, writeError: new Error("Storage unavailable") });
  await harness.run("options.js");
  harness.elements.printRotation.value = "0";
  await harness.elements.printRotation.emit("change");
  assert.equal(harness.elements.printRotation.value, "180");
  assert.equal(harness.elements.printRotation.disabled, false);
  assert.equal(storage.printRotationDegrees, 180);
  assert.match(harness.elements.settingsStatus.textContent, /Could not save settings/);
});

test("failed settings reads stay visible and do not allow accidental overwrites", async () => {
  const harness = createHarness({ readError: new Error("Storage unavailable") });
  await harness.run("options.js");
  assert.equal(harness.elements.printRotation.disabled, true);
  assert.match(harness.elements.settingsStatus.textContent, /Could not load settings/);
  assert.equal(harness.calls.writes.length, 0);
});
