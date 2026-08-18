# DeveloperHCR V1.0 BETA — Shell Reliability Final Repair

This additive repair keeps the existing project entries and feature catalog intact.

## Fixed
- A missing `renderOwnerApp` frontend symbol was preventing `app.js` from completing execution. This stopped the Start/App Menu, desktop shortcuts, and other shell wiring from being installed.
- Start/App Menu now has a single delegated touch/mouse controller with outside-click handling that cannot immediately close the menu after opening.
- Taskbar search and launcher search share the same app registry and open the selected app directly.
- Desktop app windows carry a stable `data-app` identifier.
- Windows `start_windows.bat` is restored as a real CRLF batch file instead of a single line containing literal `\\n` sequences.
- Mobile taskbar keeps the date/time visible while preserving the main controls.
- Existing application renderers and routes are preserved; this repair is additive.

## Version
V1.0 BETA
