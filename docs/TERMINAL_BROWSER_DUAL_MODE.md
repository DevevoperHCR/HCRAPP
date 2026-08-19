# HCR 3.0 Beta — Browser + Terminal Dual Mode

HCR 3.0 now uses one local FastAPI server as the shared runtime for both the browser desktop and the terminal UI.

- Browser: opens automatically at the local server URL.
- Windows: starts the terminal UI in a new console window.
- Linux desktop: starts the terminal UI in the available terminal emulator.
- macOS: starts Terminal.app.
- Termux: uses a new `tmux` window when `tmux` is installed; otherwise the browser still starts and `python tui.py` can be run manually.
- Both interfaces use the same backend, database, authentication and safe-command layer.
- The terminal client receives the actual dynamic server URL through `HCR_SERVER_URL`, so a busy port no longer breaks terminal mode.

This is not a second copy of the app: browser and terminal are two interfaces to the same running HCR instance.
