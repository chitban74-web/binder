@echo off
setlocal
title Binder Town Manager - stop
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings.
REM Stops the background manager started by Start_Binder.bat (only this folder's manager\server.js).

set "BT_SERVER=%~dp0manager\server.js"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:BT_SERVER) }; if (-not $p) { Write-Host 'Manager is not running.'; exit 0 }; foreach ($x in $p) { $c = Get-CimInstance Win32_Process -Filter \"ProcessId=$($x.ParentProcessId)\"; Stop-Process -Id $x.ProcessId -Force; if ($c -and $c.Name -eq 'cmd.exe') { Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue } }; Write-Host 'Manager stopped.'"
timeout /t 3 /nobreak >nul
exit /b 0