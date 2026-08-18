# Factory Reset Confirmation Repair

## V2.0 BETA repair

- Replaced the confusing two-step `RESET SYSTEM` phrase prompt with a single clear Yes/Cancel confirmation.
- The browser now asks the user to click **OK / Yes to confirm** the system reset.
- The API accepts only the explicit `YES` confirmation token and remains localhost-only.
- After a successful reset, browser storage is cleared and the app reloads into **First Admin Setup**.
- Existing application source is not deleted and the device is not formatted.
