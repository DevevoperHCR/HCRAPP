@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title DeveloperHCR Stable v1.0
set "PYEXE="
where py >nul 2>nul && set "PYEXE=py"
if not defined PYEXE where python >nul 2>nul && set "PYEXE=python"
if not defined PYEXE (
  echo Python not found. Run setup_windows.bat first.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" %PYEXE% -m venv .venv
set "PY=.venv\Scripts\python.exe"
"%PY%" -m pip install --disable-pip-version-check -r requirements.txt -r requirements-desktop.txt
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)
"%PY%" windows_app.py
exit /b %errorlevel%
