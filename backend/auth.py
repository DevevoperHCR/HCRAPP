"""
DeveloperHCR:AI Agent - v0.2
backend/auth.py - Password hashing, sessions, and role-based access control.

Phase 1 of v0.2. No hard-coded credentials anywhere - the OWNER account
is created interactively on first run and only a salted PBKDF2 hash is
ever stored (stdlib hashlib, no extra dependency required).

Frontend hiding is NOT authorization - every protected route below is
enforced with a FastAPI dependency, on the server, regardless of what
the browser UI shows/hides.
"""

import hashlib
import os
import secrets
import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, HTTPException, Request

from backend import db

SESSION_COOKIE = "hcr_session"
SESSION_LIFETIME_HOURS = 24
REMEMBER_LIFETIME_DAYS = 365

# Portable admin persistence: keeps the user-created Admin identity outside
# the extracted application directory so reinstall/re-extract does not lose
# the account. The file contains only a salted password hash, never plaintext.
_ADMIN_STATE_ENV = "HCR_ADMIN_STATE_PATH"
ADMIN_STATE_PATH = Path(os.environ.get(_ADMIN_STATE_ENV, str(Path.home() / ".developerhcr" / "admin_state.json"))).expanduser()

def _read_admin_state():
    try:
        if not ADMIN_STATE_PATH.is_file():
            return None
        data = json.loads(ADMIN_STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None

def _write_admin_state(user):
    ADMIN_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "username": user["username"],
        "password_hash": user["password_hash"],
        "salt": user["salt"],
        "created_at": user["created_at"],
        "version": 1,
    }
    tmp = ADMIN_STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    tmp.replace(ADMIN_STATE_PATH)

def _clear_admin_state():
    try:
        ADMIN_STATE_PATH.unlink(missing_ok=True)
    except OSError:
        pass

def restore_persistent_admin():
    """Restore the visible Admin into SQLite when the source tree was
    re-extracted or the local SQLite file was replaced. Existing active
    accounts always win; this never overwrites an existing user."""
    state = _read_admin_state()
    if not state:
        return None
    username = normalize_username(state.get("username")) if state.get("username") else ""
    pw_hash, salt = state.get("password_hash"), state.get("salt")
    if not username or not pw_hash or not salt:
        return None
    with db.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1", (username,))
        existing = cur.fetchone()
        if existing:
            if existing["role"] == "ADMIN" and existing["status"] == "active":
                return existing
            return None
        cur.execute(
            "INSERT INTO users (username,password_hash,salt,role,status) VALUES (?,?,?,?,?)",
            (username, pw_hash, salt, "ADMIN", "active"),
        )
        user_id = cur.lastrowid
    return get_user_by_id(user_id)

# v3.8: the public/self-signup user tiers (NORMAL_USER, APPROVED_USER,
# SUBSCRIBER, FRIENDS_ONLY) were removed. Only two roles exist now:
# OWNER (the single account created on first run) and ADMIN (accounts the
# Owner creates for other people). ADMIN keeps a few Owner-only
# restrictions (see require_owner in server.py: user management, global
# settings, and locking/unlocking Store features) but is otherwise fully
# trusted - this mirrors what NORMAL_USER restrictions used to be, just
# lighter.
ROLE_RANK = {
    "GUEST": 0,
    "FRIENDS_ONLY": 0,
    "NORMAL_USER": 0,
    "APPROVED_USER": 0,
    "SUBSCRIBER": 0,
    "ADMIN": 1,
    "OWNER": 2,
}
# Legacy/access roles remain valid so the restored Admin access-user workflow
# continues to work. They never receive Admin/Owner privileges.
VALID_ROLES = {"ADMIN", "OWNER", "FRIENDS_ONLY", "NORMAL_USER", "APPROVED_USER", "SUBSCRIBER"}
LEGACY_ROLES = {"FRIENDS_ONLY", "NORMAL_USER", "APPROVED_USER", "SUBSCRIBER"}


def hash_password(password: str, salt: bytes = None):
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return dk.hex(), salt.hex()


def verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    dk, _ = hash_password(password, bytes.fromhex(salt_hex))
    return secrets.compare_digest(dk, hash_hex)




def ensure_internal_owner() -> int:
    """Ensure a hidden system Owner record exists for internal control only.

    The Owner is never a user-facing login. The visible account is ADMIN.
    """
    with db.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE role='OWNER' ORDER BY id LIMIT 1")
        row = cur.fetchone()
        if row:
            return int(row["id"])
        username = "__hcr_internal_owner__"
        pw_hash, salt = hash_password(secrets.token_urlsafe(48))
        cur.execute(
            "INSERT INTO users (username,password_hash,salt,role,status) VALUES (?,?,?,?,?)",
            (username, pw_hash, salt, "OWNER", "active"),
        )
        return int(cur.lastrowid)

def owner_exists() -> bool:
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE role = 'OWNER' LIMIT 1")
        return cur.fetchone() is not None


def normalize_username(username: str) -> str:
    return " ".join(str(username or "").strip().split())

def validate_username(username: str) -> str:
    username = normalize_username(username)
    if len(username) < 3:
        raise ValueError("Username must be at least 3 characters")
    if len(username) > 32:
        raise ValueError("Username must be 32 characters or fewer")
    if any(ch in username for ch in "\r\n\t"):
        raise ValueError("Username contains an invalid character")
    return username


def configurable_admin_exists() -> bool:
    """True when a user-created active ADMIN exists. A portable persisted
    Admin profile is restored first so re-extracting the app cannot cause an
    endless First Admin Setup loop."""
    restore_persistent_admin()
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE role='ADMIN' AND status='active' AND LOWER(username) <> 'admin' LIMIT 1")
        if cur.fetchone() is not None:
            return True
    state = _read_admin_state()
    return bool(state and str(state.get("username") or "").strip())

def bootstrap_admin_exists() -> bool:
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE role='ADMIN' AND LOWER(username)='admin' LIMIT 1")
        return cur.fetchone() is not None

def username_exists(username: str, exclude_user_id: int = None) -> bool:
    username = normalize_username(username)
    with db.cursor() as cur:
        if exclude_user_id is None:
            cur.execute("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1", (username,))
        else:
            cur.execute("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?) AND id<>? LIMIT 1", (username, exclude_user_id))
        return cur.fetchone() is not None

def create_user(username: str, password: str, role: str = "NORMAL_USER", status: str = "active"):
    username = validate_username(username)
    if role not in VALID_ROLES:
        raise ValueError(f"invalid role: {role}")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    if username_exists(username):
        raise ValueError(f"Username '{username}' is already taken. Choose another username.")
    pw_hash, salt = hash_password(password)
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO users (username, password_hash, salt, role, status) VALUES (?, ?, ?, ?, ?)",
            (username, pw_hash, salt, role, status),
        )
        user_id = cur.lastrowid
    if role == "ADMIN" and status == "active" and username.lower() != "admin":
        _write_admin_state({"username": username, "password_hash": pw_hash, "salt": salt, "created_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()})
    return user_id


def get_user_by_username(username: str):
    username = normalize_username(username)
    with db.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", (username,))
        return cur.fetchone()


def get_user_by_id(user_id: int):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return cur.fetchone()


def create_session(user_id: int, lifetime_hours: int = SESSION_LIFETIME_HOURS) -> str:
    token = secrets.token_hex(32)
    expires = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=lifetime_hours)).isoformat()
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user_id, expires),
        )
    return token


def destroy_session(token: str):
    with db.cursor() as cur:
        cur.execute("DELETE FROM sessions WHERE token = ?", (token,))


def get_session_user(token: str):
    if not token:
        return None
    with db.cursor() as cur:
        cur.execute("SELECT * FROM sessions WHERE token = ?", (token,))
        session = cur.fetchone()
        if not session:
            return None
        if datetime.fromisoformat(session["expires_at"]) < datetime.now(timezone.utc).replace(tzinfo=None):
            cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
        cur.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],))
        user = cur.fetchone()
        if not user or user["status"] != "active":
            return None
        return user


# ---------------- FastAPI dependencies ----------------

def current_user(request: Request, hcr_session: str = Cookie(default=None)):
    """Returns the logged-in user row, or None. Never raises."""
    return get_session_user(hcr_session)


def require_login(request: Request, hcr_session: str = Cookie(default=None)):
    user = get_session_user(hcr_session)
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    return user


def require_role(min_role: str):
    min_rank = ROLE_RANK[min_role]

    def dep(request: Request, hcr_session: str = Cookie(default=None)):
        user = get_session_user(hcr_session)
        if not user:
            raise HTTPException(status_code=401, detail="Login required")
        if ROLE_RANK.get(user["role"], 0) < min_rank:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return dep


require_admin = require_role("ADMIN")

def require_owner(request: Request, hcr_session: str = Cookie(default=None)):
    """Internal-control dependency. The user-facing control account is ADMIN;
    an internal OWNER record may exist only as a background system role."""
    user = get_session_user(hcr_session)
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    if user["role"] not in ("ADMIN", "OWNER"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user
