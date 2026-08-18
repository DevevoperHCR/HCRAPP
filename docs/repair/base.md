# DeveloperHCR:AI Agent — BETA

## Version 1.5.0-beta

This build is a **non-destructive merge of the v1.1 and v1.2 source trees**. The v1.2 improvements are kept, while v1.1 source modules, games, AI providers, backend, tests, database and desktop assets are restored. Platform-specific `__pycache__` files are not required for the application and are intentionally not used as source features.

### v1.3 fixes requested

- Landscape-first mode is enabled by default.
- Full-screen, minimize, maximize/restore, move and resize window controls remain available.
- Desktop application icons are hidden by default; apps remain available through the HCR Launcher and taskbar.
- Direct zoom `➖ / ➕ / Reset` remains available on the taskbar and Settings.
- Supplied DeveloperHCR logo is used on boot/login branding.
- Every launcher/taskbar app keeps a distinct visual identity/icon.
- UI sounds are enabled by default and can be disabled/adjusted in Settings.
- Boot, login, app-open and important UI actions have lightweight generated UI sounds.
- Kausar AI remains the visible assistant name; real Ollama/GGUF detection is preserved.
- AI Models retains explicit Ollama model download support.
- HCR Store now has a larger catalog. Built-in apps open directly; unpublished catalog entries are clearly labelled instead of fake install buttons.
- Subscription editor is available to OWNER: plan ID, plan name, INR price and feature list can be changed.
- Future subscription prices can also be edited by OWNER.
- OWNER and ADMIN have free full access; normal users receive the feature set of their active plan plus explicit owner feature overrides.
- OWNER can grant an individual feature to a user from Owner Dashboard.
- OWNER can approve Friends Only access and set its display name/password.
- WhatsApp Channel/Group links are OWNER-configured announcement/support destinations. The application does not claim control over WhatsApp's own posting permissions.
- ADMIN can create normal/access users but cannot create OWNER or ADMIN accounts.
- OWNER can create users and ADMIN accounts.
- Login is remembered for 30 days by default; Quick Unlock remains optional and OFF until the user enables it.
- Privacy mode remains enforced as a dashboard privacy boundary. Private content is not exposed by Owner/Admin dashboards. E2EE is only claimed when a real encryption/key-management backend exists.
- Update repository remains OWNER-configurable and release assets are downloaded/validated before controlled apply/restart.

### Restored/retained from previous builds

AI runtime providers, Kausar/JARVIS modules, TUI, browser, notes, calculator, file manager, system monitor, terminal, games, authentication/RBAC, SQLite, feedback, subscription, Friends Only, Store, updates, EXE/Wine compatibility, troubleshooting, tests, desktop overlay contracts and static UI are all kept in the merged tree.

### Important honesty rules

- Paid subscription plans are configuration/entitlement definitions until a real payment provider and server-side payment verification are connected.
- Remote store packages must be explicitly installed and are HTTPS/archive-path validated.
- EXE execution requires explicit confirmation and Owner/Admin permission.
- Dangerous commands are not silently authorized.
- Private/E2EE is not falsely represented as implemented encryption.
- Unsupported platform features report their actual availability.

## Windows

```text
pip install -r requirements.txt
python launcher.py
```

or double-click:

```text
start_windows.bat
```

For real local AI, install/configure Ollama or a supported GGUF runtime and then use **AI Models**.

## Data preservation

The merged package keeps the previous database as `data/developerhcr.db` and also stores a copy at `data/legacy_v1_1/developerhcr.db`. The current backend initializes any newer tables additively.



## v1.5 additions

- OWNER-only privileged settings: update repository, update channel, subscription configuration, Friends Only policy, Store source and WhatsApp support destinations.
- Friends Only Features section in Settings with named password-protected profiles. A default **Jyotish** profile is created after Owner setup; its credential is stored only as a salted PBKDF2 hash.
- Expanded HCR Store with built-in Text/Code Editor, Image Viewer, PDF Viewer, Media Player, Calendar, Clipboard, Network Tools, Process Manager, Security Center and Help Center.
- Owner update announcements are shown in Update Center.
- Update downloads are validated and a command for the current project directory can be copied to the DeveloperHCR terminal. The controlled `updater.py` creates a source backup and preserves `data/`.
- No arbitrary update command is silently executed by the browser.


## v1.5 fixes
- Auto landscape attempt + portrait fallback
- Virtual mouse/cursor button for touch/desktop
- Kausar/Jarvis animated logo orb with voice-reactive dots
- Real Wine install action where supported by the OS package manager
- Friends Only Practice Trading simulator (no real money/orders)
- Select-all feature assignment in Owner subscription editor
- Boot failsafe/error handling improved


### v1.6 startup/privacy fixes
- Startup splash is bounded to roughly 1–2 seconds and has a Skip button.
- Critical files are checked in parallel; a timeout never traps the user.
- Local-first storage is default. Optional Admin Sync requires explicit user agreement.
- Private/E2EE modes prevent admin sync of private content.
- Friends Only Practice Trading is virtual/practice only; liability language is subject to applicable law.

- v1.6 Data & Sync settings: owner-configured HTTPS endpoint, explicit user consent, local queue, automatic retry when online; private/E2EE data is not synced.
