# DeveloperHCR:AI Agent — BETA v1.0 Feature Expansion

This release keeps the existing application archive intact and adds a complete Windows-style local desktop shell.

## Desktop shell
- Windows-style Start/Applications launcher.
- Global app search from the taskbar and launcher.
- Desktop shortcuts for installed applications.
- This PC, Recycle Bin, Network and Bluetooth shortcuts.
- Control Panel with Display, Sound, Network, Bluetooth, Date/Time and Task Manager launchers.
- Local-only system destination allowlist; arbitrary shell execution is not exposed.
- Landscape workspace support on desktop and mobile browsers.
- Virtual mouse/cursor and virtual keyboard remain available.

## Recovery
- First-run Admin setup remains user-created.
- Local Admin reset remains available without deleting app data, settings or feature files.
- Network Recovery refreshes local DNS/network cache after explicit confirmation.

## Compatibility
The server continues to bind to the loopback interface for safety. The launcher presents the local URL as `http://localhost:<port>` to match the user-facing desktop experience.

## Preservation rule
No existing application, renderer, backend module, data file, feature catalog, or documentation is intentionally removed by this release.
