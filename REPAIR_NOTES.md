# V2.0 BETA Repair Notes

This archive is the organized source tree for the current DeveloperHCR V2.0 BETA repair pass.

Start on Windows with `start_windows.bat` or run `python launcher.py` on a compatible Python environment.

The project is local-first by default. Optional network/store/update features remain explicitly controlled.

See `docs/REPAIR_V2_0_BETA_NEXT.md` for the exact repair list and test results.

## Feedback ReferenceError repair — 2026-08-17
- Fixed stale Android/browser cache by bumping the app.js cache-busting version.
- Feedback & Support is now self-contained and does not reference an undefined `support` variable.
- Feedback submission now has explicit error handling instead of an uncaught promise/ReferenceError.
- Existing 44-test suite remains green.
