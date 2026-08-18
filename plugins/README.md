# DeveloperHCR Plugins — v0.4

Each future plugin is intended to contain `manifest.json` plus its declared
entry point. The manifest explicitly lists permissions and dependencies.

Example permissions: `filesystem.read`, `filesystem.write`, `network`,
`microphone`, `command.exec`.

**Important:** v0.4 provides the plugin layout/manifest foundation only. It does
not silently execute arbitrary third-party code or claim that the marketplace
is complete.
