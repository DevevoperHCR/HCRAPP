# HCR 3.0 Beta Stability Checklist

This Beta package is intended to preserve the existing HCRAPP feature set while
making cross-platform startup safer.

## Startup
- Platform detection
- Dependency validation
- Clean failure messages
- Termux private virtual-environment support

## Application
- Browser UI
- Admin/authentication flow
- Persistent application data
- App/Store framework
- AI integration
- Terminal/command safety
- Settings and system controls

## Release hygiene
- No Python bytecode
- No `__pycache__`
- No temporary build directories
- No generated cache
- No artificial size padding

## Important
Feature availability depends on the host platform and installed optional
runtime. The application should report unavailable capabilities rather than
pretending they are working.
