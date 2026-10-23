param(
    [string]$AllowedOrigins = 'http://localhost:5173,http://127.0.0.1:5173,https://ruoyu-tianyi.github.io',
    [ValidateRange(1024,65535)][int]$Port = 8765
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskTools = Join-Path $projectRoot '.tools'
$launcher = Join-Path $taskTools 'audiveris-portable/Audiveris/Audiveris.exe'
if (-not (Test-Path -LiteralPath $launcher)) { throw 'Run .\scripts\setup-omr.ps1 first.' }
foreach ($folder in @('home','tmp','appdata','localappdata')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $taskTools $folder) | Out-Null
}
$python = (Get-Command python -ErrorAction Stop).Source
$child = New-Object System.Diagnostics.ProcessStartInfo
$child.FileName = $python
$child.Arguments = '"' + (Join-Path $projectRoot 'server/omr_server.py') + '"'
$child.WorkingDirectory = $projectRoot
$child.UseShellExecute = $false
$child.CreateNoWindow = $true
# Change only this child's environment, never the user's persistent configuration.
$child.EnvironmentVariables['AUDIVERIS_BIN'] = $launcher
$child.EnvironmentVariables['OMR_ALLOWED_ORIGINS'] = $AllowedOrigins
$child.EnvironmentVariables['OMR_PORT'] = [string]$Port
$child.EnvironmentVariables['APPDATA'] = Join-Path $taskTools 'appdata'
$child.EnvironmentVariables['LOCALAPPDATA'] = Join-Path $taskTools 'localappdata'
$child.EnvironmentVariables['TEMP'] = Join-Path $taskTools 'tmp'
$child.EnvironmentVariables['TMP'] = Join-Path $taskTools 'tmp'
$javaHome = (Join-Path $taskTools 'home').Replace('\','/')
$javaTmp = (Join-Path $taskTools 'tmp').Replace('\','/')
$child.EnvironmentVariables['JAVA_TOOL_OPTIONS'] = '-Djava.awt.headless=true "-Duser.home=' + $javaHome + '" "-Djava.io.tmpdir=' + $javaTmp + '"'
# The official launcher declares -Xmx8G; _JAVA_OPTIONS takes final precedence.
$child.EnvironmentVariables['_JAVA_OPTIONS'] = '-Xmx1536m'
$process = [Diagnostics.Process]::Start($child)
Write-Host "Local OMR service: http://127.0.0.1:$Port/api/recognize"
Write-Host 'Press Ctrl+C to stop. Runtime, cache and logs stay inside .tools.'
try { $process.WaitForExit() }
finally {
    if (-not $process.HasExited) {
        # Stop only the service we started and its owned Java process tree.
        & taskkill.exe /PID ([string]$process.Id) /T /F *> $null
    }
    $process.Dispose()
}
