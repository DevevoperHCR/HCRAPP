from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_admin_is_visible_role_and_owner_is_internal():
    auth = (ROOT / "backend" / "auth.py").read_text(encoding="utf-8")
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    assert "def ensure_internal_owner" in auth
    assert "Owner setup is internal" in server
    assert "internal_owner_not_user_login" in server
    assert "Depends(auth.require_owner)" not in server

def test_mobile_interaction_repairs_present():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    assert "hcr-desktop-positions" in js
    assert "hcr-desktop-icon-size" in js
    assert "Logo click action" in js
    assert "HCR keyboard shortcut" in js
    assert "body.force-landscape{transform:none" in css
    assert "taskbar-search input{display:none" in css
    assert ".settings-tabs{flex-direction:row" in css

def test_admin_controls_are_server_authorized():
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    assert 'if privileged and user["role"] != "ADMIN"' in server
    assert 'Protected role. Admin cannot assign' in server
    assert 'The visible Admin account is already configured' in server
