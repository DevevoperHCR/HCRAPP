#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

command -v pkg >/dev/null 2>&1 || { echo 'This setup script is intended for Termux.'; exit 1; }

echo '[HCRAPP] Updating Termux package metadata...'
pkg update -y
pkg install -y python git

PYVER="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
echo "[HCRAPP] Python $PYVER"

# Never create a venv inside Android shared storage. Termux cannot reliably
# create the lib64 symlink there.
PROJECT_DIR="$(pwd)"
PROJECT_KEY="$(printf '%s' "$PROJECT_DIR" | sha256sum | cut -c1-12)"
VENV_DIR="$HOME/.developerhcr-v3-venv-$PROJECT_KEY"

if [ -d "$PROJECT_DIR/.venv" ]; then
  echo '[HCRAPP] Removing old shared-storage .venv...'
  rm -rf "$PROJECT_DIR/.venv"
fi

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "[HCRAPP] Creating private Termux venv: $VENV_DIR"
  python -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip setuptools wheel

echo "[HCRAPP] Installing the Termux-compatible web stack..."
# Termux uses the Pydantic v1/FastAPI 0.99 compatibility line. This avoids
# pydantic-core (Rust) builds that fail on CPython 3.14 Android targets.
python -m pip install --only-binary=:all: -r requirements-termux.txt || {
  echo "[HCRAPP] Binary wheels are unavailable; retrying with normal pip resolution..."
  python -m pip install -r requirements-termux.txt
}
mkdir -p data
printf '%s\n' 'Runtime data is created automatically.' > data/README.md

echo
echo '[HCRAPP] Termux setup complete.'
echo "Activate: source \"$VENV_DIR/bin/activate\""
echo 'Run:      python launcher.py'\necho '[HCRAPP] Termux uses the local browser UI; desktop-only native shell features stay hidden.'
