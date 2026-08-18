@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (set PY=py) else (set PY=python)
%PY% --version || goto :error
if not exist .venv %PY% -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if not exist data mkdir data
if not exist data\README.md echo Runtime data is created automatically.>data\README.md
echo.
echo DeveloperHCR setup complete.
echo Start with: python launcher.py
exit /b 0
:error
echo Python 3.10+ is required.
exit /b 1
