# v2.0 BETA — Persistence / Admin / Store Fix

## Fixed
- First launch now opens the normal Admin Login screen first; **Create Admin** is available there when no Admin exists.
- Admin credentials persist outside the extracted application directory as a salted password hash.
- Settings, feedback, subscriptions, audit logs, app usage, Store installs and custom Store apps persist across re-extraction/updates.
- Factory Reset clears persistent runtime data only after explicit `YES` confirmation.
- Admin can add/update/delete paid Store apps from Admin Control Center.
- GitHub Update status is visible in Admin Control Center and Update Center.
- GitHub update checking falls back to tags/commits when a repository has no published Release yet.
- Official Email and Instagram Support are fixed in Settings, Feedback & Support and Admin Control Center; WhatsApp support is not included.
- Desktop Clear closes open windows and removes transient drag ghosts.

## Storage
Default runtime directory: `~/.developerhcr/data`.
Override with `HCR_DATA_DIR`; database can be overridden with `HCR_DB_PATH`.
No plaintext account password is written.

## Release hygiene
No runtime database, browser cache, Python cache or dummy filler files are shipped in the package.
