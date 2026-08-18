# DeveloperHCR:AI Agent — 1.3.0-beta

## v1.3.0-beta — Full merge + visual/control/access fixes

- Merged v1.1 and v1.2 without deleting prior source modules.
- Restored previous SQLite database and kept a legacy database backup.
- Landscape-first default and desktop icon hiding by default.
- Added supplied DeveloperHCR logo to boot/login branding.
- Added lightweight UI sound engine with Settings toggle and volume.
- Expanded HCR Store catalog.
- Added Owner subscription plan/price/feature editor.
- Added Owner per-user feature overrides and Friends Only credentials.
- Added Admin user creation with role restrictions.
- Kept Owner/Admin free full access and privacy-safe dashboards.
- Default remembered login is 30 days; Quick Unlock remains opt-in.
- Updated About/README/REDMI documentation.

## v1.2 preserved

- Browser, Control Panel, Subscription, Store, Updates, EXE/Wine, Troubleshooting.
- Kausar AI presentation and Ollama model download.
- Movable/resizable/min/max desktop windows and fullscreen controls.

## Safety / honesty

No fake payment verification, fake E2EE, silent EXE execution, or unsafe remote plugin execution is introduced.

# DeveloperHCR Changelog

## 1.2.0-beta — 2026-08-12

- Fixed landscape desktop window layout so windows remain movable/resizable.
- Added Full Screen control.
- Added expanded Control Panel.
- Added optional 30-day remembered login and Quick Unlock PIN.
- Added privacy modes and aggregate-only admin dashboards.
- Added Admin Dashboard.
- Added subscription definitions: Free, ₹1, ₹10, ₹100 plus future price slots.
- Added automatic feature restriction for Free tier in the desktop launcher.
- Added Web Browser app.
- Added Subscription Center app.
- Added Troubleshooting Center app.
- Added model download action for explicit Ollama pulls.
- Expanded HCR Store built-in catalog.
- Expanded Settings with Security, Subscription and System sections.
- Updated About/README documentation.
- Preserved existing modules and tests.

## 1.1.0-beta

- HCR Store
- Friends Only / Subscription
- Feedback & Support
- Python Games
- EXE/Wine compatibility
- Owner-configured GitHub update checking


## 1.4.0-beta
- Added Owner-only Friends Only Feature profiles with default Jyotish profile after Owner setup.
- Added privileged-setting enforcement for repository, subscription, support and access configuration.
- Added owner update announcements and controlled terminal update command flow.
- Added expanded built-in apps and populated HCR Store.
- Added controlled updater with backup and data preservation.

## v1.6.0-beta
- Fixed boot splash getting stuck; bounded startup check and Skip button.
- Added fast critical-file integrity check.
- Added first-run data/privacy/admin-sync agreement.
- Added optional, consent-gated local sync queue with private-content exclusions.
- Added Friends Only / Practice Trading risk and liability wording subject to applicable law.
- Landscape-first startup preserved.

## v1.8.0-beta — Interaction & startup fix
- Startup Skip is immediate and auth is timeout-bounded.
- Quick integrity check is capped; full diagnostics remain optional.
- Pointer-event window move/resize works on mouse and touch.
- Launcher apps can be dragged to the desktop to create shortcuts.
- Added screen training capture quality and size settings.
- App render failures now show Retry instead of breaking the desktop.

## v3.7 (merge of v3.6_LOGIN_FIXED + v3.6_FULL_LOGIN_FIXED, defense-in-depth)

- Merged both uploaded builds: kept the Password Vault / Screenshot / QR
  Store fixes and the runAuthGate() fix from one, and adopted the other's
  more robust emergency-fallback guard condition for the login button
  (checks that the real handler is actually wired, not just that app.js
  finished loading — the old check could be true while wiring had still
  silently failed).
- Fixed a latent bug in wireLoginForm(): it could mark itself "wired" even
  when the login button element was missing, permanently blocking both the
  real handler and the emergency fallback from ever working.
- Added the same emergency-fallback pattern to the New User (signup) flow,
  which previously had none — "New User" could go silently dead the same
  way Log In did.
- Any startup/wiring error is now shown directly under the Log In button
  ("Startup issue: ...") instead of failing silently, with a Reload App
  button that appears only when there's actually something to reload for.
- Server-unreachable is now reported with a distinct message from a
  broken-UI error, so it's clear which one is happening.
