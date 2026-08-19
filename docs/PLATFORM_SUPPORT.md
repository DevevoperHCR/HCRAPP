# HCR 3.0 Beta Platform Notes

## Windows
Use the Windows launcher/setup and the native Python environment.

## Linux/macOS
Use the standard Python launcher and dependency profile.

## Android/Termux
Do not create a virtual environment inside Android shared storage such as
`/storage/emulated/0`. Use Termux private `$HOME` storage.

The Android Python version and native dependency wheels determine which optional
AI/system features can be enabled.

## Data
Runtime data should remain outside source-controlled code and secrets must not
be committed to a public repository.
