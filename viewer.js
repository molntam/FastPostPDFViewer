const elements = {
  busyOverlay: document.getElementById("busyOverlay"),
  busyProgress: document.getElementById("busyProgress"),
  busyText: document.getElementById("busyText"),
  closeFind: document.getElementById("closeFind"),
  customZoom: document.getElementById("customZoom"),
  documentTitle: document.getElementById("documentTitle"),
  downloadButton: document.getElementById("downloadButton"),
  errorFallback: document.getElementById("errorFallback"),
  findBar: document.getElementById("findBar"),
  findButton: document.getElementById("findButton"),
  findInput: document.getElementById("findInput"),
  findNext: document.getElementById("findNext"),
  findPrevious: document.getElementById("findPrevious"),
  findResults: document.getElementById("findResults"),
  nativeButton: document.getElementById("nativeButton"),
  nextPage: document.getElementById("nextPage"),
  pageCount: document.getElementById("pageCount"),
  pageNumber: document.getElementById("pageNumber"),
  previousPage: document.getElementById("previousPage"),
  printButton: document.getElementById("printButton"),
  printContainer: document.getElementById("printContainer"),
  rotateButton: document.getElementById("rotateButton"),
  toast: document.getElementById("toast"),
  viewer: document.getElementById("viewer"),
  viewerContainer: document.getElementById("viewerContainer"),
  zoomIn: document.getElementById("zoomIn"),
  zoomMode: document.getElementById("zoomMode"),
  zoomOut: document.getElementById("zoomOut"),
  zoomValue: document.getElementById("zoomValue"),
};

const PDF_POINTS_PER_INCH = 72;
const PRINT_RESOLUTION = 300;

let blobUrl = null;
let currentPhase = "starting the viewer";
let documentBlob = null;
let documentName = "document.pdf";
let eventBus = null;
let findController = null;
let FindState = null;
let linkService = null;
let pdfDocument = null;
let pdfjsLib = null;
let pdfViewer = null;
let printCleanupTimer = null;
let printPageStyleSheet = null;
let printUrls = [];
let printing = false;
let streamInfo = null;
let toastTimer = null;

function setBusy(message, progress = null) {
  elements.busyOverlay.hidden = false;
  elements.busyOverlay.querySelector(".busy-card").classList.remove("error");
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

function clearBusy() {
  elements.busyOverlay.hidden = true;
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

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
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

function prepareDocumentBlob(buffer) {
  documentBlob = new Blob([buffer], { type: "application/pdf" });
  blobUrl = URL.createObjectURL(documentBlob);
  documentName = resolveDocumentName(streamInfo);
  document.title = documentName;
  elements.documentTitle.textContent = documentName;
  elements.documentTitle.title = streamInfo.originalUrl || documentName;
  elements.downloadButton.disabled = false;
}

async function loadViewerLibraries() {
  setPhase("Loading fast viewer");
  pdfjsLib = await import("./vendor/pdf.min.mjs");
  globalThis.pdfjsLib = pdfjsLib;

  const viewerLibrary = await import("./vendor/pdf_viewer.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "vendor/pdf.worker.min.mjs",
  );
  return viewerLibrary;
}

function initializeViewer(viewerLibrary) {
  const {
    EventBus,
    FindState: ViewerFindState,
    LinkTarget,
    PDFFindController,
    PDFLinkService,
    PDFViewer,
  } = viewerLibrary;

  FindState = ViewerFindState;
  eventBus = new EventBus();
  linkService = new PDFLinkService({
    eventBus,
    externalLinkTarget: LinkTarget.BLANK,
  });
  findController = new PDFFindController({ eventBus, linkService });
  pdfViewer = new PDFViewer({
    container: elements.viewerContainer,
    viewer: elements.viewer,
    eventBus,
    linkService,
    findController,
    imageResourcesPath: chrome.runtime.getURL("vendor/images/"),
  });

  linkService.setViewer(pdfViewer);
  bindViewerEvents();
}

function updatePageControls(pageNumber) {
  elements.pageNumber.value = String(pageNumber);
  elements.previousPage.disabled = pageNumber <= 1;
  elements.nextPage.disabled = !pdfDocument || pageNumber >= pdfDocument.numPages;
}

function goToPage() {
  if (!pdfDocument || !pdfViewer) {
    return;
  }

  const requested = Number.parseInt(elements.pageNumber.value, 10);
  const page = Number.isFinite(requested)
    ? Math.max(1, Math.min(pdfDocument.numPages, requested))
    : pdfViewer.currentPageNumber;

  pdfViewer.currentPageNumber = page;
  updatePageControls(page);
}

function dispatchFind(type = "", findPrevious = false) {
  if (!eventBus) {
    return;
  }

  eventBus.dispatch("find", {
    source: window,
    type,
    query: elements.findInput.value,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
  });
}

function openFind() {
  elements.findBar.hidden = false;
  elements.findInput.focus();
  elements.findInput.select();
}

function closeFind() {
  elements.findBar.hidden = true;
  elements.findResults.textContent = "";
  eventBus?.dispatch("findbarclose", { source: window });
  elements.viewerContainer.focus();
}

function updateFindResults(matchesCount) {
  const { current = 0, total = 0 } = matchesCount || {};
  elements.findResults.textContent = total ? `${current} of ${total}` : "No results";
}

async function fallbackToEdge() {
  if (documentBlob) {
    showToast("The POST PDF is already captured. Download it to open it externally.");
    return;
  }

  try {
    await chrome.mimeHandler.abortAndFallbackToNativeHandler();
  } catch (error) {
    showToast(`Edge viewer could not be opened: ${error.message}`);
  }
}

function recoverFromError() {
  if (blobUrl) {
    downloadDocument();
    return;
  }
  fallbackToEdge();
}

function downloadDocument() {
  if (!blobUrl) {
    return;
  }

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = documentName;
  link.click();
  showToast("PDF downloaded");
}

function blobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("A print page could not be prepared"));
      }
    }, "image/png");
  });
}

function cleanupPrint() {
  clearTimeout(printCleanupTimer);
  printCleanupTimer = null;
  if (printPageStyleSheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (styleSheet) => styleSheet !== printPageStyleSheet,
    );
    printPageStyleSheet = null;
  }
  for (const url of printUrls) {
    URL.revokeObjectURL(url);
  }
  printUrls = [];
  elements.printContainer.replaceChildren();
  printing = false;
  elements.printButton.disabled = !pdfDocument;
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
    `@page { size: ${width.toFixed(3)}pt ${height.toFixed(3)}pt; margin: 0; }`,
  );
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets,
    printPageStyleSheet,
  ];
}

async function printDocument() {
  if (!pdfDocument || !pdfViewer || printing) {
    return;
  }

  printing = true;
  elements.printButton.disabled = true;
  elements.printContainer.replaceChildren();
  const previousTitle = document.title;

  try {
    const printUnits = PRINT_RESOLUTION / PDF_POINTS_PER_INCH;
    const rotationOffset = pdfViewer.pagesRotation;
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
      const rotation = (page.rotate + rotationOffset) % 360;
      const printViewport = page.getViewport({ scale: 1, rotation });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });

      pageSizes.push({
        width: printViewport.width,
        height: printViewport.height,
      });
      canvas.width = Math.floor(printViewport.width * printUnits);
      canvas.height = Math.floor(printViewport.height * printUnits);
      context.fillStyle = "rgb(255, 255, 255)";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvasContext: context,
        transform: [printUnits, 0, 0, printUnits, 0, 0],
        viewport: printViewport,
        intent: "print",
        optionalContentConfigPromise,
      }).promise;

      const imageBlob = await blobFromCanvas(canvas);
      const imageUrl = URL.createObjectURL(imageBlob);
      const wrapper = document.createElement("div");
      const image = document.createElement("img");

      printUrls.push(imageUrl);
      wrapper.className = "print-page";
      image.src = imageUrl;
      image.alt = `Page ${pageNumber}`;
      wrapper.append(image);
      elements.printContainer.append(wrapper);
      await image.decode();

      canvas.width = 1;
      canvas.height = 1;
    }

    setPrintPageSize(pageSizes);
    clearBusy();
    document.title = documentName;
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.print();
  } catch (error) {
    clearBusy();
    cleanupPrint();
    showToast(`Printing failed: ${error.message}`);
  } finally {
    document.title = previousTitle;
    if (printing) {
      printCleanupTimer = setTimeout(cleanupPrint, 300000);
    }
  }
}

function bindControls() {
  elements.previousPage.addEventListener("click", () => pdfViewer?.previousPage());
  elements.nextPage.addEventListener("click", () => pdfViewer?.nextPage());
  elements.pageNumber.addEventListener("change", goToPage);
  elements.pageNumber.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      goToPage();
      elements.viewerContainer.focus();
    }
  });

  elements.zoomOut.addEventListener("click", () => pdfViewer?.decreaseScale());
  elements.zoomIn.addEventListener("click", () => pdfViewer?.increaseScale());
  elements.zoomMode.addEventListener("change", () => {
    if (pdfViewer && elements.zoomMode.value !== "custom") {
      pdfViewer.currentScaleValue = elements.zoomMode.value;
    }
  });
  elements.rotateButton.addEventListener("click", () => {
    if (pdfViewer) {
      pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
    }
  });

  elements.findButton.addEventListener("click", openFind);
  elements.findInput.addEventListener("input", () => dispatchFind());
  elements.findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      dispatchFind("again", event.shiftKey);
    } else if (event.key === "Escape") {
      closeFind();
    }
  });
  elements.findPrevious.addEventListener("click", () => dispatchFind("again", true));
  elements.findNext.addEventListener("click", () => dispatchFind("again", false));
  elements.closeFind.addEventListener("click", closeFind);

  elements.downloadButton.addEventListener("click", downloadDocument);
  elements.printButton.addEventListener("click", printDocument);
  elements.nativeButton.addEventListener("click", fallbackToEdge);
  elements.errorFallback.addEventListener("click", recoverFromError);

  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "f") {
      event.preventDefault();
      openFind();
    } else if (key === "p") {
      event.preventDefault();
      printDocument();
    } else if (key === "s") {
      event.preventDefault();
      downloadDocument();
    } else if ((key === "+" || key === "=") && pdfViewer) {
      event.preventDefault();
      pdfViewer.increaseScale();
    } else if (key === "-" && pdfViewer) {
      event.preventDefault();
      pdfViewer.decreaseScale();
    } else if (key === "0" && pdfViewer) {
      event.preventDefault();
      pdfViewer.currentScaleValue = "page-width";
    }
  });
}

function bindViewerEvents() {
  eventBus.on("pagesinit", () => {
    pdfViewer.currentScaleValue = "page-width";
    elements.pageCount.textContent = String(pdfDocument.numPages);
    updatePageControls(1);
  });

  eventBus.on("pagerendered", ({ pageNumber }) => {
    if (pageNumber === pdfViewer.currentPageNumber) {
      clearBusy();
    }
  });

  eventBus.on("pagechanging", ({ pageNumber }) => {
    updatePageControls(pageNumber);
  });

  eventBus.on("scalechanging", ({ scale, presetValue }) => {
    elements.zoomValue.textContent = `${Math.round(scale * 100)}%`;
    const optionExists = [...elements.zoomMode.options].some(
      (option) => option.value === String(presetValue),
    );
    if (optionExists) {
      elements.zoomMode.value = String(presetValue);
    } else {
      elements.customZoom.textContent = `${Math.round(scale * 100)}%`;
      elements.zoomMode.value = "custom";
    }
  });

  eventBus.on("updatefindmatchescount", ({ matchesCount }) => {
    updateFindResults(matchesCount);
  });

  eventBus.on("updatefindcontrolstate", ({ state, matchesCount }) => {
    updateFindResults(matchesCount);
    elements.findInput.classList.toggle("not-found", state === FindState.NOT_FOUND);
  });
}

async function parsePdf(buffer) {
  setPhase("Parsing PDF", 0);

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
      fallbackToEdge();
      return;
    }
    updatePassword(password);
  };

  pdfDocument = await loadingTask.promise;
  elements.printButton.disabled = false;
  setPhase("Rendering first page");
  pdfViewer.setDocument(pdfDocument);
  linkService.setDocument(pdfDocument, streamInfo.originalUrl || null);
}

async function startViewer() {
  const buffer = await capturePdfStream();
  prepareDocumentBlob(buffer);
  const viewerLibrary = await loadViewerLibraries();
  initializeViewer(viewerLibrary);
  await parsePdf(buffer);
}

bindControls();

window.addEventListener("error", (event) => {
  if (!elements.busyOverlay.hidden) {
    showError(event.error || new Error(event.message));
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (!elements.busyOverlay.hidden) {
    showError(event.reason);
  }
});

window.addEventListener("afterprint", cleanupPrint);
window.addEventListener("unload", () => {
  cleanupPrint();
  pdfDocument?.destroy();
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
  }
});

startViewer().catch(showError);
