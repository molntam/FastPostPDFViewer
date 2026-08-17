Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hostName = "com.molntam.fast_post_pdf_printer"
$installDirectory = Join-Path $env:LOCALAPPDATA "FastPostPdfPrinter"
$registryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"

if (Test-Path -LiteralPath $registryPath) {
    Remove-Item -LiteralPath $registryPath -Recurse -Force
}
if (Test-Path -LiteralPath $installDirectory) {
    Remove-Item -LiteralPath $installDirectory -Recurse -Force
}

Write-Host "Fast POST PDF Printer bridge removed."
