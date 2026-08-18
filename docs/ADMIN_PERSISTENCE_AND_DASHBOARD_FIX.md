# V2.0 BETA — Admin Persistence & Dashboard Repair

## Fixed

### First Admin Setup
- Fresh release packages no longer ship a runtime SQLite database containing test/admin accounts.
- On a clean install, `/api/auth/status` reports `admin_configured: false` and the First Admin Setup screen is shown.
- The Create Admin button remains available as a manual fallback.

### Admin persistence
- A user-created Admin is stored in SQLite as a salted PBKDF2 password hash.
- A portable recovery profile is also stored outside the extracted application directory.
- The recovery profile contains the username, salted password hash and salt only; no plaintext password is stored.
- If the app is re-extracted or the local SQLite runtime database is replaced, the previously-created Admin is restored automatically.
- Existing active accounts always win; the recovery profile never overwrites an existing account.

### Factory Reset
- Factory Reset removes the portable Admin recovery profile as well as application runtime data.
- After reset, the First Admin Setup screen appears again.
- Reset does not format the device and does not delete the application source.

### Admin screen
- Admin users automatically receive the Windows-style **Admin Control Center** after login.
- The dashboard contains:
  - Open support count
  - CPU/RAM status
  - Account count
  - System health
  - AI runtime status
  - Security status
  - Quick actions
  - User/access table
  - Subscription requests
  - Access-user creation
- Existing Admin permissions remain server-enforced.

## Release hygiene
- Runtime SQLite database is excluded from the distributable source package.
- Python bytecode and pytest caches are excluded.
- Existing source, features, games, AI modules, static assets and documentation remain included.
