# Fast POST PDF Auto Printer for Microsoft Edge 151+

This experimental extension captures `application/pdf` responses from `https://solutions.inet-logistics.com`, including POST responses and single-use URLs, then opens the original PDF in Edge's built-in PDF engine and requests its print dialog automatically.

It does not parse, resize or rasterize the PDF through PDF.js or canvas. The selected Windows printer queue receives the job through Edge's normal printing pipeline, so printers installed through Personal Print Manager remain available and route through PPM automatically.

## Flow

    POST-generated PDF
            |
            v
    Edge MIME-handler stream
            |
            v
    Extension keeps original PDF bytes
            |
            v
    Embedded Edge PDF viewer
            |
            v
    Edge print dialog
            |
            v
    Selected PPM-installed printer

The extension handles only top-level PDF navigations. Its own embedded PDF therefore goes directly to Edge's native viewer instead of being intercepted and copied through the extension a second time. A tiny blank PDF starts the Edge PDF engine in an off-screen frame while the POST response is being received, overlapping Adobe's cold-start work with the download. Once the real PDF frame is ready, the extension hides the overlay and calls the browser's print command. Print-only styling removes the extension overlay from the job.

## Install

1. Download or extract this branch to a permanent folder.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Remove the earlier experimental Fast POST PDF extension, or replace its files in the same folder and reload it.
5. Select **Load unpacked** and choose this folder.
6. Generate a POST-based PDF in the work system.
7. Select a Personal Print Manager printer in the Edge print dialog.

If an older copy of this folder is already loaded, select **Reload** on its extension card after replacing the files. Close PDF tabs created by the previous version before testing because an intercepted MIME stream belongs to its original tab.

## Behavior

- The automatic handler accepts only the exact HTTPS origin `https://solutions.inet-logistics.com`.
- PDFs from every other origin are returned to Edge's native handler.
- Embedded PDFs are never intercepted, avoiding a second full pass through the extension.
- The captured PDF is limited to 128 MB.
- The original PDF is used as the print source; the extension creates no page images.
- PPM routing occurs after a PPM-installed printer is selected in Edge's print dialog.
- Edge and the Windows printer driver still control the final spool format and device rendering.
- If the automatic command does not open a usable dialog, select **Open print dialog** or **Show Edge viewer**. The latter exposes Edge's real PDF toolbar and its print button.

## Why this is a trial

Windows Edge extensions do not have an API for submitting a PDF directly to an installed printer. Edge's Adobe-backed viewer ignored the Chromium embedded-viewer print message in testing, so this version invokes the browser print command against the loaded PDF frame or its full-page host. Adobe still controls its own parsing time, but the extension now overlaps its startup with the download and no longer adds a second stream pass. Test the exact label and document types used at work before replacing the current extension.

## Repository note

The existing PDF.js assets remain only to keep comparison with the canvas-printing branches simple. This branch does not import or execute them and does not require a native messaging host.
