# HCRAPP

<img width="1536" height="1024" alt="file_000000003b508211bf2f36fc6581ebfd" src="https://github.com/user-attachments/assets/cce6d044-0767-488c-9589-c4bc207e591b" />

# HCR: AI Agent — V2.0 BETA

## 🚀 Ultimate Offline-First Productivity & AI Desktop System

DeveloperHCR AI Agent V2.0 BETA is a browser-based, local-first desktop environment designed for Android, PC and Termux.

It combines an AI assistant, productivity apps, developer tools, games, security tools, app store, system utilities, administration, troubleshooting and update management in one Windows-style interface.

> ⚠️ V2.0 is a BETA release. Some platform-dependent functions may require Android/PC/Termux-specific permissions or software.

---

# 🆕 V2.0 BETA — What's New

## 🔐 1. First Admin Setup — FIXED

The First Admin Creation system has been redesigned and repaired.

### Features

- First-run Admin Create screen
- User chooses their own Admin username
- User chooses their own Admin password
- Password confirmation
- Secure password hashing
- No exposed default Admin password
- Admin database persistence
- Admin remains available after restarting the application
- Admin recovery after runtime/database replacement
- Admin login verification
- Admin dashboard automatically available after successful login
- Existing authentication/RBAC architecture preserved

### Important

The application no longer repeatedly asks the user to create an Admin after the Admin has already been created.

---

# 🔄 2. System Reset — FIXED

A safer two-step reset process is included.

### Reset Flow

1. Click **Reset System**
2. Confirmation dialog appears
3. Select **Yes**
4. Type:

YES

5. Click **Confirm Reset**

### No Password Required

The reset confirmation does NOT ask for an Admin/Owner password.

### No / Cancel

Selecting **No** or **Cancel** leaves the application unchanged.

### After Reset

Application data/settings are reset and the First Admin Setup can appear again when required.

---

# 🩺 3. File Checkup / App Health Center

A dedicated health-check system is included.

### Features

- Disabled by default
- One-click file check
- Read-only checking
- Detects missing/unreadable important files
- Reports problems clearly
- Shows affected file/path
- Skip Checkup button
- Checkup can be stopped
- Automatically returns to OFF after a manual check/skip
- Does not modify application source files

---

# 🖥️ 4. Windows-Style Desktop UI

V2.0 includes a redesigned desktop experience.

### Features

- Windows-style desktop
- Landscape-first interface
- Fullscreen mode
- Minimize
- Maximize/restore
- Movable application windows
- Resizable windows
- Taskbar
- Start/App Menu
- Search
- Desktop controls
- Dark modern UI
- Touch support
- Mouse support
- Keyboard support

---

# 🐛 5. App Menu Ghost-Icon Bug — FIXED

A major scrolling issue was repaired.

### Old Problem

When scrolling the App Menu, application icons could appear as floating/duplicate/ghost icons over the screen.

### Fix

- Touch scrolling separated from drag operations
- Pointer cancellation handling improved
- Scroll cleanup added
- Lost-pointer handling added
- Window blur cleanup added
- Ghost/temporary drag elements are removed automatically
- Touch scrolling no longer creates fake floating app icons
- Mouse/desktop interaction remains available

---

# 📱 6. App Window Management

Applications now use independent windows where supported.

Apps can open without unnecessarily replacing the main desktop.

### Supported window actions

- Open
- Close
- Minimize
- Maximize
- Restore
- Move
- Resize

---

# 🎮 7. Games System

Games are organized as a separate section.

Games can open in their own application window/session.

## Included Games

### 2D Games

- Guess the Number
- Dice Roller
- Snake
- Pong
- Block Drop / Tetris
- Memory Match
- Tic-Tac-Toe
- Reflex Challenge
- Breakout
- Minesweeper
- Flappy
- Maze

### 3D / Visual Games

- Cube 3D
- Orbit 3D
- Starfield 3D
- Solar System 3D

The game architecture is designed so additional games can be added later without replacing the existing game system.

---

# 🤖 8. HCR AI Assistant

The HCR AI system remains part of the platform.

### Features

- Local-first AI architecture
- AI runtime monitoring
- Ollama detection
- AI model management
- Local AI support
- AI chat interface
- Runtime status
- Model management
- Permission-controlled system operations

Unsupported AI runtimes are reported instead of being falsely shown as working.

---

# 🛠️ 9. Developer Toolkit

Developer-focused tools are included.

### Tools

- Text Editor
- Code Editor
- JSON Tools
- Markdown Preview
- Regex Tester
- CSV Tools
- Text Tools
- Color Tools
- File Hash Checker
- System Information
- Process Manager
- Network Tools
- Developer utilities
- Environment tools
- Terminal
- Troubleshooting

---

# 📂 10. Productivity Apps

Built-in productivity tools include:

- Calculator
- Notes
- Tasks
- Calendar
- Reminders
- Text tools
- File utilities
- JSON viewer
- Markdown viewer
- PDF Viewer
- Image Viewer
- Media Player
- Screenshot tools
- QR & Share
- Downloads
- Help Center

---

# 🌐 11. Network & System Tools

System utilities include:

- Network information
- Connection status
- System information
- CPU information
- RAM information
- Process information
- Runtime information
- Device configuration
- Environment information
- Network troubleshooting
- Bluetooth interface
- System monitoring

Platform-specific capabilities are reported honestly when unavailable.

---

# 🔒 12. Security Center

V2.0 includes a dedicated security section.

### Features

- App Lock
- Secure Locker
- Local protected notes
- RBAC
- Admin controls
- Permission controls
- Safe command policy
- Audit-oriented controls
- Protected system actions
- Dangerous-operation confirmations

The system does not silently authorize dangerous commands.

---

# 🔑 13. App Lock

Apps can be protected using the Security Center.

Possible protection targets include:

- Applications
- Sensitive tools
- Security utilities
- Administrative areas

The security system is designed to remain local-first.

---

# 🏪 14. HCR Store

The HCR Store provides a built-in application catalog.

### Store features

- Free apps
- Paid/catalog apps
- App descriptions
- App categories
- Activation/entitlement support
- Built-in apps open directly
- Unavailable/unpublished apps are clearly identified
- Store management
- Subscription integration

The system does not falsely claim that an unpublished application has been installed.

---

# 🔄 15. Update Center

Git-based update architecture is included.

### Features

- Configurable update repository
- Release checking
- HTTPS release assets
- Validation before applying updates
- Controlled update/restart flow
- Update status

Repository:

https://github.com/DevevoperHCR/HCRAPP.git

---

# 💬 16. Feedback & Support

A dedicated Feedback & Support section is included.

### Features

- Bug reports
- Suggestions
- Support requests
- Feedback category
- Message submission
- Troubleshooting access
- Support information

The previous WhatsApp-focused support presentation has been replaced by:

## 24×7 Feedback & Support

Support information can be configured through the application.

---

# 🖼️ 17. Custom DeveloperHCR Branding

The supplied DeveloperHCR real photo is used as the application branding asset.

### Used for

- Boot branding
- Login branding
- Launcher branding
- Application identity

The supplied image is used as provided rather than replacing it with another generated image.

---

# 🎨 18. Wallpapers & Visual Assets

V2.0 includes an expanded offline wallpaper/visual asset collection.

### Features

- Offline wallpapers
- Wallpaper manager
- Theme controls
- Local assets
- No mandatory CDN dependency for bundled visual assets

---

# 🔍 19. Search

The App Menu includes a unified search interface.

Search can be used to find:

- Apps
- Settings
- Tools
- Utilities
- Games
- System features

---

# ⚙️ 20. Settings

The Settings system includes controls for:

- Desktop
- App limits
- Theme
- Wallpaper
- Sound
- AI
- Security
- Network
- Updates
- System
- Support
- Accessibility-related UI controls

The previous 10-app desktop limit issue has been addressed so it does not unnecessarily block normal app usage.

---

# 📋 21. Admin Control Center

After Admin authentication, the Admin area provides management tools.

### Dashboard sections

- System Health
- App Health
- User/Access management
- Security information
- AI runtime status
- Support
- Feedback
- Update Center
- Troubleshooting
- System information
- Settings

Admin permissions remain separate from higher-level Owner controls.

---

# 🛡️ 22. Privacy & Security Rules

DeveloperHCR follows these rules:

- Passwords should not be stored in plaintext by the application
- Credentials should not be exposed in frontend source
- Dangerous commands require confirmation
- Arbitrary destructive commands are restricted
- Unsupported platform features report their limitation
- Private user content is not automatically exposed through dashboards
- Paid subscriptions are not treated as real payment verification unless a real payment backend is connected

---

# 📦 23. Packaging

The release contains:

- Application source
- Backend
- Frontend
- AI modules
- Games
- Developer tools
- Security tools
- Static assets
- Wallpapers
- Setup scripts
- Documentation
- Tests
- Configuration examples
- README
- Release information
- SHA-256 checksums

---

# 💻 24. Supported Environments

### Android

Browser/local-server based operation where the required runtime is available.

### Windows / PC

Python-based local server and desktop/browser interface.

### Linux

Linux setup scripts are included.

### Termux

Termux setup support is included.

---

# 📁 25. Package Structure

Typical structure:

DeveloperHCR/
├── ai/
├── backend/
├── frontend/
├── games/
├── static/
├── tools/
├── security/
├── tests/
├── docs/
├── setup/
├── launcher.py
├── README.md
└── requirements.txt

---

# 🧪 26. Testing

The project includes automated regression checks for important functionality.

Tests cover areas such as:

- Admin setup
- Admin persistence
- Authentication
- Reset confirmation
- File Checkup
- App registration
- App menu behavior
- Ghost-icon regression
- Games
- Security
- Configuration
- Static assets
- Packaging

Device-specific Android behavior may still depend on the device/browser/runtime environment.

---

# 📊 V2.0 BETA Summary

| Feature | Status |
|---|---|
| First Admin Setup | ✅ |
| Admin Persistence | ✅ |
| Admin Login | ✅ |
| Reset Confirmation | ✅ |
| File Checkup | ✅ |
| Ghost Icon Fix | ✅ |
| Windows-style UI | ✅ |
| App Windows | ✅ |
| App Menu | ✅ |
| Search | ✅ |
| HCR AI | ✅ |
| AI Runtime Monitor | ✅ |
| Developer Toolkit | ✅ |
| Security Center | ✅ |
| App Lock | ✅ |
| Secure Locker | ✅ |
| HCR Store | ✅ |
| Update Center | ✅ |
| Feedback & Support | ✅ |
| Games | ✅ |
| 2D Games | ✅ |
| 3D Games | ✅ |
| Wallpaper Manager | ✅ |
| System Tools | ✅ |
| Network Tools | ✅ |
| PDF Viewer | ✅ |
| Image Viewer | ✅ |
| Media Tools | ✅ |
| Terminal | ✅ |
| Troubleshooting | ✅ |
| Documentation | ✅ |
| SHA-256 Checksums | ✅ |

---

# 📦 V2.0 BETA Release

## Release Type

**BETA**

## Mode

**Offline First**

## Platforms

**Android / PC / Linux / Termux**

## Architecture

**Modular browser-based local desktop environment**

## Main Goals

- Productivity
- Local AI
- Development
- Security
- Games
- System utilities
- App management
- Offline-first operation

---

# ⚠️ BETA NOTICE

DeveloperHCR V2.0 is a BETA release.

Hardware-dependent functions such as Bluetooth, microphone, GPU acceleration, Windows EXE/Wine, system-level controls and some AI runtimes may depend on the host platform and installed software.

The application should report unavailable capabilities instead of pretending that they are working.

---

# 🔗 Repository

GitHub:

https://github.com/DevevoperHCR/HCRAPP.git

---

# 📞 Support

## 24×7 Feedback & Support

Use the application's **Feedback & Support** section to report:

- Bugs
- Crashes
- UI problems
- Installation problems
- Login problems
- Admin problems
- Game problems
- AI problems
- Store problems
- Security problems
- Suggestions

---

# 👨‍💻 DeveloperHCR

DeveloperHCR: AI Agent

**V2.0 BETA**

Offline-First • AI • Productivity • Developer Tools • Security • Games

---

## Changelog

### V2.0 BETA

- Fixed First Admin Setup visibility
- Fixed Admin persistence
- Fixed repeated Admin creation after restart
- Added secure Admin storage
- Improved Admin dashboard
- Fixed System Reset confirmation
- Added YES confirmation
- Removed password requirement from reset confirmation
- Added File Checkup
- Added Skip Checkup
- Fixed App Menu ghost icons
- Improved touch scrolling
- Improved independent app windows
- Expanded game system
- Added 2D and 3D games
- Expanded developer tools
- Expanded security tools
- Improved App Lock
- Improved HCR Store
- Improved Update Center
- Added Feedback & Support
- Added 24×7 support presentation
- Added custom DeveloperHCR branding
- Expanded offline visual assets
- Improved Settings
- Improved Search
- Improved troubleshooting
- Added regression tests
- Added release checksums
- Preserved existing features

---

## Important Release Rule

Existing meaningful features are not intentionally removed merely to simplify the V2.0 BETA build.

New features are added alongside existing functionality wherever technically possible.

**DeveloperHCR V2.0 BETA — Build, Test, Improve.**
