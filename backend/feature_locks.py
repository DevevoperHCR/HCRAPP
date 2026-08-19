"""
DeveloperHCR:AI Agent - v3.8
backend/feature_locks.py - Per-feature (HCR Store) password locks.

Some Store items are "paid/important" and should stay hidden behind their
own password, separate from the account login. Each locked app_id gets its
own salted PBKDF2 hash - never a plaintext password on disk, never in a
log line, and never in an API response.

If someone doesn't know a feature's password, the frontend shows the
Owner's configured WhatsApp channel/group (Settings -> Support) so they can
ask directly, instead of guessing.
"""

import json
import os
from pathlib import Path

from backend import auth

LOCKS_PATH = Path(os.environ.get("HCR_FEATURE_LOCKS_PATH", str(Path.home() / ".developerhcr" / "data" / "feature_locks.json"))).expanduser()
LOCKS_PATH.parent.mkdir(parents=True, exist_ok=True)


def _load() -> dict:
    if not LOCKS_PATH.exists():
        return {}
    try:
        return json.loads(LOCKS_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _save(data: dict):
    LOCKS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def locked_app_ids() -> list:
    """Safe to expose publicly - just the list of app_ids that need a
    password, never the passwords/hashes themselves."""
    return sorted(_load().keys())


def is_locked(app_id: str) -> bool:
    return app_id in _load()


def set_lock(app_id: str, password: str):
    """Set/replace the password for a Store feature. Owner-only, called
    from server.py. Raises ValueError on a too-short password."""
    if len(password) < 8:
        raise ValueError("Feature password must be at least 8 characters")
    pw_hash, salt = auth.hash_password(password)
    data = _load()
    data[app_id] = {"hash": pw_hash, "salt": salt}
    _save(data)


def remove_lock(app_id: str):
    data = _load()
    if app_id in data:
        del data[app_id]
        _save(data)


def verify(app_id: str, password: str) -> bool:
    data = _load()
    entry = data.get(app_id)
    if not entry:
        return False
    return auth.verify_password(password or "", entry["salt"], entry["hash"])
