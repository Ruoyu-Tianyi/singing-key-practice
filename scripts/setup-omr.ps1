param()
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This portable setup is for Windows x64 only. See server/README.md for other systems.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Audiveris requires Windows x64.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskTools = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Force -Path $taskTools | Out-Null
$python = (Get-Command python -ErrorAction Stop).Source

function Get-VerifiedDownload([string]$Url, [string]$Path, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Path) -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) {
        Write-Host "Downloading $([IO.Path]::GetFileName($Path)) from the official upstream..."
        Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
    }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA-256 mismatch: $Path. The downloaded file will not be executed or extracted."
    }
}

$installer = Join-Path $taskTools 'Audiveris-5.11.0-windowsConsole-x86_64.msi'
Get-VerifiedDownload `
    'https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi' `
    $installer `
    '5F1B4E96A12C53C7DA426814B76E599363C4181E291855996E0A6878DDA95F71'

$launcher = Join-Path $taskTools 'audiveris-portable/Audiveris/Audiveris.exe'
if (-not (Test-Path -LiteralPath $launcher)) {
    Write-Host 'Extracting official files read-only; the MSI installer is not run...'
    & $python (Join-Path $projectRoot 'server/extract_audiveris.py') $taskTools
    if ($LASTEXITCODE -ne 0) { throw 'Portable Audiveris extraction failed.' }
}
$languageDirectory = Join-Path $taskTools 'appdata/AudiverisLtd/audiveris/config/tessdata'
New-Item -ItemType Directory -Force -Path $languageDirectory | Out-Null
# Full tessdata includes the legacy engine models requested by Audiveris.
Get-VerifiedDownload `
    'https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0/eng.traineddata' `
    (Join-Path $languageDirectory 'eng.traineddata') `
    'DAA0C97D651C19FBA3B25E81317CD697E9908C8208090C94C3905381C23FC047'

Write-Host 'Portable Audiveris and its bundled Java are ready inside .tools.'
Write-Host 'Start the local recognition service with: .\server\start-omr.ps1'
