from pathlib import Path
import json

def test_admin_persistence_contract_present():
    root=Path(__file__).parents[1]
    auth=(root/"backend/auth.py").read_text(encoding="utf-8")
    server=(root/"server.py").read_text(encoding="utf-8")
    js=(root/"static/app.js").read_text(encoding="utf-8")
    assert "HCR_ADMIN_STATE_PATH" in auth
    assert "restore_persistent_admin" in auth
    assert "_clear_admin_state" in server
    assert "Admin Control Center" in js
    assert 'user.role === "ADMIN"' in js and 'openApp("admin")' in js

def test_admin_state_is_hash_only():
    root=Path(__file__).parents[1]
    auth=(root/"backend/auth.py").read_text(encoding="utf-8")
    assert '"password_hash"' in auth and '"salt"' in auth
    assert '"password":' not in auth
