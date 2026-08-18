"""
DeveloperHCR:AI Agent - v0.2
backend/db.py - Lightweight SQLite storage layer.

New in v0.2 (Phase 2). Does not touch/replace the v0.1 JSON files
(data/notes.json, data/settings.json) - those keep working as-is.
"""

import sqlite3
import os
import threading
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(os.environ.get("HCR_DB_PATH", str(Path.home() / ".developerhcr" / "data" / "developerhcr.db"))).expanduser()
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'ADMIN',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS app_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    app_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
);

-- v0.3: AI Chat storage. Additive only - nothing above this changed.
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL DEFAULT 'New Chat',
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'idle'
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    tokens INTEGER,
    eval_ms INTEGER,
    error TEXT
);

CREATE TABLE IF NOT EXISTS ai_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    provider TEXT,
    model TEXT,
    error TEXT NOT NULL
);

-- v1.1: social access, subscriptions, store, updates
CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    friend_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(owner_user_id, friend_user_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    plan TEXT NOT NULL DEFAULT 'FREE',
    status TEXT NOT NULL DEFAULT 'active',
    start_date TEXT,
    expiry_date TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending',
    feature_permissions TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS store_installs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    app_id TEXT NOT NULL,
    version TEXT NOT NULL,
    source TEXT,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, app_id)
);
CREATE TABLE IF NOT EXISTS update_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    version TEXT,
    action TEXT NOT NULL,
    source TEXT,
    ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_security (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    quick_unlock_enabled INTEGER NOT NULL DEFAULT 0,
    pin_hash TEXT,
    pin_salt TEXT,
    privacy_mode TEXT NOT NULL DEFAULT 'standard',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS friend_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    friend_user_id INTEGER NOT NULL REFERENCES users(id),
    display_name TEXT NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE(owner_user_id, friend_user_id)
);
CREATE TABLE IF NOT EXISTS user_feature_overrides (
    user_id INTEGER NOT NULL REFERENCES users(id),
    feature TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    granted_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, feature)
);
CREATE TABLE IF NOT EXISTS friend_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(owner_user_id, name)
);

CREATE TABLE IF NOT EXISTS user_agreements (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    agreement_version TEXT NOT NULL,
    accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_consent INTEGER NOT NULL DEFAULT 0,
    privacy_mode TEXT NOT NULL DEFAULT 'standard'
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
);

CREATE TABLE IF NOT EXISTS support_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_by INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subscription_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    plan_id TEXT NOT NULL,
    price_inr INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    whatsapp_url TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(id)
);

-- v3.6: Password Vault — was listed in the HCR Store but had no real app
-- behind it. Per-user rows; plain local storage (see honesty note in
-- server.py) — additive only, nothing above this line changed.
CREATE TABLE IF NOT EXISTS guest_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    mode TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS store_apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    category TEXT NOT NULL DEFAULT 'Utilities',
    description TEXT NOT NULL DEFAULT '',
    price_inr INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    icon TEXT DEFAULT '📦',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vault_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    site_username TEXT,
    site_password TEXT,
    url TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def get_conn():
    if not hasattr(_local, "conn"):
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA foreign_keys = ON")
    return _local.conn


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()


@contextmanager
def cursor():
    conn = get_conn()
    cur = conn.cursor()
    try:
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def audit(user_id, username, action, detail=""):
    with cursor() as cur:
        cur.execute(
            "INSERT INTO audit_logs (user_id, username, action, detail) VALUES (?, ?, ?, ?)",
            (user_id, username, action, detail),
        )
