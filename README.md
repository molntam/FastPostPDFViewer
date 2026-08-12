# Fast POST PDF Viewer for Microsoft Edge 151+

This extension receives `application/pdf` responses directly from Edge's MIME-handler API. It works with PDFs returned by POST requests and single-use URLs without repeating the original request.

Version 1.0.3 captures the one-use PDF stream before loading PDF.js, initializes the viewer with PDF.js 6 correctly and prints at the PDF's exact page size using a 300 DPI raster.

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
- Native-viewer fallback before capture and PDF download recovery after capture

## Notes

- Edge 151 or newer is required.
- PDF.js is bundled locally; the extension makes no CDN request.
- Printing prepares the document at 300 DPI and declares the PDF's physical page size before opening the Windows print dialog.
- If two extensions register for PDFs, the most recently installed one becomes the active handler.
- A POST-generated PDF cannot be requested again as a normal GET. If rendering fails after capture, use **Download captured PDF** rather than reopening the original URL.

## Third-party software

This extension includes Mozilla PDF.js, licensed under the Apache License 2.0. Its license is included at `vendor/LICENSE`.
