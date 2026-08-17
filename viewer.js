const elements = {
  busyOverlay: document.getElementById("busyOverlay"),
  busyProgress: document.getElementById("busyProgress"),
  busyText: document.getElementById("busyText"),
  errorFallback: document.getElementById("errorFallback"),
};

const ALLOWED_PDF_ORIGIN = "https://solutions.inet-logistics.com";
const NATIVE_HOST_NAME = "com.molntam.fast_post_pdf_printer";
const MAX_PDF_BYTES = 128 * 1024 * 1024;

let blobUrl = null;
let currentPhase = "preparing the print job";
let documentName = "document.pdf";
let printFinished = false;
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
  setBusy(phase + "…", progress);
}

function normalizeNativeHostError(error) {
  const value = error instanceof Error ? error : new Error(String(error));
  const message = value.message.toLowerCase();

  if (message.includes("native messaging host") || message.includes("native host")) {
    return new Error(
      "The Windows printing bridge is not installed or is unavailable. Run native-host\\install.ps1, reload the extension, and try again.",
    );
  }

  return value;
}

function showError(error) {
  const value = normalizeNativeHostError(error);
  console.error(value);
  elements.busyOverlay.hidden = false;
  elements.busyOverlay.querySelector(".busy-card").classList.add("error");
  elements.busyText.textContent = "Stopped while " + currentPhase.toLowerCase()
    + ": " + value.name + ": " + value.message;
  elements.busyProgress.hidden = true;
  elements.errorFallback.textContent = blobUrl
    ? "Download captured PDF"
    : "Open in Edge viewer";
  elements.errorFallback.hidden = false;
}

function setDone(message) {
  printFinished = true;
  elements.busyOverlay.hidden = false;
  elements.busyOverlay.querySelector(".busy-card").classList.add("done");
  elements.busyText.textContent = message;
  elements.busyProgress.hidden = true;
  elements.errorFallback.textContent = "Close window";
  elements.errorFallback.hidden = false;
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
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error("The PDF exceeds the 128 MB native-printing limit");
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
    throw new Error("The PDF exceeds the 128 MB native-printing limit");
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
      throw new Error("The PDF exceeds the 128 MB native-printing limit");
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
    await chrome.mimeHandler.abortAndFallbackToNativeHandler();
    return null;
  }

  documentName = resolveDocumentName(streamInfo);
  document.title = documentName;
  setPhase("Receiving PDF");

  const slowStreamTimer = setTimeout(() => {
    if (currentPhase === "Receiving PDF") {
      elements.busyText.textContent =
        "Edge has not released the PDF stream yet. You can wait or use the Edge viewer fallback.";
      elements.errorFallback.hidden = false;
    }
  }, 12000);

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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("The PDF could not be encoded"));
    reader.onload = () => {
      const value = String(reader.result || "");
      const separator = value.indexOf(",");
      if (separator < 0) {
        reject(new Error("The PDF could not be encoded"));
        return;
      }
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function sendToNativePrinter(payload) {
  return new Promise((resolve, reject) => {
    let port;
    let settled = false;

    function complete(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
      try {
        port?.disconnect();
      } catch {
        // The native host already closed.
      }
    }

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (error) {
      reject(error);
      return;
    }

    port.onMessage.addListener((response) => {
      if (response?.ok || response?.cancelled) {
        complete(resolve, response);
        return;
      }
      complete(reject, new Error(response?.error || "The native printer rejected the job"));
    });

    port.onDisconnect.addListener(() => {
      if (settled) {
        return;
      }
      const message = chrome.runtime.lastError?.message
        || "The native printing bridge closed before returning a result";
      complete(reject, new Error(message));
    });

    try {
      port.postMessage(payload);
    } catch (error) {
      complete(reject, error);
    }
  });
}

function cleanup() {
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
  const pdfBlob = new Blob([buffer], { type: "application/pdf" });
  blobUrl = URL.createObjectURL(pdfBlob);

  setPhase("Sending original PDF to Personal Print Manager", 100);
  const response = await sendToNativePrinter({
    action: "printPdf",
    fileName: documentName,
    sourceUrl: streamInfo.originalUrl,
    pdfBase64: await blobToBase64(pdfBlob),
  });

  if (response.cancelled) {
    setDone("Printing cancelled. You can close this window.");
    window.close();
    return;
  }

  const printerName = response.printerName || "the selected printer";
  const jobCount = Array.isArray(response.jobIds) ? response.jobIds.length : 1;
  setDone(
    "Original PDF sent to " + printerName + " as "
      + jobCount + (jobCount === 1 ? " print job." : " print jobs."),
  );
  window.close();
}

elements.errorFallback.addEventListener("click", handleRecovery);
window.addEventListener("unload", cleanup);
startPrint().catch(showError);
