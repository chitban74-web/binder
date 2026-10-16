@echo off
setlocal
title Binder Town Manager
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings: cmd.exe misreads UTF-8 (Thai) text in .bat files.
REM Thai messages come from manager\server.js instead.

echo ==============================================================
echo   Binder Town Manager  -  http://localhost:3889
echo   Open the game, watch every tab and update from GitHub
echo   in the web page. Keep this window open.
echo ==============================================================
echo.

REM Node.js: system install first, then a portable bin\node.exe here or in Pelican Manager
set "NODE_CMD="
where node >nul 2>nul && set "NODE_CMD=node"
if not defined NODE_CMD if exist "%~dp0bin\node.exe" set "NODE_CMD=%~dp0bin\node.exe"
if not defined NODE_CMD if exist "%~dp0..\Pelican_Manager_v4.3\bin\node.exe" set "NODE_CMD=%~dp0..\Pelican_Manager_v4.3\bin\node.exe"
if not defined NODE_CMD goto NO_NODE
echo [OK] Node: %NODE_CMD%

REM open the dashboard a moment after the server starts
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3889"

chcp 65001 >nul
:RUN
"%NODE_CMD%" "%~dp0manager\server.js"
REM exit code 3 = the manager updated itself from git: start it again
if %errorlevel%==3 goto RUN
pause
exit /b 0

:NO_NODE
echo [ERROR] Node.js not found. Install the LTS version from https://nodejs.org/ and try again.
pause
exit /b 1
