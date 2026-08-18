# DeveloperHCR V1.0 BETA — Advanced Control Next

- Added HCR Control Centre diagnostics for internet, latency, DNS, network interfaces and Bluetooth capability.
- Added safe Bluetooth power controls where the host OS exposes `bluetoothctl`; otherwise the UI opens native Bluetooth settings and reports the limitation.
- Added a real HTTPS Download Manager with background jobs, progress polling and a local downloads directory.
- Added storage scanning for `.exe` files in DeveloperHCR downloads and common Downloads locations.
- Preserved explicit Admin confirmation before EXE execution; Wine/native support is reported honestly.
- Removed the user-facing Owner Dashboard from the app catalog. Internal Owner control remains background-only.
- Removed the old document-rotation landscape workaround; compact responsive layout is used instead.
- Added a background system-health monitor for the taskbar network indicator.
- Release package intentionally excludes runtime databases, credentials, sessions, caches and downloaded data.
