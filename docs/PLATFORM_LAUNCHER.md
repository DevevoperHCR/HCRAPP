# DeveloperHCR Platform Launcher

`launcher.py` is the single application entry point.

- Windows: starts the local backend and prefers a native HCR application window (pywebview).
- Linux/Kali: starts the same native shell when a WebView backend is available; otherwise opens the local HCR UI safely in the default browser.
- macOS: same native-first behavior.
- Android/Termux: uses the local browser UI because Termux does not provide a universal native desktop WebView.
- Terminal UI remains available manually with `python tui.py`; it is not opened automatically by the main launcher.

The backend is bound to `127.0.0.1`.
