# DeveloperHCR BETA v1.0 - Project Map

## Core
- launcher.py — main entry point
- server.py — local FastAPI backend
- config.py — settings
- updater.py — update support
- tui.py — terminal interface
- requirements.txt — required Python packages

## Runtime
- backend/ — authentication, database, AI models, feature controls
- ai/ — AI providers and model manager
- jarvis/ — HCR/Jarvis automation and safety layer
- desktop/ — desktop state and UI logic
- games/ — games
- plugins/ — plugins
- static/ — browser UI assets
- data/ — local runtime data
- tests/ — automated tests

## Documentation
- docs/changelog/ — change history
- docs/features/ — feature specifications
- docs/readme/ — README versions
- docs/release/ — release notes
- docs/repair/ — repair notes
- docs/audit/ — audit/preservation reports

## Build metadata
- build/manifests/ — build manifests
- build/catalog/ — feature/build catalog files

`requirements.txt` stays in the project root because the launcher and release tooling depend on that standard location.

## Release rules
- Do not delete `requirements.txt` from the root.
- Do not run the app from a package subfolder; `launcher.py` resolves its own project root.
- `static/README.txt` is included because the login UI links to it.
- Historical documents use short versioned names inside their category folders.

## Live Trading
- LIVE_TRADING_SETUP.md: broker setup and safety flow
- .env.example: environment variable template
- server.py: opt-in Zerodha Kite Connect live quote/order/portfolio endpoints
- static/app.js: Trading UI with practice + live broker modes

## Current BETA UI repair additions
- static/app.js — HCR AI Agent shortcut/logo action, touch drag-and-drop desktop shortcuts, persistent icon positions and icon sizing.
- static/style.css — mobile/landscape interaction repair and reachable Settings tabs.
- docs/CHANGELOG_UI_REPAIR.md — this repair pass.
