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

The extension's loading screen stays over the embedded viewer. When Edge reports that the PDF is ready, the extension sends the viewer its print command. If automatic printing is blocked, the recovery controls can retry the command, reveal the Edge viewer or download the captured PDF.

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
- The captured PDF is limited to 128 MB.
- The original PDF is used as the print source; the extension creates no page images.
- PPM routing occurs after a PPM-installed printer is selected in Edge's print dialog.
- Edge and the Windows printer driver still control the final spool format and device rendering.
- If the automatic command does not open the dialog, select **Open print dialog** or **Show Edge viewer**.

## Why this is a trial

Windows Edge extensions do not have an API for submitting a PDF directly to an installed printer. This version instead uses the scripting interface exposed by Edge's embedded PDF viewer. The interface is inherited from Chromium, but Microsoft can change the Adobe-backed viewer integration independently. Test the exact label and document types used at work before replacing the current extension.

## Repository note

The existing PDF.js assets remain only to keep comparison with the canvas-printing branches simple. This branch does not import or execute them and does not require a native messaging host.
