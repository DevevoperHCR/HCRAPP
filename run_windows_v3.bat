@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title DeveloperHCR Stable v1.0 - Windows

set "PYEXE="
where py >nul 2>nul
if %errorlevel%==0 set "PYEXE=py"
if not defined PYEXE (
  where python >nul 2>nul
  if %errorlevel%==0 set "PYEXE=python"
)

if defined PYEXE goto :python_ready

echo.
echo ================================================================
echo   DeveloperHCR Stable v1.0 - Python Setup
echo ================================================================
echo   Python was not found. DeveloperHCR can install it from the
echo   official Python.org Windows installer.
echo.

where winget >nul 2>nul
if %errorlevel%==0 (
  echo Trying Windows Package Manager first...
  winget install --id Python.Python.3.13 --scope user --accept-package-agreements --accept-source-agreements
  if not errorlevel 1 (
    where py >nul 2>nul
    if %errorlevel%==0 set "PYEXE=py"
    if not defined PYEXE (
      where python >nul 2>nul
      if %errorlevel%==0 set "PYEXE=python"
    )
    if not defined PYEXE if exist "%LocalAppData%\Programs\Python\Python313\python.exe" set "PYEXE=%LocalAppData%\Programs\Python\Python313\python.exe"
  )
)

if defined PYEXE goto :python_ready

set "PY_URL=https://www.python.org/ftp/python/3.13.14/python-3.13.14-amd64.exe"
set "PY_INSTALLER=%TEMP%\DeveloperHCR_Python_3.13.14_x64.exe"
echo Downloading official Python installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%PY_URL%' -OutFile '%PY_INSTALLER%'"
if errorlevel 1 goto :python_error
if not exist "%PY_INSTALLER%" goto :python_error

echo Installing Python for the current Windows user...
"%PY_INSTALLER%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1
if errorlevel 1 goto :python_error

del /q "%PY_INSTALLER%" >nul 2>nul
where py >nul 2>nul
if %errorlevel%==0 set "PYEXE=py"
if not defined PYEXE (
  where python >nul 2>nul
  if %errorlevel%==0 set "PYEXE=python"
)
if not defined PYEXE if exist "%LocalAppData%\Programs\Python\Python313\python.exe" set "PYEXE=%LocalAppData%\Programs\Python\Python313\python.exe"
if not defined PYEXE goto :python_error

:python_ready
echo.
echo Python detected: %PYEXE%
if not exist ".venv\Scripts\python.exe" (
  echo Creating DeveloperHCR virtual environment...
  %PYEXE% -m venv .venv
  if errorlevel 1 goto :venv_error
)

set "PY=.venv\Scripts\python.exe"
echo Installing/updating required packages...
"%PY%" -m pip install --disable-pip-version-check -r requirements.txt -r requirements-desktop.txt
if errorlevel 1 goto :pip_error

echo.
echo Starting DeveloperHCR Stable v1.0 Windows Edition...
"%PY%" launcher.py
set "ERR=%errorlevel%"
echo.
echo DeveloperHCR exited with code %ERR%.
pause
exit /b %ERR%

:python_error
echo.
echo ERROR: Python installation could not be completed.
echo Install Python manually from https://www.python.org/downloads/windows/ and run this file again.
pause
exit /b 1

:venv_error
echo ERROR: Could not create the Python virtual environment.
pause
exit /b 1

:pip_error
echo ERROR: Python dependencies could not be installed.
pause
exit /b 1
