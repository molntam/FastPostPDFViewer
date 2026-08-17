(() => {
  const WEB_PRINT_PATTERN = /\bdoPrint\s*\(/;
  const PDF_PRINT_PATTERN = /\bdoPrintPDF\s*\(/;
  const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
  let handlingPrint = false;

  function findWebPrintLink(target) {
    const link = target instanceof Element ? target.closest("a") : null;
    const handler = link?.getAttribute("onclick") || "";
    return WEB_PRINT_PATTERN.test(handler) && !PDF_PRINT_PATTERN.test(handler)
      ? link
      : null;
  }

  function createFormRequest(form, submitter = null) {
    const method = (form.method || "GET").toUpperCase();
    const url = new URL(form.action || location.href, location.href);
    const formData = submitter
      ? new FormData(form, submitter)
      : new FormData(form);
    const options = {
      method,
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "application/pdf, application/octet-stream;q=0.9, */*;q=0.8",
      },
    };

    if (method === "GET") {
      for (const [name, value] of formData) {
        if (typeof value === "string") {
          url.searchParams.append(name, value);
        }
      }
      return { url: url.href, options };
    }

    if ((form.enctype || "").toLowerCase() === "multipart/form-data") {
      options.body = formData;
    } else {
      const body = new URLSearchParams();
      for (const [name, value] of formData) {
        if (typeof value === "string") {
          body.append(name, value);
        }
      }
      options.body = body;
    }

    return { url: url.href, options };
  }

  function capturePdfRequest(printWindow) {
    if (typeof window.doPrintPDF !== "function") {
      throw new Error("doPrintPDF() is unavailable on this page");
    }

    const nativeSubmit = HTMLFormElement.prototype.submit;
    const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    const nativeOpen = window.open;
    let request = null;

    HTMLFormElement.prototype.submit = function submit() {
      request ||= createFormRequest(this);
    };
    HTMLFormElement.prototype.requestSubmit = function requestSubmit(submitter) {
      request ||= createFormRequest(this, submitter);
    };
    HTMLAnchorElement.prototype.click = function click() {
      if (this.href) {
        request ||= {
          url: new URL(this.href, location.href).href,
          options: { credentials: "include", cache: "no-store" },
        };
        return;
      }
      nativeAnchorClick.call(this);
    };
    window.open = function open(url) {
      if (url && url !== "about:blank") {
        request ||= {
          url: new URL(url, location.href).href,
          options: { credentials: "include", cache: "no-store" },
        };
      }
      return printWindow;
    };

    try {
      window.doPrintPDF();
    } finally {
      HTMLFormElement.prototype.submit = nativeSubmit;
      HTMLFormElement.prototype.requestSubmit = nativeRequestSubmit;
      HTMLAnchorElement.prototype.click = nativeAnchorClick;
      window.open = nativeOpen;
    }

    if (!request) {
      throw new Error("The PDF action did not expose a form submission or URL");
    }
    return request;
  }

  function validatePdf(buffer) {
    const bytes = new Uint8Array(buffer);
    const searchLength = Math.min(bytes.length, 1024);
    for (let offset = 0; offset <= searchLength - PDF_SIGNATURE.length; offset += 1) {
      if (PDF_SIGNATURE.every((value, index) => bytes[offset + index] === value)) {
        return;
      }
    }
    throw new Error("The Save as PDF action did not return a PDF document");
  }

  function showPreparingPage(printWindow) {
    printWindow.document.title = "Preparing PDF print";
    printWindow.document.body.textContent = "Loading PDF into browser memory…";
    Object.assign(printWindow.document.body.style, {
      margin: "0",
      display: "grid",
      placeItems: "center",
      minHeight: "100vh",
      font: "16px Segoe UI, sans-serif",
      color: "#f1f3f4",
      background: "#202124",
    });
  }

  function runOriginalWebPrint() {
    if (typeof window.doPrint === "function") {
      window.doPrint();
    } else {
      window.print();
    }
  }

  async function handleWebPrint(event) {
    if (
      handlingPrint
      || event.button !== 0
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || !findWebPrintLink(event.target)
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    handlingPrint = true;

    const printWindow = window.open(
      "about:blank",
      "FastPostPdfMemoryPrint",
      "popup,width=1100,height=900",
    );
    if (!printWindow) {
      handlingPrint = false;
      runOriginalWebPrint();
      return;
    }

    try {
      showPreparingPage(printWindow);
      const request = capturePdfRequest(printWindow);
      const requestUrl = new URL(request.url, location.href);
      if (requestUrl.origin !== location.origin) {
        throw new Error("Refusing to fetch a PDF outside the current site");
      }
      const response = await fetch(requestUrl.href, request.options);
      if (!response.ok) {
        throw new Error(`The PDF request returned HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      validatePdf(buffer);
      const pdfUrl = URL.createObjectURL(
        new Blob([buffer], { type: "application/pdf" }),
      );
      printWindow.location.replace(pdfUrl);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 120000);
    } catch (error) {
      console.error("In-memory PDF printing failed; using the original web print.", error);
      printWindow.close();
      runOriginalWebPrint();
    } finally {
      handlingPrint = false;
    }
  }

  document.addEventListener("click", handleWebPrint, true);
})();
