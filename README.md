# Fast POST PDF Memory Printer for Microsoft Edge 151+

This extension receives `application/pdf` responses directly from Edge's MIME-handler API and opens the Windows print dialog automatically. It works with PDFs returned by POST requests and single-use URLs without repeating the original request.

Version 1.2.0 preserves each PDF page's own orientation by default. The previous unconditional 180-degree rotation is now an optional correction saved locally for each Edge profile, so one user's printer workaround does not flip everyone else's output.

Clicking the page's web **Print** button still runs its `doPrintPDF()` action without allowing the normal `DispoPrint.pdf` download to reach disk. The PDF response is fetched with the current page session, stored in a temporary Blob and opened through the extension's fast 600 DPI canvas printer.

If the page uses an unsupported request mechanism or the response is not a PDF, the temporary popup closes and the original `doPrint()` function runs automatically.

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

## Printer orientation

- Leave **Printer correction** set to **Normal (recommended)** for most users. Each page retains its PDF rotation, including portrait, landscape and already-rotated pages.
- For the user who needed the old fix, click the extension in Edge's Extensions menu and select **Rotate 180°**. The same setting is available through **Details → Extension options** at `edge://extensions`. It saves automatically and applies to new print jobs; generate the PDF again if its print dialog is already open.
- The correction stays on this computer in the current Edge profile. It survives reloads and browser restarts but is removed if the extension is uninstalled. It is not synced to other computers or profiles.
- The setting applies to all printers used from that profile. If you switch printers, check it again. Edge's `window.print()` does not expose the chosen printer or its driver settings to this extension, so it cannot automatically detect which physical printer needs the workaround.
- If only the back of a two-sided sheet is upside down, check the printer's long-edge / short-edge binding setting. A whole-document 180-degree correction rotates both sides equally.

## Notes

- Edge 151 or newer is required.
- PDF.js is bundled locally; the extension makes no CDN request.
- Printing prepares the document at up to 600 DPI, declares the PDF's physical page size and leaves a 6 mm safe margin before opening the Windows print dialog.
- Print preparation avoids an extra full-PDF buffer copy and a redundant full-canvas white paint. PDF.js paints the white background itself; resolution, grayscale conversion and margins are unchanged. Canvas memory is explicitly released when the dialog closes, and worker cleanup now uses the bundled PDF.js version's loading-task API.
- Printed canvas content is permanently converted to grayscale. Edge may still display its normal color selector because extensions cannot lock printer-driver settings.
- The web Print interception applies only to the exact `https://solutions.inet-logistics.com` host.
- The normal Save as PDF button remains unchanged and can still download `DispoPrint.pdf` manually.
- Temporary PDF data is held in browser memory and its Blob URL is revoked after two minutes.
- The extension has no intermediate PDF viewer. After the print dialog closes, the popup closes automatically when Edge permits it; otherwise it shows a **Close window** button.
- The source check requires the exact HTTPS origin `https://solutions.inet-logistics.com`; HTTP, subdomains and similar-looking domains are not accepted.
- If two extensions register for PDFs, the most recently installed one becomes the active handler.
- A POST-generated PDF cannot be requested again as a normal GET. If preparation fails after capture, use **Download captured PDF** rather than reopening the original URL.

## Development checks

With Node.js 24 installed, run `npm ci`, `npm run check` and `npm test`. The canvas dependency is used only by the tests; the installed extension needs no Node.js packages.

The regression tests render synthetic PDFs through the bundled PDF.js at 600 DPI, check 0/90/180/270-degree page metadata with both correction modes, verify inherited rotation, compare pixels with the previous white-background rendering, and check profile isolation, settings errors, recovery downloads and cleanup.

Before distributing an update, print the same sample on a normal workstation with **Normal** selected and on the affected workstation with **Rotate 180°** selected. Check a two-page duplex job with the intended binding edge too. Automated tests cannot validate a physical printer's driver or paper-feed behavior.

## Third-party software

This extension includes Mozilla PDF.js, licensed under the Apache License 2.0. Its license is included at `vendor/LICENSE`.
