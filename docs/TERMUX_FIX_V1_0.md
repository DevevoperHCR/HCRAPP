# Stable v1.0 — Termux Fix

- Fixed Python 3.13 + Pydantic v1 ForwardRef incompatibility by requiring Pydantic >=1.10.21,<2.
- Launcher now detects an installed-but-too-old Pydantic instead of assuming it is valid.
- Termux setup upgrades the dependency profile instead of leaving stale packages in place.
- Android and Windows receive separate UI styling and platform filtering.
- Windows-only utilities are hidden from Android.
- HCR Store continues to expose optional apps for explicit installation rather than pre-installing the entire catalog.
