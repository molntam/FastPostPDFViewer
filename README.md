# Fast POST PDF Printer Ultra for Microsoft Edge 151+

This extension receives `application/pdf` responses directly from Edge's MIME-handler API and opens the Windows print dialog automatically. It works with PDFs returned by POST requests and single-use URLs without repeating the original request.

Version 1.1.0 branches from the fast direct-canvas printer. It skips Edge and Adobe's PDF viewers, targets 1200 DPI, rotates every rendered page by 180 degrees and opens the print dialog immediately. The original PDF remains available for recovery, but browser security does not allow an extension to submit its bytes directly to a Windows printer queue.

The renderer uses the full 1200 DPI target for a typical single-page A4 document. For larger or multi-page documents it automatically reduces the effective DPI only when required to stay within safe browser canvas and memory limits. The loading card displays the actual DPI selected for each page.

The automatic printer only activates for PDFs whose original URL is on `https://solutions.inet-logistics.com`. PDFs from every other origin are returned to Edge's native viewer before their stream is consumed.

## Install

1. Extract the ZIP to a permanent folder. Do not load the extension directly from inside the ZIP.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Disable or remove the earlier **POST PDF Handler Test** extension.
5. Select **Load unpacked**.
6. Select the extracted `FastPostPdfViewer` folder.
7. Generate the POST-based PDF in the work system. The print dialog opens automatically when preparation finishes.

If an older copy is already loaded, select **Reload** on its extension card after replacing the files.

Close any PDF tabs opened with the previous version before testing the updated extension. A MIME stream belongs to the tab that originally received it and cannot be reused after an extension reload.

## Notes

- Edge 151 or newer is required.
- PDF.js is bundled locally; the extension makes no CDN request.
- Printing targets 1200 DPI, declares the PDF's physical page size and leaves a 6 mm safe margin before opening the Windows print dialog.
- Every page receives an additional 180-degree rotation to correct the upside-down output from the source documents.
- A single page may use up to 150 million pixels; the complete document is capped at 180 million pixels to prevent multi-page jobs from exhausting browser memory.
- The extension has no intermediate PDF viewer. After the print dialog closes, the popup closes automatically when Edge permits it; otherwise it shows a **Close window** button.
- The source check requires the exact HTTPS origin `https://solutions.inet-logistics.com`; HTTP, subdomains and similar-looking domains are not accepted.
- If two extensions register for PDFs, the most recently installed one becomes the active handler.
- A POST-generated PDF cannot be requested again as a normal GET. If preparation fails after capture, use **Download captured PDF** rather than reopening the original URL.

## Third-party software

This extension includes Mozilla PDF.js, licensed under the Apache License 2.0. Its license is included at `vendor/LICENSE`.
