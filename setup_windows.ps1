$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$python = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command python -ErrorAction SilentlyContinue).Source }
if (-not $python) { throw 'Python 3.10+ is required.' }
& $python --version
if (-not (Test-Path '.venv')) { & $python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
New-Item -ItemType Directory -Force data | Out-Null
if (-not (Test-Path 'data\README.md')) { 'Runtime data is created automatically.' | Set-Content 'data\README.md' }
Write-Host 'DeveloperHCR setup complete. Start with: .\.venv\Scripts\python.exe launcher.py'
