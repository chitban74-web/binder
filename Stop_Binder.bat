@echo off
setlocal
title Binder Town Manager - stop
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings.
REM Ask this folder's manager to close its game browser windows and stop.

where curl.exe >nul 2>nul || goto NO_CURL
curl.exe --silent --show-error --max-time 20 --request POST --header "Content-Type: application/json" --data "{\"closeBrowsers\":true}" "http://127.0.0.1:3889/api/shutdown" >nul 2>nul
if errorlevel 1 (
  echo [INFO] Manager is not running or could not be reached.
) else (
  echo [OK] Shutdown requested.
)
timeout /t 3 /nobreak >nul
exit /b 0

:NO_CURL
echo [ERROR] curl.exe was not found. Close the Manager from Task Manager.
pause
exit /b 1
