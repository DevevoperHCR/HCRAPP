@echo off
setlocal
cd /d "%~dp0"
echo DeveloperHCR Stable v1.0 - Windows setup
call "%~dp0run_windows_app.bat"
exit /b %errorlevel%
