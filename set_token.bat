@echo off
setlocal
title Binder Town - GitHub token
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings (cmd.exe).
REM One-time setup on a friend's PC: saves a read-only GitHub token in this folder's .git\config
REM so the manager can download updates. The token is NOT stored in the project files or on GitHub.

where git >nul 2>nul || goto NO_GIT
if not exist ".git" goto NO_REPO

echo ==============================================================
echo   Binder Town - set the GitHub token for automatic updates
echo   Paste the token you got from the main PC owner (github_pat_...)
echo ==============================================================
echo.
set "TOKEN="
set /p "TOKEN=Token: "
if not defined TOKEN goto NO_TOKEN
set "TOKEN=%TOKEN: =%"
echo %TOKEN%| findstr /r /x "github_pat_[A-Za-z0-9_]* ghp_[A-Za-z0-9]*" >nul || goto BAD_TOKEN

git remote set-url origin "https://chit12121111:%TOKEN%@github.com/chit12121111/binder.git"
set "GIT_TERMINAL_PROMPT=0"
git -c credential.helper= fetch --quiet origin
if errorlevel 1 goto FAIL
echo.
echo [OK] Token works. Open http://localhost:3889 and press the update button once;
echo      after that this PC updates by itself.
pause
exit /b 0

:FAIL
git remote set-url origin "https://github.com/chit12121111/binder.git"
echo.
echo [ERROR] GitHub refused this token (wrong, expired or revoked). Nothing was saved.
echo         Ask for a new token and run this file again.
pause
exit /b 1

:BAD_TOKEN
echo [ERROR] That does not look like a GitHub token (it starts with github_pat_). Nothing was saved.
pause
exit /b 1

:NO_TOKEN
echo [ERROR] No token entered. Nothing was saved.
pause
exit /b 1

:NO_GIT
echo [ERROR] Git is not installed. Install Git for Windows from https://git-scm.com/ and try again.
pause
exit /b 1

:NO_REPO
echo [ERROR] Put this file in the Binder_Town folder (the one with the .git folder) and run it there.
pause
exit /b 1
