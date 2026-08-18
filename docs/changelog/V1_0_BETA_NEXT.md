# V1.0 BETA — Next Changes

- Converted Owner from a user-facing setup/login identity into a background internal control role.
- Added automatic internal control initialization.
- First-run now goes directly to Admin account creation.
- Admin receives the active session immediately after account creation.
- Friends Only / Subscribers Only first-run setup is performed by Admin.
- Internal Owner login is explicitly rejected.
- Factory reset returns to fresh Admin setup.
- Added regression coverage for the internal Owner/Admin boundary.
- Existing applications and control routes were preserved.
