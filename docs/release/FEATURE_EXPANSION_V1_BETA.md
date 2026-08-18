# DeveloperHCR V1.0 BETA — Feature Expansion

This release adds real feature wiring without filler/padding files.

## Added / expanded
- Full built-in productivity suite exposed in the launcher and default desktop shortcuts.
- Archive Manager: local ZIP inspection with a 100 MB request limit and no extraction.
- Backup & Restore: JSON backup/restore for non-secret settings and Notes.
- Calendar & Reminders.
- Downloads, Screenshot, Image Viewer, PDF Viewer and Media Player.
- AI Models / AI Chat / HCR AI Agent.
- System Monitor / Process Manager / Security Center.
- Text/Code Editor / JSON Viewer / Developer Toolchains / Code Playground.
- Network Tools / Environment Setup.
- Games / Practice Trading.
- Wallpaper / Theme Manager.
- Store / App Installer / Updates / Troubleshooting.

## Safety
- No plaintext passwords, tokens or API secrets are included in backups.
- Archive inspection does not extract files.
- Existing working features are preserved.
- Unsupported platform capabilities remain clearly reported instead of being mocked.

## Verification
- Python compile check: PASS
- JavaScript syntax check: PASS
- Regression suite: 20/20 PASS with `PYTHONPATH=.`
