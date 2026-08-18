# Authentication Fix — V1.0 BETA

- No Owner/Admin credentials are shipped in the release.
- Fresh install creates Owner first, then user-created Admin.
- Fresh install then offers Access Setup for Friends Only and Subscribers Only.
- Guest passwords are chosen by the Owner and stored only as salted PBKDF2 hashes.
- No hard-coded guest password fallback remains.
- Existing user database is not shipped in the release archive; an existing local database is preserved when updating in place.
- Guest session expiry returns to the login screen intentionally.
