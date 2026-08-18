#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v python3 >/dev/null 2>&1 || { echo 'Python 3.10+ is required.'; exit 1; }
python3 --version
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
mkdir -p data
echo 'Runtime data is created automatically.' > data/README.md
printf '\nDeveloperHCR setup complete. Start with: python launcher.py\n'
