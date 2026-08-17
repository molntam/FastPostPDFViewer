const elements = {
  busyOverlay: document.getElementById("busyOverlay"),
  busyProgress: document.getElementById("busyProgress"),
  busyText: document.getElementById("busyText"),
  errorFallback: document.getElementById("errorFallback"),
  printContainer: document.getElementById("printContainer"),
};

const PDF_POINTS_PER_INCH = 72;
const MM_PER_POINT = 25.4 / PDF_POINTS_PER_INCH;
const PRINT_RESOLUTION = 600;
const PRINT_ROTATION_DEGREES = 180;
const MAX_PRINT_PIXELS = 40000000;
const PRINT_SAFE_MARGIN_MM = 6;
const PRINT_LAYOUT_EPSILON_MM = 0.2;
const ALLOWED_PDF_ORIGIN = "https://solutions.inet-logistics.com";

let blobUrl = null;
let currentPhase = "preparing the print";
let documentName = "document.pdf";
let pdfDocument = null;
let printFinished = false;
let printPageStyleSheet = null;
let streamInfo = null;

function setBusy(message, progress = null) {
  elements.busyOverlay.hidden = false;
  elements.busyOverlay.querySelector(".busy-card").classList.remove("error", "done");
  elements.busyText.textContent = message;
  elements.errorFallback.hidden = true;

  if (progress === null) {
    elements.busyProgress.hidden = true;
    elements.busyProgress.removeAttribute("value");
  } else {
    elements.busyProgress.hidden = false;
    elements.busyProgress.value = Math.max(0, Math.min(100, progress));
  }
}

function setPhase(phase, progress = null) {
  currentPhase = phase;
  setBusy(`${phase}…`, progress);
}

function showError(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  console.error(value);
  elements.busyOverlay.hidden = false;
  elements.busyOverlay.querySelector(".busy-card").classList.add("error");
  elements.busyText.textContent = `Stopped while ${currentPhase.toLowerCase()}: ${value.name}: ${value.message}`;
  elements.busyProgress.hidden = true;
  elements.errorFallback.textContent = blobUrl ? "Download captured PDF" : "Open in Edge viewer";
  elements.errorFallback.hidden = false;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getResponseHeader(headers, name) {
  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value.join(", ") : String(value);
    }
  }

  return "";
}

function sanitizeFilename(value) {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  const filename = cleaned || "document.pdf";
  return filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
}

function filenameFromDisposition(disposition) {
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return encoded[1].trim().replace(/^"|"$/g, "");
    }
  }

  const plain = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return plain ? (plain[1] || plain[2]).trim() : "";
}

function resolveDocumentName(info) {
  const disposition = getResponseHeader(info.responseHeaders, "content-disposition");
  const fromHeader = filenameFromDisposition(disposition);

  if (fromHeader) {
    return sanitizeFilename(fromHeader);
  }

  try {
    const pathPart = new URL(info.originalUrl).pathname.split("/").pop();
    if (pathPart && pathPart.toLowerCase().endsWith(".pdf")) {
      return sanitizeFilename(decodeURIComponent(pathPart));
    }
  } catch {
    return "document.pdf";
  }

  return "document.pdf";
}

function isAllowedSourceUrl(value) {
  try {
    return new URL(value).origin === ALLOWED_PDF_ORIGIN;
  } catch {
    return false;
  }
}

function downloadCapturedPdf() {
  if (!blobUrl) {
    return;
  }

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = documentName;
  link.click();
}

async function fallbackToEdge() {
  try {
    await chrome.mimeHandler.abortAndFallbackToNativeHandler();
  } catch (error) {
    showError(error);
  }
}

function handleRecovery() {
  if (printFinished) {
    window.close();
  } else if (blobUrl) {
    downloadCapturedPdf();
  } else {
    fallbackToEdge();
  }
}

async function readStreamResponse(response) {
  if (!response.body?.getReader) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks = [];
  const declaredLength = Number(response.headers.get("content-length"))
    || Number(getResponseHeader(streamInfo.responseHeaders, "content-length"))
    || 0;
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    received += value.byteLength;
    if (declaredLength) {
      const percent = received / declaredLength * 100;
      setBusy(`Receiving PDF… ${Math.min(100, Math.round(percent))}%`, percent);
    } else {
      setBusy(`Receiving PDF… ${formatBytes(received)}`);
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function capturePdfStream() {
  setPhase("Connecting to Edge PDF stream");

  if (!chrome.mimeHandler) {
    throw new Error("The MIME handler API is unavailable. Microsoft Edge 151 or newer is required.");
  }

  streamInfo = await chrome.mimeHandler.getStreamInfo();
  if (!isAllowedSourceUrl(streamInfo.originalUrl)) {
    setPhase("Opening PDF in Edge viewer");
    await chrome.mimeHandler.abortAndFallbackToNativeHandler();
    return new Promise(() => {});
  }

  documentName = resolveDocumentName(streamInfo);
  document.title = documentName;
  setPhase("Receiving PDF");

  const slowStreamTimer = setTimeout(() => {
    if (currentPhase === "Receiving PDF") {
      elements.busyText.textContent = "Edge has not released the PDF stream yet. You can wait or use the Edge viewer fallback.";
      elements.errorFallback.hidden = false;
    }
  }, 12000);

  try {
    const response = await fetch(streamInfo.streamUrl);
    if (!response.ok) {
      throw new Error(`The PDF stream returned HTTP ${response.status}`);
    }
    return await readStreamResponse(response);
  } finally {
    clearTimeout(slowStreamTimer);
  }
}

async function loadPdf(buffer) {
  setPhase("Parsing PDF", 0);
  const pdfjsLib = await import("./vendor/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "vendor/pdf.worker.min.mjs",
  );

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    cMapUrl: chrome.runtime.getURL("vendor/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("vendor/wasm/"),
    enableXfa: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  loadingTask.onProgress = ({ loaded, total }) => {
    const percent = total ? loaded / total * 100 : null;
    setBusy("Parsing PDF…", percent);
  };

  loadingTask.onPassword = (updatePassword) => {
    const password = window.prompt("Enter the password for this PDF:");
    if (password === null) {
      loadingTask.destroy();
      return;
    }
    updatePassword(password);
  };

  return loadingTask.promise;
}

function getPrintUnits(viewport) {
  const requestedUnits = PRINT_RESOLUTION / PDF_POINTS_PER_INCH;
  const pixelLimitUnits = Math.sqrt(
    MAX_PRINT_PIXELS / (viewport.width * viewport.height),
  );
  return Math.min(requestedUnits, pixelLimitUnits);
}

function convertCanvasToGrayscale(context, width, height) {
  context.save();
  context.globalCompositeOperation = "saturation";
  context.fillStyle = "rgb(0, 0, 0)";
  context.fillRect(0, 0, width, height);
  context.restore();
}

function setPrintPageSize(pageSizes) {
  const { width, height } = pageSizes[0];
  const hasEqualPageSizes = pageSizes.every(
    (size) => Math.abs(size.width - width) < 0.01
      && Math.abs(size.height - height) < 0.01,
  );

  if (!hasEqualPageSizes) {
    console.warn("The PDF contains mixed page sizes; printing uses the first page size.");
  }

  printPageStyleSheet = new CSSStyleSheet();
  printPageStyleSheet.replaceSync(
    `@page { size: ${width.toFixed(3)}pt ${height.toFixed(3)}pt; margin: ${PRINT_SAFE_MARGIN_MM}mm; }`,
  );
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets,
    printPageStyleSheet,
  ];
}

async function preparePrintPages() {
  const pageSizes = [];
  const optionalContentConfigPromise = pdfDocument.getOptionalContentConfig({
    intent: "print",
  });

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    currentPhase = "Preparing document for printing";
    setBusy(
      `Preparing print page ${pageNumber} of ${pdfDocument.numPages}`,
      (pageNumber - 1) / pdfDocument.numPages * 100,
    );

    const page = await pdfDocument.getPage(pageNumber);
    const rotation = (page.rotate + PRINT_ROTATION_DEGREES + 360) % 360;
    const viewport = page.getViewport({ scale: 1, rotation });
    const printUnits = getPrintUnits(viewport);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const contentWidth = Math.max(
      1,
      viewport.width * MM_PER_POINT - 2 * PRINT_SAFE_MARGIN_MM - PRINT_LAYOUT_EPSILON_MM,
    );
    const contentHeight = Math.max(
      1,
      viewport.height * MM_PER_POINT - 2 * PRINT_SAFE_MARGIN_MM - PRINT_LAYOUT_EPSILON_MM,
    );
    const sourceWidth = viewport.width * MM_PER_POINT;
    const sourceHeight = viewport.height * MM_PER_POINT;
    const displayScale = Math.min(
      contentWidth / sourceWidth,
      contentHeight / sourceHeight,
    );

    pageSizes.push({ width: viewport.width, height: viewport.height });
    canvas.width = Math.floor(viewport.width * printUnits);
    canvas.height = Math.floor(viewport.height * printUnits);
    context.fillStyle = "rgb(255, 255, 255)";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: context,
      transform: [printUnits, 0, 0, printUnits, 0, 0],
      viewport,
      intent: "print",
      optionalContentConfigPromise,
    }).promise;
    convertCanvasToGrayscale(context, canvas.width, canvas.height);

    const wrapper = document.createElement("div");

    wrapper.className = "print-page";
    wrapper.style.width = `${contentWidth.toFixed(3)}mm`;
    wrapper.style.height = `${contentHeight.toFixed(3)}mm`;
    canvas.style.width = `${(sourceWidth * displayScale).toFixed(3)}mm`;
    canvas.style.height = `${(sourceHeight * displayScale).toFixed(3)}mm`;
    wrapper.append(canvas);
    elements.printContainer.append(wrapper);
  }

  setPrintPageSize(pageSizes);
}

function cleanup() {
  if (printPageStyleSheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (styleSheet) => styleSheet !== printPageStyleSheet,
    );
    printPageStyleSheet = null;
  }
  elements.printContainer.replaceChildren();
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
  pdfDocument?.destroy();
  pdfDocument = null;
}

function finishPrint() {
  if (printFinished) {
    return;
  }

  printFinished = true;
  cleanup();
  elements.busyOverlay.querySelector(".busy-card").classList.add("done");
  elements.busyText.textContent = "Print dialog closed. You can close this window.";
  elements.busyProgress.hidden = true;
  elements.errorFallback.textContent = "Close window";
  elements.errorFallback.hidden = false;
  elements.busyOverlay.hidden = false;
  window.close();
}

async function startPrint() {
  const buffer = await capturePdfStream();
  blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  pdfDocument = await loadPdf(buffer);
  await preparePrintPages();
  elements.busyOverlay.hidden = true;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.print();
}

elements.errorFallback.addEventListener("click", handleRecovery);
window.addEventListener("afterprint", finishPrint);
window.addEventListener("unload", cleanup);
startPrint().catch(showError);
