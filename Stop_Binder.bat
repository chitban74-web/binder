@echo off
setlocal
title Binder Town Manager - stop
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings.
REM Stops the background manager started by Start_Binder.bat (only this folder's manager\server.js).

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0manager\stop_manager.ps1"
timeout /t 3 /nobreak >nul
exit /b 0
