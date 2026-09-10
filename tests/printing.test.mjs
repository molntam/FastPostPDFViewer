import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHarness, makePdf } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { createCanvas, DOMMatrix, ImageData, Path2D } = require("@napi-rs/canvas");
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
// The modern PDF.js bundle targets Edge APIs that Node.js 24 does not yet provide.
if (!Uint8Array.prototype.toHex) {
  Uint8Array.prototype.toHex = function () { return Buffer.from(this).toString("hex"); };
}
if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function (key, callback) {
    if (!this.has(key)) this.set(key, callback(key));
    return this.get(key);
  };
}
const pdfjs = await import("../vendor/pdf.min.mjs");

async function print(t, options = {}) {
  const harness = createHarness({ createCanvas, pdfjs, ...options });
  t.after(() => harness.dispose());
  await harness.run("viewer.js");
  assert.equal(await harness.waitForPrint(), "printed", harness.elements.busyText.textContent);
  assert.equal(harness.calls.prints, 1);
  return harness;
}

function pixel(canvas, x, y) {
  return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
}

for (const correction of [0, 180]) {
  test(`prints all four PDF rotations at 600 DPI with correction ${correction}`, async (t) => {
    const harness = await print(t, { storage: { printRotationDegrees: correction } });
    const canvases = harness.elements.printContainer.querySelectorAll("canvas");
    assert.equal(canvases.length, 4);
    const positions = [[100, 150], [750, 100], [500, 750], [150, 500]];
    for (let index = 0; index < canvases.length; index += 1) {
      const canvas = canvases[index];
      const position = positions[(index + correction / 90) % 4];
      assert.deepEqual([canvas.width, canvas.height], index % 2 ? [900, 600] : [600, 900]);
      const [r, g, b, alpha] = pixel(canvas, ...position);
      assert.ok(r > 0 && r < 255, "The asymmetric red marker remains on the expected side");
      assert.equal(r, g);
      assert.equal(g, b);
      assert.equal(alpha, 255);
      assert.deepEqual(pixel(canvas, canvas.width / 2, 20), [255, 255, 255, 255]);
      assert.equal(harness.calls.renders[index].intent, "print");
    }
  });
}

test("uses inherited PDF rotation when a page has no explicit rotation", async (t) => {
  const harness = await print(t, { data: makePdf([null], 90) });
  const [canvas] = harness.elements.printContainer.querySelectorAll("canvas");
  assert.deepEqual([canvas.width, canvas.height], [900, 600]);
  assert.ok(pixel(canvas, 750, 100)[0] < 255);
});

test("removing the redundant white paint preserves every rendered pixel", async (t) => {
  const harness = await print(t);
  const reference = await pdfjs.getDocument({ data: makePdf() }).promise;
  t.after(() => reference.loadingTask.destroy());
  const canvases = harness.elements.printContainer.querySelectorAll("canvas");
  for (let index = 0; index < canvases.length; index += 1) {
    const actual = canvases[index];
    const expected = createCanvas(actual.width, actual.height);
    const context = expected.getContext("2d", { alpha: false });
    context.fillStyle = "rgb(255, 255, 255)";
    context.fillRect(0, 0, expected.width, expected.height);
    const page = await reference.getPage(index + 1);
    await page.render({
      canvasContext: context,
      viewport: page.getViewport({ scale: 1 }),
      transform: [600 / 72, 0, 0, 600 / 72, 0, 0],
      intent: "print",
    }).promise;
    context.globalCompositeOperation = "saturation";
    context.fillStyle = "rgb(0, 0, 0)";
    context.fillRect(0, 0, expected.width, expected.height);
    assert.deepEqual(
      actual.getContext("2d").getImageData(0, 0, actual.width, actual.height).data,
      context.getImageData(0, 0, expected.width, expected.height).data,
    );
  }
});

test("transfers the original buffer while preserving an exact recovery PDF", async (t) => {
  const data = makePdf([0]);
  const harness = await print(t, { data });
  assert.equal(harness.workerBuffer, harness.capturedBuffer);
  assert.equal(harness.workerBuffer.byteLength, 0, "PDF.js took ownership of the buffer");
  assert.deepEqual(new Uint8Array(await harness.capturedBlob.arrayBuffer()), data);
});

test("render failures retain the captured PDF download and never open print", async (t) => {
  const data = makePdf([0]);
  const harness = createHarness({ createCanvas, pdfjs, data, renderError: new Error("Render failed") });
  t.after(() => harness.dispose());
  await harness.run("viewer.js");
  assert.equal(await harness.waitForPrint(), "error");
  assert.equal(harness.calls.prints, 0);
  assert.match(harness.elements.busyText.textContent, /Render failed/);
  assert.equal(harness.calls.renders.length, 1);
  assert.equal(harness.elements.errorFallback.hidden, false);
  await harness.elements.errorFallback.emit("click");
  assert.deepEqual(harness.calls.downloads, [{ href: "blob:captured-pdf", download: "DispoPrint.pdf" }]);
  assert.deepEqual(new Uint8Array(await harness.capturedBlob.arrayBuffer()), data);
});

test("storage failures stop the job instead of silently changing its rotation", async (t) => {
  const harness = createHarness({ createCanvas, pdfjs, readError: new Error("Storage unavailable") });
  t.after(() => harness.dispose());
  await harness.run("viewer.js");
  assert.equal(await harness.waitForPrint(), "error");
  assert.equal(harness.calls.prints, 0);
  assert.match(harness.elements.busyText.textContent, /loading print settings/i);
  assert.equal(harness.elements.errorFallback.hidden, false);
});

test("print completion releases canvases, styles, and the recovery URL once", async (t) => {
  const harness = await print(t, { data: makePdf([0]) });
  const canvases = harness.elements.printContainer.querySelectorAll("canvas");
  harness.window.emit("afterprint");
  harness.window.emit("afterprint");
  assert.deepEqual(harness.calls.canvasResets, [
    { canvas: canvases[0], dimension: "width" },
    { canvas: canvases[0], dimension: "height" },
  ]);
  assert.equal(harness.elements.printContainer.children.length, 0);
  assert.equal(harness.document.adoptedStyleSheets.length, 0);
  assert.deepEqual(harness.calls.revoked, ["blob:captured-pdf"]);
  assert.equal(harness.calls.closes, 1);
});

test("foreign PDF origins fall back without reading settings or consuming the stream", async (t) => {
  const harness = createHarness({ originalUrl: "https://example.com/document.pdf" });
  t.after(() => harness.dispose());
  await harness.run("viewer.js");
  assert.equal(await harness.waitForPrint(), "fallback");
  assert.equal(harness.calls.fallbacks, 1);
  assert.equal(harness.calls.fetches, 0);
  assert.equal(harness.calls.prints, 0);
  assert.equal(harness.calls.reads.length, 0);
});
