import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extension settings and the print bridge are packaged with their required scope", async () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.version, "1.2.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.mime_types_handler["application/pdf"].handler_url, "viewer.html");
  assert.equal(manifest.action.default_popup, "options.html");
  assert.equal(manifest.options_ui.page, "options.html");
  assert.deepEqual(manifest.content_scripts, [{
    matches: ["https://solutions.inet-logistics.com/*"],
    js: ["page-print-hook.js"],
    run_at: "document_start",
    world: "MAIN",
  }]);
  for (const file of ["viewer.html", "options.html", "options.css", "options.js", "print-settings.js"]) {
    assert.ok((await readFile(new URL(file, root))).length > 0);
  }
});
