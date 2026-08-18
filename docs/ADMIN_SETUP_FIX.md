# Admin Setup Fix — V2.0 BETA

## What was fixed

The release package previously contained a development SQLite database with pre-created Admin test accounts. That made `/api/auth/status` report `admin_configured=true` on a fresh extraction, so the First Admin Setup screen was skipped.

V2.0 BETA packages must ship with an empty application database. On first launch the application creates only its hidden internal control record; the visible Admin username and password are chosen by the user through the First Admin Setup screen.

## Expected first-run flow

1. Boot screen appears.
2. First Admin Setup appears automatically.
3. User enters Admin username, password and confirmation.
4. The Admin account is created with a salted password hash.
5. Optional Friends/Subscribers access setup appears.
6. Desktop opens.

## Existing installations

If an installation already has a configured Admin account, the setup screen is intentionally not shown. Use the application's factory-reset flow when a true first-run state is required.
