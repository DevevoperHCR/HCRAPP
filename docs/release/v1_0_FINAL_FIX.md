# DeveloperHCR:AI Agent — V1.0 BETA FIX

## Release identity
- Version: **V1.0 BETA**
- Release channel: **BETA**
- This is not a stable release.

## Desktop shell fixes
- Start/App Menu uses one click activation path so mouse, touch and keyboard activation do not toggle the menu multiple times.
- Desktop shortcuts no longer disappear when an old/empty local layout preference is present.
- Built-in apps installed explicitly from HCR Store are added to the desktop immediately and remain available from the app menu.
- Existing app/window manager, taskbar, launcher, Store and app registry are preserved.
- Date and time remain visible on compact/mobile layouts.
- Dark/Light theme switching validates the requested theme and preserves the other desktop state classes.
- Native browser/OS mouse cursor remains the primary cursor; the old glowing circle is not used as the normal pointer.

## Preservation
The source tree is intentionally kept intact. No existing application is replaced by a simplified mock.

## Required verification
`INSPECT -> BACKUP -> IMPLEMENT -> TEST -> REGRESSION TEST -> PACKAGE`

Every feature must work, clearly report when unsupported, or be marked BETA/experimental.
