# DeveloperHCR Stable v1.0 — Native Desktop Mode

Windows now launches DeveloperHCR in a **native application window** using pywebview.
It does not intentionally open Chrome/Edge for the normal Windows launch.

## Windows
1. Run `setup_windows.bat` once.
2. It checks/installs Python if required.
3. It creates the local virtual environment.
4. It installs the backend and native desktop WebView dependency.
5. DeveloperHCR opens in its own app window.

`run_windows_app.bat` can be used for later launches.

## Other systems
The same backend remains available through the normal launcher. On systems where a native WebView package is unavailable, the project retains its browser/TUI fallback so the application is still usable.

## Important
The Windows app is a native shell around the local HCR UI; it is not a hosted website. The backend remains local (`127.0.0.1`).
