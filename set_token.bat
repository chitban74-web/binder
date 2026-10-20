@echo off
setlocal
title Binder Town - set update token
cd /d "%~dp0"

REM Keep this file ASCII-only with CRLF line endings (cmd.exe).
REM Saves a read-only GitHub token under the dedicated "token" remote in .git\config.
REM Keep origin unchanged; the manager uses token for downloads and origin remains the push remote.

where git >nul 2>nul || goto NO_GIT
if not exist ".git" goto NO_REPO

echo ==============================================================
echo   Binder Town - set the GitHub token update source
echo   Paste the read-only token from the main PC owner (github_pat_...)
echo ==============================================================
echo.
set "TOKEN="
set /p "TOKEN=Token: "
if not defined TOKEN goto NO_TOKEN
set "TOKEN=%TOKEN: =%"
echo %TOKEN%| findstr /r /x "github_pat_[A-Za-z0-9_]* ghp_[A-Za-z0-9]*" >nul || goto BAD_TOKEN

git remote get-url token >nul 2>nul
if errorlevel 1 (
  git remote add token "https://fledotexe:%TOKEN%@github.com/fledotexe/babybinder.git"
) else (
  git remote set-url token "https://fledotexe:%TOKEN%@github.com/fledotexe/babybinder.git"
)
set "GIT_TERMINAL_PROMPT=0"
git -c credential.helper= -c http.sslBackend=openssl fetch --quiet --no-write-fetch-head token
if errorlevel 1 goto FAIL
git remote set-head token -a >nul 2>nul
echo.
echo [OK] Token works. Open http://localhost:3889 and press the update button once;
echo      updates will come from the token remote; origin was left unchanged.
pause
exit /b 0

:FAIL
git remote set-url token "https://github.com/fledotexe/babybinder.git" >nul 2>nul
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
