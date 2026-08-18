# DeveloperHCR V2.0 BETA — Custom Branding Update

## Branding change
The default DeveloperHCR logo asset has been replaced with the user-provided image.

### Asset path
`static/developerhcr-logo.jpg`

The application already references this single asset for the boot/login branding, launcher/taskbar logo, and hCR/Jarvis orb. Keeping the same path means no feature or routing changes are required.

## Preserved
- Existing V2.0 BETA features
- Admin setup/reset flow
- File Checkup
- App Menu and touch-scroll ghost-icon repair
- Games and separate game windows
- Security/App Lock
- Store, updater, developer tools and system tools
- Existing setup scripts and documentation

## Verification
- Logo file exists at the expected path.
- HTML/JS references still resolve to the same asset path.
- Python source compilation and existing regression tests should be run as part of release verification.
