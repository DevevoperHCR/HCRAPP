# V2.0 BETA — First Admin Setup Visibility Fix

## Problem
A packaged release could contain a runtime SQLite database with test/previous Admin records. The frontend then correctly concluded that an Admin already existed and the **First Admin Setup** screen did not appear.

## Fix
1. Runtime `data/developerhcr.db` is excluded from release archives.
2. Test/cache artifacts are excluded from release archives.
3. Fresh startup now reports `admin_configured: false` when no user-created Admin exists.
4. The login screen always exposes **Create Admin** as a manual fallback.
5. Clicking **Create Admin** directly opens the First Admin Setup form; the server rejects duplicates.
6. Frontend cache-busting was incremented so an older cached JavaScript file is less likely to hide the repair.
7. User-created Admin persistence remains outside the extracted source tree through the salted-hash recovery profile.

## Fresh install flow
`Launch → First Admin Setup → Create username/password → Admin created → Login/Desktop`

## Existing Admin flow
`Launch → Login → Enter existing Admin credentials`

## Reset flow
`Reset System → Yes → type YES → reset → First Admin Setup`

No device formatting occurs and no Admin password is requested by the reset confirmation.
