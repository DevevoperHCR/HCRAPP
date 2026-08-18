# DeveloperHCR App Guide — BETA

This guide documents the real app surfaces included in the BETA build.

## Core
- HCR AI Agent: local assistant, command/action bridge, permission-aware actions.
- AI Chat: Ollama/local model chat, conversation persistence and model selection.
- File Manager: local file listing and navigation.
- Notes: local notes with autosave/update events.
- Calculator: arithmetic utility.
- Terminal: safe command allow-list.
- Web Browser/Web Search: browser/search surfaces; unavailable network capabilities are reported.
- HCR Store: explicit installation and feature catalog.

## System
- Control Panel: device/server status, network diagnostics, display/sound/system shortcuts.
- App Health Center: one-click health sweep of server, database, UI, AI runtime, storage, network and core app registry.
- Troubleshooting: guided diagnostics and safe repairs.
- System Monitor/Process Manager: runtime metrics and process inspection.
- Security Center: authentication, session and privacy controls.
- Backup & Restore: application data backup/restore.

## Personalization
- Wallpaper Changer now includes bundled SVG wallpapers plus local/URL wallpaper support.
- Theme Manager controls light/dark/system appearance.

## AI
AI capabilities are reported honestly. If Ollama/model/runtime is unavailable, the UI says so instead of generating fake results.

## Trading
Practice Trading is simulation-only. Live broker mode is separate and requires explicit broker configuration and confirmation. No market price is invented when live data is unavailable.

## Account model
The visible account is Admin. Internal Owner control is not presented as a user login or launcher application.


## BETA 2.0 wallpaper pack
The Wallpaper Changer now includes four bundled 1280×720 HD wallpapers (Nebula, Circuit, Aurora HD, Sunset HD) in addition to the existing SVG presets. These are real local assets and work offline.

## BETA 2.0 window/input behavior
Desktop shortcuts are intentionally below application windows. The active application window is raised above other windows. The native OS/browser mouse cursor is always preserved; the optional virtual-mouse helper never disables the native cursor. Settings tabs remain horizontally scrollable on narrow screens.

## BETA 2.0 Control Centre
The Control Centre has a read-only background health monitor, 12-second UI refresh while open, network/Bluetooth diagnostics, system-settings launchers, and a local diagnostic JSON export.
