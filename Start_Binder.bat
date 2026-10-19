@echo off
setlocal
title Binder Town Manager
if not defined BT_ROOT set "BT_ROOT=%~dp0"
cd /d "%BT_ROOT%"

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

REM Run a temporary copy so stashing changes cannot alter the batch file being read.
set "BT_RUNNER=%TEMP%\BinderTownManager_%RANDOM%.bat"
copy /y "%~f0" "%BT_RUNNER%" >nul
if errorlevel 1 goto NO_RUNNER
start "Binder Town Manager" /min "%ComSpec%" /c ""%BT_RUNNER%" --run"
if errorlevel 1 goto NO_HIDE

REM open the dashboard once the server is up
timeout /t 3 /nobreak >nul
start "" http://localhost:3889
echo [OK] Manager is running in the background. This window will close.
timeout /t 3 /nobreak >nul
exit /b 0

:RUN
if defined BT_RUNNER (
  call :STASH_CHILD_CHANGES
  if errorlevel 1 goto STASH_FAILED
)
call :FIND_NODE || exit /b 1
chcp 65001 >nul
:LOOP
"%NODE_CMD%" "%BT_ROOT%manager\server.js" >> "%BT_ROOT%manager\server.log" 2>&1
REM exit code 3 = the manager updated itself from git: start it again
if %errorlevel%==3 goto LOOP
if defined BT_RUNNER del /q "%BT_RUNNER%" >nul 2>&1
exit /b 0

REM Prefer a portable runtime, then try the system Node.js installation.
:FIND_NODE
set "NODE_CMD="
if exist "%BT_ROOT%bin\node.exe" set "NODE_CMD=%BT_ROOT%bin\node.exe"
if not defined NODE_CMD if exist "%BT_ROOT%..\Pelican_Manager_v4.3\bin\node.exe" set "NODE_CMD=%BT_ROOT%..\Pelican_Manager_v4.3\bin\node.exe"
if not defined NODE_CMD where node >nul 2>nul && set "NODE_CMD=node"
if not defined NODE_CMD exit /b 1
set "NODE_MAJOR=0"
for /f "tokens=1 delims=v." %%V in ('"%NODE_CMD%" --version 2^>nul') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 exit /b 2
exit /b 0

:NO_HIDE
echo [ERROR] Could not start the manager window. Run Start_Binder.bat again.
pause
exit /b 1

:NO_RUNNER
echo [ERROR] Could not prepare the manager launcher in the temporary folder.
pause
exit /b 1

:NO_NODE
echo [ERROR] Node.js 22 or newer was not found. Install it from https://nodejs.org/ or add bin\node.exe here.
pause
exit /b 1

:OLD_NODE
echo [ERROR] Node.js 22 or newer is required. Update Node.js and try again.
pause
exit /b 1

:STASH_CHILD_CHANGES
if exist "%BT_ROOT%.binder-main" exit /b 0
where git >nul 2>nul
if errorlevel 1 exit /b 0
git -C "%BT_ROOT%" rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 exit /b 0
git -C "%BT_ROOT%" diff --quiet --ignore-submodules --
if errorlevel 1 goto SAVE_CHILD_CHANGES
git -C "%BT_ROOT%" diff --cached --quiet --ignore-submodules --
if errorlevel 1 goto SAVE_CHILD_CHANGES
exit /b 0

:SAVE_CHILD_CHANGES
echo [INFO] Saving local changes to Git stash before startup...
git -C "%BT_ROOT%" stash push -m "Binder Town auto-update backup"
exit /b %errorlevel%

:STASH_FAILED
echo [ERROR] Could not save local changes. Manager was not started.
pause
exit /b 1
