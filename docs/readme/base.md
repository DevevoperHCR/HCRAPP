# DeveloperHCR:AI Agent — V1.0 BETA

## Version V1.0 BETA

This build is a **non-destructive merge of the v1.1 and v1.2 source trees**. The v1.2 improvements are kept, while v1.1 source modules, games, AI providers, backend, tests, database and desktop assets are restored. Platform-specific `__pycache__` files are not required for the application and are intentionally not used as source features.

### v1.3 fixes requested

- Landscape-first mode is enabled by default.
- Full-screen, minimize, maximize/restore, move and resize window controls remain available.
- Desktop application shortcuts are enabled by default and remain available through the HCR Launcher and taskbar.
- Direct zoom `➖ / ➕ / Reset` remains available on the taskbar and Settings.
- Supplied DeveloperHCR logo is used on boot/login branding.
- Every launcher/taskbar app keeps a distinct visual identity/icon.
- UI sounds are enabled by default and can be disabled/adjusted in Settings.
- Boot, login, app-open and important UI actions have lightweight generated UI sounds.
- HCR AI Agent is the visible assistant identity; real Ollama/GGUF detection is preserved.
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


## V1.0 BETA final fixes in this package

- Fresh release installs use the first-run account setup flow; no default Admin password is exposed in the package.
- Internal Owner/control capability remains background-only and is not exposed as a normal public UI identity.
- Critical project files are checked once per **server start**. Reloading the browser or calling the startup endpoint again reuses that run's result; the next server start performs a new check.
- The default launcher keeps the core working apps, while the larger catalog remains in **HCR Store** with each app's icon, version, category, description, availability and access/price state.
- Desktop shortcuts are visible by default. An empty/old local shortcut preference no longer leaves the desktop blank.
- Apps explicitly installed from HCR Store are added to the desktop immediately when a matching built-in app is registered.
- Start/App Menu uses a single activation path so mouse, touch and keyboard activation do not race or toggle the menu closed.
- Dark/Light theme switching preserves the desktop shell state. Date and time remain visible on compact/mobile layouts.
- Paid Store items remain individually locked; Owner access is free. Friends Only and Subscribers Only guest access remains single-user and 10-minute, with guest data cleaned up on exit/expiry.

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

The release source package does **not** ship a live user database or login session state. On a fresh installation, the backend creates its local SQLite database and runs the first-run account setup. Existing user data should be backed up before replacing an existing installation.



## v1.8 additions

- OWNER-only privileged settings: update repository, update channel, subscription configuration, Friends Only policy, Store source and WhatsApp support destinations.
- Friends Only Features section in Settings with named password-protected profiles. A default **Jyotish** profile is created after Owner setup; its credential is stored only as a salted PBKDF2 hash.
- Expanded HCR Store with built-in Text/Code Editor, Image Viewer, PDF Viewer, Media Player, Calendar, Clipboard, Network Tools, Process Manager, Security Center and Help Center.
- Owner update announcements are shown in Update Center.
- Update downloads are validated and a command for the current project directory can be copied to the DeveloperHCR terminal. The controlled `updater.py` creates a source backup and preserves `data/`.
- No arbitrary update command is silently executed by the browser.


## v1.8 fixes
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
## v2.1 Account/Login

There are no hard-coded Owner credentials. The Owner is created interactively on first run. Usernames are unique case-insensitively. Every signed-in user can change their own username/password from Settings → Account; the Owner can manage credentials for other users/admins from the Owner Dashboard. Login errors identify whether the username is missing, the account is disabled, or the password is incorrect.


## v2.3.0-beta release additions
- Preconfigured Owner account from the project owner's supplied credentials.
- Paid subscription request workflow with optional WhatsApp destination and manual Owner/Admin approval.
- Full Admin user list and subscription request management.
- Owner subscription request management.
- Unique usernames remain case-insensitive and credentials remain changeable.

Payment is not automatically verified by WhatsApp; paid access is activated only after an Owner/Admin approval action.

## v2.6 additions
- 5-second AI runtime startup monitor (no filesystem scan).
- Developer Toolchains installer and Code Playground.
- Fullscreen top restore control.
