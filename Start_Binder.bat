@echo off
setlocal
title Binder Town Manager
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings: cmd.exe misreads UTF-8 (Thai) text in .bat files.
REM Thai messages come from manager\server.js instead.
REM This window checks Node and starts the manager in a minimized command window, then closes.
REM The manager writes its log to manager\server.log. Stop it with Stop_Binder.bat.

if "%~1"=="--run" goto RUN

echo ==============================================================
echo   Binder Town Manager  -  http://localhost:3889
echo   Starts in the background; this window closes by itself.
echo   Stop it with Stop_Binder.bat
echo ==============================================================
echo.

call :FIND_NODE
if errorlevel 2 goto OLD_NODE
if errorlevel 1 goto NO_NODE
echo [OK] Node: %NODE_CMD%

REM start this same file again with --run in a minimized command window
set "BT_BAT=%~f0"
start "Binder Town Manager" /min "%ComSpec%" /c ""%BT_BAT%" --run"
if errorlevel 1 goto NO_HIDE

REM open the dashboard once the server is up
timeout /t 3 /nobreak >nul
start "" http://localhost:3889
echo [OK] Manager is running in the background. This window will close.
timeout /t 3 /nobreak >nul
exit /b 0

:RUN
call :FIND_NODE || exit /b 1
chcp 65001 >nul
:LOOP
"%NODE_CMD%" "%~dp0manager\server.js" >> "%~dp0manager\server.log" 2>&1
REM exit code 3 = the manager updated itself from git: start it again
if %errorlevel%==3 goto LOOP
exit /b 0

REM Prefer a portable runtime, then try the system Node.js installation.
:FIND_NODE
set "NODE_CMD="
if exist "%~dp0bin\node.exe" set "NODE_CMD=%~dp0bin\node.exe"
if not defined NODE_CMD if exist "%~dp0..\Pelican_Manager_v4.3\bin\node.exe" set "NODE_CMD=%~dp0..\Pelican_Manager_v4.3\bin\node.exe"
if not defined NODE_CMD where node >nul 2>nul && set "NODE_CMD=node"
if not defined NODE_CMD exit /b 1
set "NODE_MAJOR=0"
for /f "tokens=1 delims=v." %%V in ('"%NODE_CMD%" --version 2^>nul') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 exit /b 2
exit /b 0

:NO_HIDE
echo [WARN] Could not start in the background - running in this window instead (keep it open).
goto RUN

:NO_NODE
echo [ERROR] Node.js 22 or newer was not found. Install it from https://nodejs.org/ or add bin\node.exe here.
pause
exit /b 1

:OLD_NODE
echo [ERROR] Node.js 22 or newer is required. Update Node.js and try again.
pause
exit /b 1
