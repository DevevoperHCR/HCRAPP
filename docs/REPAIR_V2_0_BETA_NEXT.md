# DeveloperHCR V2.0 BETA — Organized Repair & Expansion Pass

## Fixed and expanded in this pass

- Fixed the Games Hub crash caused by obsolete `data-play` handlers that were being wired even though the Hub now uses standalone game windows.
- Game sessions now open as independent HCR app windows, with their own title bar, minimize/maximize/close controls and restart path.
- Expanded the standalone game catalog to 16 games/demos: 10+ 2D games/puzzles and multiple 3D-style demos including Cube, Orbit, Starfield and Solar System.
- Added Breakout 2D, Minesweeper 2D, Flappy 2D, Maze 2D, Starfield 3D and Solar System 3D.
- Added useful built-in apps: Unit Converter, Password Generator, Markdown Viewer, Pomodoro Focus and JSON Formatter.
- Security Center keeps the existing per-app PIN lock and now exposes the expanded utility catalog without removing previous security features.
- Fixed the visual issue shown in the supplied screenshot: desktop shortcuts are hidden while an application window is open, and window surfaces are isolated so desktop icons cannot bleed through the app body.
- Strengthened App Health checks to validate the actual `APPS` registry for duplicate IDs and missing named renderers, plus Store catalog coverage and 2D/3D game styles.
- The HCR Store continues to expose registered built-in apps through the existing catalog flow; existing apps were not removed.
- Added two HD wallpapers to the existing Wallpaper Changer without removing earlier wallpapers.
- Update repository is now preconfigured/migrated to `DevevoperHCR/HCRAPP` so an Admin does not have to enter the repository just to enable update checking. The Admin can still change it later in Settings.
- Feedback & Support now shows only relevant support controls, configured WhatsApp links, a Support Settings shortcut and the HCRAPP GitHub repository link.
- Existing login, settings, AI, taskbar, desktop, Store, subscriptions, access controls, developer tools, EXE/Wine, backup, browser, files, camera and other features remain in the source tree.

## Security note

The existing App Lock is an in-HCR UI lock. It does not claim to replace Android/Windows OS app locking, disk encryption or account authentication. Server authentication remains authoritative.

## Validation

- Python compilation: PASS
- JavaScript syntax check (`node --check`): PASS
- Existing automated suite: 39/39 PASS with `PYTHONPATH=.`
- App registry audit: 79 unique app IDs, no duplicate IDs, no missing named renderers
- Standalone game registry: 16 games/demos
- Clean release archive: approximately 714 KB ZIP / approximately 1.25 MB archived source bytes

## Version

`2.0-beta` — additive repair/expansion build; no existing feature was intentionally removed.
