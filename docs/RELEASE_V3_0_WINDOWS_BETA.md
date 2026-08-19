# DeveloperHCR v3.0 BETA — Windows Edition

## Goal
v3.0 is the Windows-first Python application launcher built on the existing DeveloperHCR v2.x feature set. Existing working features are preserved; this release adds a cleaner Windows startup path and a global UI speed control.

## Windows startup flow
1. Run `run_windows_v3.bat` (double-click).
2. The launcher checks for `py`/`python`.
3. If Python is missing, it first tries Windows Package Manager (`winget`).
4. If `winget` is unavailable, it downloads the official Python 3.13.14 x64 installer from Python.org and installs it for the current user.
5. A local `.venv` is created automatically.
6. `requirements.txt` is installed/updated.
7. `windows_app.py` starts the FastAPI/Uvicorn server on `127.0.0.1` and opens the DeveloperHCR desktop in the default browser.

Python's official Windows documentation recommends the full installer for development use, and Python.org lists the 3.13.14 Windows 64-bit installer. See the official Python documentation/release pages for current installation details.

## v3.0 additions
- Windows-first one-file BAT bootstrap/start flow.
- Automatic Python detection.
- Automatic Python installation fallback from Python.org when Python is unavailable.
- Automatic virtual-environment creation.
- Automatic dependency installation.
- Dedicated `windows_app.py` Python entry point.
- Local-only server binding (`127.0.0.1`).
- Existing Admin/RBAC, local database, Store, AI, games, tools, support and update features remain in the base package.
- New **Settings → Speed & Performance** control:
  - Battery Saver
  - Balanced
  - Performance
  - Turbo
- Speed changes common UI transitions/animations across the shared desktop and app-window UI immediately.
- Speed preference is stored locally and can also be persisted in the DeveloperHCR settings store.
- No fake features and no removal of existing working features.

## Compatibility
- Windows 10/11 recommended.
- x64 is the primary automatic-install target.
- The existing browser-based DeveloperHCR UI remains the application surface; the Windows launcher makes startup feel like a normal Windows application while keeping the Python architecture.

## Safety
The bootstrap downloads Python only from Python.org. It does not download arbitrary executables. The application remains bound to localhost by default.

## Testing requirement
Release workflow: inspect → backup → implement → Python syntax checks → automated tests → regression tests → package.
