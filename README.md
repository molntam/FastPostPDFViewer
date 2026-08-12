# Fast POST PDF Viewer for Microsoft Edge 151+

This extension receives `application/pdf` responses directly from Edge's MIME-handler API. It works with PDFs returned by POST requests and single-use URLs without repeating the original request.

Version 1.0.1 captures the one-use PDF stream before loading PDF.js and reports the exact startup phase if Edge or the viewer fails.

## Install

1. Extract the ZIP to a permanent folder. Do not load the extension directly from inside the ZIP.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Disable or remove the earlier **POST PDF Handler Test** extension.
5. Select **Load unpacked**.
6. Select the extracted `FastPostPdfViewer` folder.
7. Open a PDF or generate the POST-based PDF in the work system.

If an older copy is already loaded, select **Reload** on its extension card after replacing the files.

Close any PDF tabs opened with the previous version before testing the updated extension. A MIME stream belongs to the tab that originally received it and cannot be reused after an extension reload.

## Included controls

- Fast, lazy page rendering with selectable text and working PDF links
- Page navigation and fit-width, fit-page and percentage zoom
- Search with `Ctrl+F`
- Download with `Ctrl+S`
- Print with `Ctrl+P`
- Clockwise rotation
- Per-document fallback to the built-in Edge viewer

## Notes

- Edge 151 or newer is required.
- PDF.js is bundled locally; the extension makes no CDN request.
- Printing prepares the document at 144 DPI before opening the Windows print dialog.
- If two extensions register for PDFs, the most recently installed one becomes the active handler.

## Third-party software

This extension includes Mozilla PDF.js, licensed under the Apache License 2.0. Its license is included at `vendor/LICENSE`.
