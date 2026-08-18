@echo off
setlocal
chcp 65001 >nul
title DeveloperHCR:AI Agent - BETA v1.0
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel% neq 0 (
  echo Python not found. Please install Python 3.9+ from https://python.org
  echo Make sure to check "Add Python to PATH" during install.
  pause
  exit /b 1
)
echo ============================================================
echo   DeveloperHCR:AI Agent - BETA v1.0
echo   Local server + Browser + Terminal
echo ============================================================
echo.
python launcher.py
set ERR=%errorlevel%
echo.
echo DeveloperHCR stopped with exit code %ERR%.
pause
exit /b %ERR%
