# DeveloperHCR V1.0 BETA — UI Repair Pass

## Fixed
- Removed the user-facing Owner role from the normal control flow; Owner remains an internal background record.
- Admin is the visible primary account and owns first-run Friends Only profiles.
- Admin-only control APIs no longer depend on a hidden Owner session.
- Protected Owner/Admin roles from being reassigned by Admin.
- Prevented duplicate visible Admin creation.
- Fixed the mobile landscape layout so the whole desktop is not rotated as a giant canvas.
- Fixed duplicate/top-and-bottom taskbar artifacts caused by forced rotation.
- Removed the separate floating taskbar search field; the search button opens the launcher search.
- Added configurable logo click action: App Menu, HCR AI Agent, or Show Desktop.
- Added configurable HCR keyboard shortcut.
- Added Small/Medium/Large desktop icon size control.
- Desktop icons now persist their positions and can be dragged on touch or mouse.
- Launcher app cards can be long-pressed/dragged onto the desktop on touch devices.
- Prevented a drag gesture from being interpreted as an app-open click.
- Settings tabs remain horizontally reachable on narrow/landscape screens.
- Kept HCR AI Agent as the user-facing assistant name; internal `jarvis` identifiers are compatibility names only.

## Verification
- Python compile check: PASS
- JavaScript syntax check: PASS
- Existing regression suite: PASS
- Admin first-run setup: PASS
- Admin-owned Friends Only setup and verification: PASS
- Former Owner-only control endpoints with Admin session: PASS
- Internal Owner login rejection: PASS
- Factory reset and new Admin setup: PASS
