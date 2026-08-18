# DeveloperHCR: AI Agent — V2.0 BETA

DeveloperHCR is a browser-based, local-first AI desktop/agent environment with games, utilities, developer tools, security controls, an app store, update support, and a modular plugin system.

> **Repository:** https://github.com/DevevoperHCR/HCRAPP.git
>
> **Release:** V2.0 BETA


## V2.0 BETA — Admin persistence repair

The release package intentionally does **not** include a runtime SQLite database or test accounts. A fresh extraction therefore shows **First Admin Setup** and lets the user choose the Admin username/password. The created Admin is persisted using a salted password hash and a portable recovery profile outside the extracted app directory, so re-opening or re-extracting the application does not incorrectly ask for Admin creation again. Factory Reset removes that recovery profile and intentionally starts First Admin Setup again.

After Admin login, the **Admin Control Center** opens automatically and provides Windows-style system health, support, security, AI status, user/access and subscription controls.

## V2.0 BETA — latest fixes and additions

### First Admin Setup fix
The login gate now retries the local authentication-status request during startup, so a slow server no longer hides the First Admin Setup screen. A **Create Admin** button is also available as a manual fallback.

### Reset System confirmation
Reset uses two clear confirmations: **Yes/OK → type YES**. **No/Cancel** leaves everything unchanged. The reset confirmation does **not** request an account password.

### File Checkup
App Health Center now includes a read-only File Checkup. It is **OFF by default**. If enabled, it can be skipped and is automatically turned OFF after a manual check/skip. It reports real file-read issues and never modifies source files.

### Windows-style packaging
The release includes Windows BAT/PowerShell setup, Linux setup, Termux setup, documentation, feature manifest, games, assets, tests and release checksums.

### Real asset expansion
`static/wallpapers_v2_beta/` contains a bundled HD wallpaper collection. These assets are part of the visual feature pack and are not artificial size filler.

## What was added / repaired in this build

### Core/UI
- Repaired app-menu and app-window organization.
- Games open as independent app windows instead of replacing the main desktop.
- Added App Health Center checks for core services and app registrations.
- Improved Feedback & Support organization and repository/update configuration.
- Preserved existing Settings, Store, AI, desktop, taskbar, terminal, developer, subscription, access, and update features.

### Games
The bundled game registry contains 16 local games/demos:
- Guess the Number
- Dice Roller
- Snake 2D
- Pong 2D
- Block Drop / Tetris 2D
- Memory Match 2D
- Tic-Tac-Toe 2D
- Reflex Challenge
- Cube 3D
- Orbit 3D
- Breakout 2D
- Minesweeper 2D
- Flappy 2D
- Maze 2D
- Starfield 3D
- Solar System 3D

### Useful apps/tools
The build includes or exposes local tools for:
- Calculator, Tasks/Notes, Calendar & Reminders
- JSON Viewer/Tools, Markdown Preview, Text/Code Editor
- Developer Toolkit, Text Tools, Regex Tester, Color Lab, CSV Tools
- Network Tools, System Information, Process Manager
- Screenshot, Image Viewer, PDF Viewer, Media Player
- AI Chat, AI Model Manager, AI Runtime Monitor
- Environment Setup and EXE/Wine compatibility controls
- HCR Store, Downloads, Update Center, Help Center
- Wallpaper and Theme Manager

### Security
- HCR Security Center
- RBAC/admin controls
- App Lock / local security features retained
- Local Secure Locker for small encrypted notes
- Permission-gated system/process controls
- Safe command policy and audit-oriented controls retained

### Visual/offline assets
- Bundled offline wallpaper library, including the V2.1 visual pack.
- No external CDN is required for the bundled wallpapers.
- UI assets, sounds and logo remain inside `static/`.

## V2.0 BETA — Ghost icon repair and additional tools

The App Menu touch-scroll bug shown in the Android screenshots is fixed. Touch scrolling no longer starts icon dragging, stale drag proxies are cleaned on cancel/lost capture/scroll/blur, and mouse/pen pin-drag remains supported. The previous automatic 10-app desktop limit is migrated to **Unlimited** unless the user explicitly selected 10.

Five additional offline tools are included:
- **Text Diff** — line-by-line local comparison.
- **Timestamp Converter** — epoch seconds/milliseconds and ISO/local date conversion.
- **System Diagnostics** — read-only browser/storage/viewport/server checks.
- **File Hash Checker** — local SHA-256 file verification.
- **Contrast Checker** — WCAG-oriented color contrast ratio check.

Six additional HD wallpapers are bundled in `static/assets/v22/`. They are real visual assets exposed through Wallpaper Changer.

The full V2.0 BETA source package is targeted at approximately **50 MB extracted**, using project code, tests and real UI/visual assets rather than filler or cache files.

## Repository structure

```text
DeveloperHCR/
├── ai/                 # AI manager and AI errors
├── backend/            # auth, DB, model and feature-lock logic
├── build/              # manifests and feature catalog
├── data/               # runtime data; created locally, not committed
├── desktop/            # desktop/overlay documentation
├── docs/               # repair notes, guides and changelogs
├── games/              # game engine and game registry
├── jarvis/             # HCR/Jarvis-compatible assistant services
├── plugins/            # plugin manifests/examples
├── static/             # web UI, CSS, JS, images, sounds, wallpapers
├── tests/              # automated regression tests
├── launcher.py         # launcher
├── server.py           # local web server/API
├── updater.py          # update support
├── requirements.txt    # Python dependencies
├── setup_windows.bat   # Windows setup
├── setup_windows.ps1   # PowerShell setup
├── setup_linux.sh      # Linux setup
├── setup_termux.sh     # Android/Termux setup
└── README.md           # this file
```

## Quick start

### Windows
Run `setup_windows.bat`, then start the server with:

```bat
python launcher.py
```

If Python is already configured, `start_windows.bat` can also be used.

### Linux
```bash
chmod +x setup_linux.sh
./setup_linux.sh
python3 launcher.py
```

### Android / Termux
```bash
chmod +x setup_termux.sh
./setup_termux.sh
python launcher.py
```

The app uses a browser-based UI and can run headless/local-server style. On Android, install the Python packages supported by the Termux environment you are using.

## Configuration

Copy `.env.example` to `.env` and set only the values you actually need. Do not commit `.env`, passwords, tokens, private keys, or local database files.

The configured update repository is:

```text
https://github.com/DevevoperHCR/HCRAPP.git
```

## Testing

Run:

```bash
python -m pytest -q
```

The release packaging also performs Python compilation and JavaScript syntax checks. The latest regression suite contains 42 passing tests.

## Security notes

- Keep administrator credentials private.
- Do not commit `data/`, `.env`, database files, recordings, screenshots, or local AI model files.
- Optional AI/voice dependencies may require additional device permissions and runtimes.
- EXE/Wine and process controls are permission-gated and depend on the host environment.
- The Password Vault documentation explicitly warns that it is not a replacement for a hardened password manager.

## Release packages

The release is split into practical ZIP packages:

| Package | Purpose |
|---|---|
| `HCRAPP_V2_0_BETA_FULL_50MB.zip` | Complete BETA source + features + HD assets + setup + tests |
| `HCRAPP_V2_0_BETA_FEATURES_ADDED.zip` | Only the newly added/fixed V2.0 feature files and feature assets |
| `HCRAPP_V2_0_BETA_GITHUB_SOURCE.zip` | GitHub-ready clean source tree |
| `HCRAPP_V2_0_BETA_SETUP_WINDOWS_LINUX_TERMUX.zip` | Windows BAT/PowerShell, Linux and Termux setup |
| `HCRAPP_V2_0_BETA_DOCUMENTATION.zip` | README, guides, changelogs, repair notes and feature manifest |
| `HCRAPP_V2_0_BETA_GAMES.zip` | Game engine, registry and game UI resources |
| `HCRAPP_V2_0_BETA_HD_ASSETS.zip` | Offline HD wallpaper/visual assets |

## Important size note

The V2.0 BETA full package extracts to approximately 50 MB and uses bundled visual assets. This clean release removes generated Python bytecode, pytest cache and local runtime database state from the distributable source. The size therefore represents real project code, UI, tests and assets rather than cache/filler files.

## Factory Reset / New Admin

From the login screen, use **Reset System**. A single confirmation dialog asks you to click **OK / Yes to confirm**. After a successful local application-data reset, the app reloads and shows **First Admin Setup**, where a new Admin username and password can be created. The reset does not format the device or delete the application source.

## Custom Branding — V2.0 BETA
The application branding now uses the supplied custom image at `static/developerhcr-logo.jpg`. This is used by the boot/login screen, launcher, and hCR orb while retaining the existing application behavior.
See `docs/CHANGELOG_CUSTOM_BRANDING_V2.md` for the branding change record.

### v2.0 BETA Admin Setup visibility repair
- The login screen's **Create Admin** button now opens the First Admin Setup form directly, even if the local status check is slow or temporarily unavailable.
- The server remains the final authority and rejects duplicate Admin creation when an Admin already exists.
- Release archives contain no runtime SQLite database or test Admin accounts, so a fresh extraction starts in the correct First Admin Setup state.
- Browser cache-busting was updated for the repaired frontend assets.

## v2.0 BETA — Latest Repair Pass

This build includes the latest interaction and usability fixes:

- Feedback & Support no longer throws `support is not defined` and no longer depends on WhatsApp; it shows 24×7 local support plus the GitHub repository.
- Virtual Mouse is functional on touch devices with an on-screen cursor, movement pad, left/right click and scroll controls.
- Command Center provides a simplified safe-command UI with a microphone button.
- Normal AI Chat includes a Search button for browser web searches.
- HCR Voxel World adds an original block-building sandbox with keyboard and touch controls.
- Three new 4K offline wallpapers are included.
- Existing applications and core features remain preserved; these changes are additive.

**Release:** v2.0 BETA (mouse/AI/voxel repair pass)
**Approx. extracted source size:** 59.75 MB (before OS-generated runtime data/cache).

## v2.0 BETA Support Contacts
- **Email:** developerhcr@gmail.com
- **Instagram:** https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw
- **GitHub:** https://github.com/DevevoperHCR/HCRAPP
- WhatsApp support is not included in this release.
- Admin credentials and the Admin login flow are unchanged by the support-contact update.
