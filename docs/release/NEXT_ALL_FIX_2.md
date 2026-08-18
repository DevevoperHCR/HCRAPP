# DeveloperHCR V1.0 BETA — Next All Fix 2

## Bug-first pass

- Removed destructive Admin reset controls from the public login/settings UI.
- Disabled the legacy `/api/auth/reset-admin` destructive action; existing accounts are preserved.
- Removed unsupported `private_e2ee` privacy mode and its UI labels. Privacy is now `standard` or `private` only.
- Fixed Security Center dashboard routing: Owner uses the Owner dashboard; Admin uses the Admin dashboard.
- Theme loading now prefers the server-saved theme when available, with local preference fallback.
- Preserved first-run Owner -> Admin setup and user-selected Friends/Subscribers credentials.

## Verification

- Python compile: PASS
- JavaScript syntax: PASS
- Automated regression suite: 20/20 PASS
- Fresh database server startup: PASS
- First-run auth status on a clean database: PASS
- Reset-admin endpoint: correctly rejected with HTTP 403
- Release contains no runtime SQLite account database

## Version

DeveloperHCR:AI Agent — **BETA v1.0**
