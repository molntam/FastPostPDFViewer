import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

const root = new URL("../", import.meta.url);

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.hidden = true;
    this.disabled = true;
    this.value = "0";
    this.textContent = "";
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }

  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  removeAttribute() {}
  querySelector() { return this; }
  querySelectorAll() { return this.children.flatMap((child) => child.children); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  emit(name) { return this.listeners.get(name)?.(); }
}

export function makePdf(rotations = [0, 90, 180, 270], inheritedRotation = 0) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${rotations.length} /Rotate ${inheritedRotation} /Kids [${rotations.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] >>`,
  ];
  for (const rotation of rotations) {
    const streamId = objects.length + 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 108] ${rotation === null ? "" : `/Rotate ${rotation}`} /Resources << >> /Contents ${streamId} 0 R >>`);
    const drawing = "1 0 0 rg 6 84 12 12 re f\n0 0 1 rg 42 6 24 12 re f\n0 G 0.12 w 6 54 m 66 54 l S\n";
    objects.push(`<< /Length ${drawing.length} >>\nstream\n${drawing}endstream`);
  }

  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function createHarness({
  data = makePdf(), storage = {}, pdfjs, createCanvas,
  originalUrl = "https://solutions.inet-logistics.com/DispoPrint.pdf",
  readError = null, writeError = null, renderError = null,
} = {}) {
  const elements = Object.fromEntries([
    "busyOverlay", "busyProgress", "busyText", "errorFallback", "printContainer",
    "printRotation", "settingsStatus",
  ].map((name) => [name, new Element()]));
  const calls = { prints: 0, fallbacks: 0, fetches: 0, closes: 0, renders: [], downloads: [], revoked: [], reads: [], writes: [], canvasResets: [] };
  let capturedBuffer, capturedBlob, workerBuffer, loadedTask, destroyPromise;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const window = new Element();
  Object.assign(window, {
    print() { calls.prints += 1; resolveDone("printed"); },
    close() { calls.closes += 1; },
    prompt() { return null; },
  });
  const document = {
    adoptedStyleSheets: [],
    getElementById: (name) => elements[name],
    createElement(name) {
      if (name === "canvas") {
        const canvas = createCanvas(1, 1);
        canvas.style = {};
        for (const dimension of ["width", "height"]) {
          const property = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(canvas), dimension);
          Object.defineProperty(canvas, dimension, {
            get() { return property.get.call(this); },
            set(value) {
              if (value === 0) calls.canvasResets.push({ canvas, dimension });
              property.set.call(this, value);
            },
          });
        }
        return canvas;
      }
      const element = new Element();
      element.click = () => calls.downloads.push({ href: element.href, download: element.download });
      return element;
    },
  };
  const context = createContext({
    document, window, Uint8Array, ArrayBuffer,
    Blob: class extends Blob {
      constructor(parts, options) {
        super(parts, options);
        capturedBuffer = parts[0];
        capturedBlob = this;
      }
    },
    URL: class extends URL {
      static createObjectURL() { return "blob:captured-pdf"; }
      static revokeObjectURL(url) { calls.revoked.push(url); }
    },
    CSSStyleSheet: class { replaceSync(css) { this.css = css; } },
    chrome: {
      storage: {
        local: {
          async get(key) {
            calls.reads.push(key);
            if (readError) throw readError;
            return { ...storage };
          },
          async set(settings) {
            if (writeError) throw writeError;
            calls.writes.push(settings);
            Object.assign(storage, settings);
          },
        },
        sync: {
          get() { throw new Error("Printer corrections must not use sync storage."); },
          set() { throw new Error("Printer corrections must not use sync storage."); },
        },
      },
      runtime: { getURL: (path) => new URL(path, root).href },
      mimeHandler: {
        async getStreamInfo() { return { originalUrl, streamUrl: "stream:captured", responseHeaders: {} }; },
        async abortAndFallbackToNativeHandler() { calls.fallbacks += 1; resolveDone("fallback"); },
      },
    },
    async fetch(url) {
      if (url !== "stream:captured") throw new Error("Unexpected network request");
      calls.fetches += 1;
      return new Response(data, { headers: { "content-length": String(data.length) } });
    },
    console: { error: () => resolveDone("error"), warn() {}, log() {} },
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => setImmediate(callback),
  });
  const modules = new Map();

  async function loadModule(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const module = new SourceTextModule(await readFile(url, "utf8"), {
      context,
      identifier: url.href,
      async importModuleDynamically(specifier) {
        if (specifier !== "./vendor/pdf.min.mjs") throw new Error("Unexpected dynamic import");
        const vendor = new SyntheticModule(["GlobalWorkerOptions", "getDocument"], function () {
          this.setExport("GlobalWorkerOptions", pdfjs.GlobalWorkerOptions);
          this.setExport("getDocument", (options) => {
            workerBuffer = options.data.buffer;
            const task = pdfjs.getDocument(options);
            loadedTask = task;
            const destroy = task.destroy.bind(task);
            task.destroy = () => (destroyPromise = destroy());
            const promise = task.promise.then((pdf) => {
              const getPage = pdf.getPage.bind(pdf);
              pdf.getPage = async (number) => {
                const page = await getPage(number);
                const render = page.render.bind(page);
                page.render = (parameters) => {
                  calls.renders.push(parameters);
                  if (renderError) throw renderError;
                  return render(parameters);
                };
                return page;
              };
              return pdf;
            });
            return { promise, destroy: () => task.destroy() };
          });
        }, { context });
        await vendor.link(() => {});
        await vendor.evaluate();
        return vendor;
      },
    });
    modules.set(url.href, module);
    await module.link((specifier) => loadModule(new URL(specifier, url)));
    return module;
  }

  return {
    elements, calls, document, window, storage,
    get capturedBuffer() { return capturedBuffer; },
    get capturedBlob() { return capturedBlob; },
    get workerBuffer() { return workerBuffer; },
    async run(file) {
      const module = await loadModule(new URL(file, root));
      await module.evaluate();
      await new Promise(setImmediate);
      return module.namespace;
    },
    async waitForPrint() {
      let timer;
      try {
        return await Promise.race([done, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Printing timed out")), 15000);
        })]);
      } finally {
        clearTimeout(timer);
      }
    },
    async dispose() {
      window.emit("unload");
      await (destroyPromise || loadedTask?.destroy());
    },
  };
}
