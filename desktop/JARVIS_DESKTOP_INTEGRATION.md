# JARVIS Desktop Integration — v0.6

JARVIS is directly integrated with the DeveloperHCR desktop layer.

- Every JARVIS action/event is persistently journaled locally in SQLite.
- Desktop and API actions use the same authorization policy.
- Destructive/privileged/shell-chained risky commands are blocked or confirmation-gated.
- System state is runtime-detected and cross-platform.
- Optional offline voice input/output remains supported when local engines/models are installed.
- Unsupported platform capabilities must report clearly instead of pretending to work.
