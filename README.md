# Fast POST PDF PPM Printer for Microsoft Edge 151+

This experimental branch captures application/pdf responses from solutions.inet-logistics.com, including POST responses and single-use URLs, and submits the original PDF bytes to a Windows printer queue.

It does not render the PDF through PDF.js, canvas or PNG. Personal Print Manager/VPSX or the destination printer performs the final device conversion, preserving vector text and barcodes whenever the configured queue supports PDF.

## How it works

    POST-generated PDF
            |
            v
    Edge MIME-handler stream
            |
            v
    Extension keeps original PDF bytes
            |
            v
    Edge Native Messaging
            |
            v
    Windows native printing bridge
            |
            v
    Selected PPM-installed printer queue

The native Windows print dialog opens automatically after Edge releases the PDF stream. The intermediate PDF viewer is skipped completely.

## Install

1. Download or extract this branch to a permanent folder.
2. Open edge://extensions.
3. Enable Developer mode.
4. Disable or remove the earlier Fast POST PDF Printer extension.
5. Select Load unpacked and choose this folder.
6. Confirm that the extension ID is oimlipggfonleadilhogfoaekjenbkln.
7. Open Windows PowerShell normally.
8. Change to the native-host folder inside this extension.
9. Run .\install.ps1.
10. Return to edge://extensions and reload Fast POST PDF PPM Printer.
11. Generate a POST-based PDF in the work system.

The installer compiles the small Windows bridge with the .NET Framework compiler already included with Windows, copies it to %LOCALAPPDATA%\FastPostPdfPrinter, and registers it for the current Windows user. Administrator rights are not normally required.

## Printing

- Select one of the printers installed through Personal Print Manager in the Windows print dialog.
- The captured PDF is submitted to that queue as RAW PDF data.
- Copies are supported and are submitted as separate unchanged PDF jobs.
- PDF page size and orientation are retained.
- Raster DPI is not selected in the extension because the PDF remains vector. VPSX, its PDF transform or the printer renders at the configured device resolution.
- Driver-specific layout controls do not modify RAW data. Configure tray, media and printable-area behavior in the PPM/VPSX queue defaults.
- The direct-IP Ship printer can still be selected as a test or fallback only if that queue accepts PDF directly.

## Safety and fallback

- The automatic handler accepts only the exact HTTPS origin https://solutions.inet-logistics.com.
- The Windows bridge performs the same origin check and validates the PDF header.
- Only this extension's fixed ID is allowed to connect to the bridge.
- PDFs from other origins are returned to Edge before their stream is consumed.
- If the bridge is missing or a queue rejects the job, the captured PDF can be downloaded from the error screen.
- Captured PDFs are limited to 128 MB.

## Important queue requirement

The selected PPM/VPSX queue must accept PDF data or have an LRS transform that converts PDF to the printer's required language. LRS VPSX supports PDF data streams, but an organization's queue configuration determines whether RAW PDF submission is enabled.

## Uninstall the bridge

Run .\native-host\uninstall.ps1. It removes only the current-user Edge Native Messaging registration and %LOCALAPPDATA%\FastPostPdfPrinter.

## Repository note

The PDF.js assets remain in this branch so it can be compared easily with the browser-rendering branches, but this native-printing version never imports or executes them.
