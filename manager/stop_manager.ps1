$ErrorActionPreference = 'SilentlyContinue'
$serverPath = Join-Path $PSScriptRoot 'server.js'
$port = if ($env:BINDER_PORT -match '^\d+$') { [int]$env:BINDER_PORT } else { 3889 }
$findManager = {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverPath) })
}
$processes = & $findManager
if (-not $processes) {
  Write-Host 'Manager is not running.'
  exit 0
}

try {
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$port/api/shutdown" `
    -ContentType 'application/json' -Body '{"closeBrowsers":true}' -TimeoutSec 18 | Out-Null
} catch { }

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  $processes = & $findManager
  if (-not $processes) {
    Write-Host 'Manager and game browser windows stopped.'
    exit 0
  }
}

foreach ($process in $processes) {
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)"
  Stop-Process -Id $process.ProcessId -Force
  if ($parent -and $parent.Name -eq 'cmd.exe') {
    Stop-Process -Id $parent.ProcessId -Force
  }
}
Write-Host 'Manager stopped.'
