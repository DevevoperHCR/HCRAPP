#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
command -v pkg >/dev/null 2>&1 || { echo 'This setup script is intended for Termux.'; exit 1; }
pkg update -y
pkg install -y python git
python --version
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
mkdir -p data
echo 'Runtime data is created automatically.' > data/README.md
printf '\nDeveloperHCR Termux setup complete. Start with: python launcher.py\n'
