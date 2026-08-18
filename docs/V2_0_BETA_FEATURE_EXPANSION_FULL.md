# DeveloperHCR V2.0 BETA — Full Feature Expansion

This release is **BETA-only**. It is not presented as a stable/final release. Existing functionality is retained while additional modules are layered on top.

## Authentication and first-run
- Automatic first-run detection for a missing user-facing Admin account.
- Explicit **First Admin Setup** screen with username, password and confirmation.
- A visible **Create Admin** fallback button is available when automatic detection is delayed.
- No fixed Admin password is shipped.
- Internal control state is never exposed as a login identity.
- Factory Reset returns the application to first-run Admin Setup.

## Reset safety
1. Click **Reset System**.
2. Choose **Yes/OK** or **No/Cancel**.
3. If Yes is selected, the user must type **YES** exactly.
4. No password is requested for this confirmation.
5. The reset is local application-data reset only; it does not format the device or delete source files.

## File Checkup
- One-click read-only project file verification.
- Default state: **OFF**.
- Checks source/config/document files for readability and all other files for filesystem access.
- Reports the exact path and issue.
- Skip immediately stops the UI operation and turns the setting OFF again.
- The checkup never executes files, deletes files, or modifies source code.

## Desktop
- Windows-style desktop, Start/App Menu, taskbar and independent app windows.
- App search and desktop shortcuts.
- Fullscreen, landscape, theme, virtual mouse and keyboard controls.
- Minimize/maximize/close for app windows.

## AI
- HCR AI Agent interface.
- Ollama detection and model management.
- AI runtime monitoring.
- Local-first conversations and error logging.
- Voice/assistant modules retained where the host runtime supports them.

## Games
- 16 bundled games/demos across 2D and 3D.
- Games open in their own app windows.
- Game registry and renderer integrity checks.

## Productivity and developer tools
- Calculator, notes, tasks, calendar/reminders.
- JSON tools, Markdown preview, editor and quick text.
- Base64/URL tools, SHA-256, UUID, regex tester, color tools and CSV utilities.
- Network diagnostics, system information, process manager and environment setup.

## Security
- Security Center.
- App Lock / feature lock support.
- Secure Locker / vault functionality.
- Permission-gated process and terminal actions.
- Audit-oriented administration.

## Store, support and updates
- HCR Store catalog and local app registry.
- Feedback and Support controls.
- Configured GitHub repository/update settings.
- WhatsApp support destination is configurable; the app does not invent a payment success state.

## Assets
- Offline HD wallpaper pack in `static/wallpapers_v2_beta/`.
- Assets are real visual resources, not padding/filler files.

## Setup
- Windows BAT and PowerShell setup.
- Linux setup.
- Android/Termux setup.
- README, package guide, release manifest, repair notes and checksums.

## BETA warning
Optional capabilities depend on the host OS, browser, Python packages, Ollama installation and device permissions. Unsupported capabilities report their actual availability instead of pretending they are active.
