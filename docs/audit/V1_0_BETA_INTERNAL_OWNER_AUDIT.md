# DeveloperHCR V1.0 BETA — Internal Owner / Admin Audit

## User-facing role
The visible account is **ADMIN**. First launch now creates the internal control record automatically and immediately asks the user to create the Admin username and password.

## Internal control
The Owner role remains only as a background system-control record. It is not shown on the login screen, desktop identity, normal setup flow, or user-facing role selection. Direct login as the internal Owner is rejected.

## First-run flow
1. Boot / device checks
2. Automatic internal control initialization
3. First Admin Setup
4. Optional Friends Only / Subscribers Only setup
5. DeveloperHCR desktop

## Recovery
`Reset System` clears DeveloperHCR runtime data only after the exact `RESET SYSTEM` confirmation and then starts the Admin setup again. It does not format Android/Windows or delete the application source.

## Security
- Passwords are salted PBKDF2 hashes.
- No default Admin password is shipped.
- Internal Owner credentials are generated locally and are not exposed as a login credential.
- Sensitive actions remain permission/confirmation controlled.
- Runtime databases and credentials are not shipped in the package.

## Verification
- Python compile: PASS
- JavaScript syntax: PASS
- Regression suite: PASS (23 tests)
- Internal Owner cannot use the public login endpoint.
- First Admin setup is user-facing.
