Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hostName = "com.molntam.fast_post_pdf_printer"
$extensionId = "oimlipggfonleadilhogfoaekjenbkln"
$installDirectory = Join-Path $env:LOCALAPPDATA "FastPostPdfPrinter"
$hostExecutable = Join-Path $installDirectory "FastPostPdfPrinterHost.exe"
$hostManifest = Join-Path $installDirectory ($hostName + ".json")
$sourceFile = Join-Path $PSScriptRoot "FastPostPdfPrinterHost.cs"
$registryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"

$compilerCandidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) {
    throw "The Windows .NET Framework C# compiler was not found."
}
if (-not (Test-Path -LiteralPath $sourceFile)) {
    throw "FastPostPdfPrinterHost.cs is missing from the native-host folder."
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null

$compilerArguments = @(
    "/nologo",
    "/optimize+",
    "/target:winexe",
    "/out:$hostExecutable",
    "/reference:System.dll",
    "/reference:System.Core.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.Web.Extensions.dll",
    "/reference:System.Windows.Forms.dll",
    $sourceFile
)

& $compiler $compilerArguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExecutable)) {
    throw "The Windows printing bridge could not be compiled."
}

$manifestObject = [ordered]@{
    name = $hostName
    description = "Fast POST PDF Printer Windows bridge"
    path = $hostExecutable
    type = "stdio"
    allowed_origins = @(
        "chrome-extension://$extensionId/"
    )
}
$manifestJson = $manifestObject | ConvertTo-Json -Depth 4
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($hostManifest, $manifestJson, $utf8WithoutBom)

New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifest

Write-Host ""
Write-Host "Fast POST PDF Printer bridge installed."
Write-Host "Extension ID: $extensionId"
Write-Host "Host: $hostExecutable"
Write-Host ""
Write-Host "Reload the extension in edge://extensions before testing."
