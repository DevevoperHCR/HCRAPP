# DeveloperHCR persistent data

Runtime data is stored outside the extracted application by default at `~/.developerhcr/data` (or `HCR_DATA_DIR`). This keeps Admin credentials, settings, feedback, subscriptions, Store changes, app usage and audit history across app updates/re-extraction. Factory Reset explicitly clears this runtime data and requires `YES` confirmation. Passwords are stored as salted hashes; plaintext account passwords are never written.
