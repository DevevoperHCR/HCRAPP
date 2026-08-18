# DeveloperHCR AI Agent — V2.0 BETA Release

## Included in this release
- First Admin Setup and persistent Admin recovery
- System Reset with Yes/No and `YES` confirmation; no account password is requested
- Optional File Checkup, OFF by default, with Skip
- App Menu ghost/duplicate icon scrolling fix
- Windows-style desktop, taskbar and independent app windows
- HCR AI / runtime tools
- Security Center, App Lock and Secure Locker
- HCR Store and Update Center
- 2D and 3D games
- Developer, system, network and productivity tools
- Custom DeveloperHCR branding using the supplied logo asset
- Feedback & Support presented as **24×7 Feedback & Support**; no WhatsApp support UI
- GitHub repository configuration: `https://github.com/DevevoperHCR/HCRAPP.git`
- Setup scripts for Windows, Linux and Termux
- Automated regression tests and release documentation

## Clean release rules
- Runtime SQLite database is not shipped.
- Python caches and pytest caches are not shipped.
- User-created Admin persistence is stored outside the extracted application directory.
- No artificial filler files are added only to increase package size.

## Setup
1. Extract the package.
2. Run the setup script for your platform.
3. Start DeveloperHCR.
4. On a fresh installation, complete First Admin Setup.
5. Restart once to verify Admin persistence.
6. Open App Health/File Checkup only when needed; it is OFF by default.

## Reset
Reset System -> Yes -> type `YES` -> Confirm. No password is requested for this reset confirmation. No/Cancel makes no changes.

## Testing
Run `pytest -q`, `node --check static/app.js`, and `python -m compileall -q .` from the project root.

## Persistence + Admin Store Fix
- Runtime data moved to `~/.developerhcr/data` (override with `HCR_DATA_DIR`).
- Admin credentials survive re-extraction and updates via salted hash state.
- Settings, feedback, subscriptions, audit logs and Store installs persist.
- Admin can add/update/delete paid Store apps from Admin Control Center.
- GitHub Update status is visible in Admin Control Center.
- Official Email and Instagram Support are visible in Admin Control Center and Feedback & Support; WhatsApp support is not included.
- Desktop Clear now also closes open windows and removes transient drag ghosts.
