# DeveloperHCR V1.0 BETA — Next All-Fix Pass

## Bug fixes
- Disabled destructive Owner reset through the normal application/API path.
- Removed Owner Reset and Owner Login controls from the public login UI.
- Preserved first-run Owner -> Admin -> Access Setup flow.
- Removed the false end-to-end-encryption option from the agreement UI.
- Removed duplicate `/api/feedback` POST route.
- Consolidated Start/app-menu activation to one delegated pointer/click path to avoid touch double-toggle races.
- Kept desktop shortcuts and installed-app visibility behavior.
- Replaced deprecated naive UTC calls with timezone-aware-compatible values.

## Verification
- Python tests: 20 passed.
- Python compileall: passed.
- JavaScript syntax check (`node --check`): passed.
- Clean-database auth status: Owner/Admin setup required as expected.
- ZIP integrity: passed.

## Release policy
- Version remains `1.0-beta`.
- Test database/accounts are not shipped in the release archive.
- Existing user data is not overwritten by the application updater.
