# DeveloperHCR V2.0 BETA — Package Guide

## What goes in each ZIP

### Full
Everything needed for the clean release: source, UI, assets, tests, manifests, docs and all platform setup scripts.

### GitHub Source
The same source-oriented tree intended for committing to GitHub. Runtime caches, Python bytecode and local database state are excluded.

### Windows Setup
`setup_windows.bat`, `setup_windows.ps1`, `start_windows.bat`, `requirements.txt`, `VERSION`, and the README/setup guidance.

### Linux Setup
`setup_linux.sh`, requirements, launcher/server files, and setup guidance.

### Termux Setup
`setup_termux.sh`, requirements, launcher/server files, and Android/Termux guidance.

### Docs
README, project map, repair notes, changelogs, app guide, expansion notes, admin setup notes and package guide.

### Games
`games/` plus game-related frontend resources and the game documentation.

### Assets
`static/assets/`, wallpapers, sounds, logo and the frontend resources needed to display them.

## Excluded from clean/GitHub packages

- `__pycache__/`
- `*.pyc` / `*.pyo`
- `.pytest_cache/`
- local database files
- local recordings/screenshots
- `.env` secrets

These are runtime/generated data, not product features.
