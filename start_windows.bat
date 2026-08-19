@echo off
setlocal
cd /d "%~dp0"
call "%~dp0run_windows_v3.bat"
exit /b %errorlevel%
