const elements = {
  actions: document.getElementById("actions"),
  busyOverlay: document.getElementById("busyOverlay"),
  busyProgress: document.getElementById("busyProgress"),
  busyText: document.getElementById("busyText"),
  downloadPdf: document.getElementById("downloadPdf"),
  openViewer: document.getElementById("openViewer"),
  pdfFrame: document.getElementById("pdfFrame"),
  retryPrint: document.getElementById("retryPrint"),
};

const ALLOWED_PDF_ORIGIN = "https://solutions.inet-logistics.com";
const MAX_PDF_BYTES = 128 * 1024 * 1024;
const AUTO_PRINT_DELAY_MS = 750;
const RECOVERY_DELAY_MS = 12000;

let blobUrl = null;
let currentPhase = "preparing the print";
let documentName = "document.pdf";
let frameLoadSequence = 0;
let pdfFrameStarted = false;
let printInProgress = false;
let printedSequence = -1;
let recoveryTimer = null;
let streamInfo = null;

function setBusy(message, progress = null) {
  elements.busyOverlay.hidden = false;
  elements.busyOverlay.querySelector(".busy-card").classList.remove("error");
  elements.busyText.textContent = message;
  elements.actions.hidden = true;

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
  setBusy(phase + "…", progress);
}

function showActions(message) {
  elements.busyOverlay.hidden = false;
  elements.busyText.textContent = message;
  elements.busyProgress.hidden = true;
  elements.actions.hidden = false;
  const pdfReady = Boolean(blobUrl && frameLoadSequence);
  elements.retryPrint.hidden = !pdfReady;
  elements.openViewer.textContent = pdfReady
    ? "Show Edge viewer"
    : streamInfo
      ? "Open Edge viewer"
      : "Close window";
  elements.downloadPdf.hidden = !blobUrl;
}

function showError(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  console.error(value);
  elements.busyOverlay.querySelector(".busy-card").classList.add("error");
  showActions(
    "Stopped while " + currentPhase.toLowerCase()
      + ": " + value.name + ": " + value.message,
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(0) + " KB";
  }
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
  return filename.toLowerCase().endsWith(".pdf") ? filename : filename + ".pdf";
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

function isOwnEmbeddedBlob(info) {
  if (!info.embedded || !info.originalUrl.startsWith("blob:")) {
    return false;
  }

  try {
    return new URL(info.originalUrl.slice(5)).origin === location.origin;
  } catch {
    return false;
  }
}

async function fallbackToEdge(info) {
  if (isOwnEmbeddedBlob(info)) {
    const response = await fetch(info.streamUrl);
    if (!response.ok) {
      throw new Error("The embedded PDF stream returned HTTP " + response.status);
    }
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (!(await reader.read()).done) {
        // Drain the stream so Edge can replay its cached body in the built-in viewer.
      }
    } else {
      await response.arrayBuffer();
    }
  }

  await chrome.mimeHandler.abortAndFallbackToNativeHandler();
}

async function readStreamResponse(response) {
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error("The PDF exceeds the 128 MB auto-printing limit");
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  const declaredLength = Number(response.headers.get("content-length"))
    || Number(getResponseHeader(streamInfo.responseHeaders, "content-length"))
    || 0;
  let received = 0;

  if (declaredLength > MAX_PDF_BYTES) {
    throw new Error("The PDF exceeds the 128 MB auto-printing limit");
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    received += value.byteLength;
    if (received > MAX_PDF_BYTES) {
      await reader.cancel();
      throw new Error("The PDF exceeds the 128 MB auto-printing limit");
    }

    if (declaredLength) {
      const percent = received / declaredLength * 100;
      setBusy("Receiving PDF… " + Math.min(100, Math.round(percent)) + "%", percent);
    } else {
      setBusy("Receiving PDF… " + formatBytes(received));
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

function validatePdf(buffer) {
  const bytes = new Uint8Array(buffer);
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
  const searchLength = Math.min(bytes.length, 1024);

  for (let offset = 0; offset <= searchLength - signature.length; offset += 1) {
    let match = true;
    for (let index = 0; index < signature.length; index += 1) {
      if (bytes[offset + index] !== signature[index]) {
        match = false;
        break;
      }
    }
    if (match) {
      return;
    }
  }

  throw new Error("The captured response does not contain a valid PDF header");
}

async function capturePdfStream() {
  setPhase("Connecting to Edge PDF stream");

  if (!chrome.mimeHandler) {
    throw new Error("The MIME handler API is unavailable. Microsoft Edge 151 or newer is required.");
  }

  streamInfo = await chrome.mimeHandler.getStreamInfo();
  if (!isAllowedSourceUrl(streamInfo.originalUrl)) {
    setPhase("Opening PDF in Edge viewer");
    await fallbackToEdge(streamInfo);
    return null;
  }

  documentName = resolveDocumentName(streamInfo);
  document.title = documentName;
  setPhase("Receiving PDF");

  const slowStreamTimer = setTimeout(() => {
    if (currentPhase === "Receiving PDF") {
      elements.busyText.textContent = "Edge is still receiving the PDF from the work system.";
    }
  }, RECOVERY_DELAY_MS);

  try {
    const response = await fetch(streamInfo.streamUrl);
    if (!response.ok) {
      throw new Error("The PDF stream returned HTTP " + response.status);
    }
    return await readStreamResponse(response);
  } finally {
    clearTimeout(slowStreamTimer);
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

function postToPdfViewer(message) {
  elements.pdfFrame.contentWindow?.postMessage(message, "*");
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function requestPrint(sequence, force = false) {
  if (
    sequence !== frameLoadSequence
    || printInProgress
    || (!force && printedSequence === sequence)
  ) {
    return;
  }

  printedSequence = sequence;
  printInProgress = true;
  clearTimeout(recoveryTimer);
  currentPhase = "opening the browser print dialog";
  elements.busyOverlay.hidden = true;
  elements.pdfFrame.focus();
  await nextPaint();

  try {
    try {
      const frameWindow = elements.pdfFrame.contentWindow;
      if (!frameWindow) {
        throw new Error("The PDF frame is unavailable");
      }
      frameWindow.print();
    } catch (error) {
      console.info("Direct PDF-frame printing was unavailable; printing the host page.", error);
      window.print();
    }
  } finally {
    printInProgress = false;
    showActions(
      "Print dialog closed. If its preview was not correct, show the Edge viewer and use its print button.",
    );
  }
}

function handlePdfFrameLoad() {
  if (!pdfFrameStarted) {
    return;
  }

  frameLoadSequence += 1;
  const sequence = frameLoadSequence;
  postToPdfViewer({ type: "getSelectedText" });

  setTimeout(() => {
    requestPrint(sequence).catch(showError);
  }, AUTO_PRINT_DELAY_MS);
}

function handlePdfViewerMessage(event) {
  if (event.source !== elements.pdfFrame.contentWindow || event.data?.type !== "documentLoaded") {
    return;
  }

  requestPrint(frameLoadSequence).catch(showError);
}

async function showEmbeddedViewer() {
  if (!blobUrl) {
    if (streamInfo) {
      await fallbackToEdge(streamInfo);
    } else {
      window.close();
    }
    return;
  }

  clearTimeout(recoveryTimer);
  elements.busyOverlay.hidden = true;
  elements.pdfFrame.focus();
}

function cleanup() {
  clearTimeout(recoveryTimer);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  }
}

async function startPrint() {
  const buffer = await capturePdfStream();
  if (!buffer) {
    return;
  }

  validatePdf(buffer);
  blobUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  setPhase("Loading original PDF in Edge");
  pdfFrameStarted = true;
  elements.pdfFrame.src = blobUrl;
}

elements.pdfFrame.addEventListener("load", handlePdfFrameLoad);
elements.retryPrint.addEventListener("click", () => {
  requestPrint(frameLoadSequence, true).catch(showError);
});
elements.openViewer.addEventListener("click", () => showEmbeddedViewer().catch(showError));
elements.downloadPdf.addEventListener("click", downloadCapturedPdf);
window.addEventListener("message", handlePdfViewerMessage);
window.addEventListener("unload", cleanup);
startPrint().catch(showError);
