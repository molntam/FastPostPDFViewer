# Windows Personal Print Manager bridge

The bridge receives the captured PDF from the Edge extension and submits its original bytes to the Windows printer selected in the native print dialog. Personal Print Manager-installed queues remain responsible for authentication, routing, auditing and any required PDF transformation.

## Install

1. Keep the complete extension folder in a permanent location.
2. Open Windows PowerShell normally. Administrator rights are not required because registration uses HKEY_CURRENT_USER.
3. Change to the native-host folder.
4. Run .\install.ps1.
5. Open edge://extensions and reload Fast POST PDF PPM Printer.

The extension contains a fixed public key, so its unpacked extension ID is always oimlipggfonleadilhogfoaekjenbkln. The installer allows only that extension ID to contact the bridge.

If company policy blocks PowerShell, executable compilation or Edge Native Messaging, the bridge must be packaged or approved by IT.

## Printing behavior

- The dialog lists the Windows printers currently installed for the user, including Personal Print Manager queues.
- The selected queue receives the captured PDF as a RAW data stream.
- Copies are submitted as separate jobs so that the PDF bytes remain untouched.
- DPI is intentionally not applied in the extension. Vector PDF content is rendered by VPSX, the destination printer or its configured transform at the device resolution.
- Printer-driver layout controls are not applied to a RAW job. Page size and orientation come from the PDF; queue defaults control device-specific options.

The queue must be configured to accept PDF data or transform PDF into the target printer language. LRS VPSX supports PDF data streams, but the exact queue configuration is controlled by the organization.

## Uninstall

Run .\uninstall.ps1 from this folder. It removes only the current-user native-host registration and %LOCALAPPDATA%\FastPostPdfPrinter.
