# V2.0 BETA — Ghost Icon / Scroll Repair

## Problem
On touch devices, moving up/down inside the App Menu could leave a small floating app-icon proxy on the screen. The old pointer-drag handler created `.drag-ghost` elements on `pointermove`, but Android scrolling can finish with `pointercancel` or lost pointer capture instead of a normal `pointerup`.

## Fix
- Touch input no longer starts desktop shortcut dragging.
- App Menu explicitly uses vertical touch scrolling (`touch-action: pan-y`).
- Drag proxies are removed on pointer cancel, lost capture, window blur and launcher scrolling.
- Any stale `.drag-ghost` elements are removed before a new drag starts.
- Mouse/pen drag-to-pin remains available.
- Coarse/touch devices hide the drag proxy as an additional safety layer.

## Desktop app limit
The old 10-app default is migrated to **Unlimited** unless the user explicitly selected a limit. A 10-app option remains available in Settings.

## New offline tools
- Text Diff
- Timestamp Converter
- System Diagnostics
- File Hash Checker (SHA-256)
- Contrast Checker

## Verification
- 42 automated tests pass with `PYTHONPATH=. pytest -q`.
- JavaScript syntax check passes.
- Python compilation check passes.
