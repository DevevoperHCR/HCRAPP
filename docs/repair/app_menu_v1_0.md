# DeveloperHCR V1.0 BETA — App Menu Fix

Fixed the Start/App Menu closing immediately when the Start button's logo image or child element was clicked. The outside-click handler now treats any element inside `#launcher-btn` as the Start button. Start menu activation also uses pointerup/click/keyboard activation for desktop and touch devices.

No existing application or source entry was removed.
