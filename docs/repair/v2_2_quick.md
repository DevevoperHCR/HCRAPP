# DeveloperHCR v2.2 — REDMI / Quick Guide

## Owner account
This release ships with the Owner account pre-created from the credentials supplied by the project owner. Do not publish the password in screenshots or repositories. The Owner can change the username/password later from Account controls.

## Subscription flow
1. User opens **Subscription**.
2. User selects a paid plan.
3. DeveloperHCR creates a **Pending** subscription request.
4. If the Owner has configured **Settings → Support → WhatsApp Group/Channel**, the app opens that WhatsApp destination immediately.
5. Payment/confirmation discussion happens there.
6. Owner or Admin opens **Owner/Admin Dashboard → Subscription requests**.
7. Approve → the selected plan becomes active.
8. Reject → request stays rejected and access is not activated.

The app never marks a paid plan as successful merely because the user clicked the button.

## Users
- Owner can see all users, roles, status, plans and requests.
- Admin can see all users and approve/reject subscription requests.
- Admin cannot create OWNER or ADMIN accounts.
- Duplicate usernames are rejected case-insensitively.
- Users can change their own username/password; Owner can manage other users' credentials.

## WhatsApp configuration
Set the real WhatsApp Group/Channel URL in **Settings → Feedback & Support**. The package intentionally does not invent a WhatsApp URL when none was supplied in the project files.

## Control Panel / Settings
The existing Control Panel, privacy, quick unlock, sound, AI, Store, Update, EXE/Wine, Friends Only and local-first data settings remain available.
