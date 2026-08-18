from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_support_contacts_are_fixed_and_no_whatsapp_ui():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    config = (ROOT / "config.py").read_text(encoding="utf-8")
    assert "developerhcr@gmail.com" in js
    assert "https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw" in js
    assert "No WhatsApp support is included in v2.0 BETA." in js
    assert '"whatsapp_group": ""' in config
    assert '"support_instagram": "https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw"' in config
    assert 'chat.whatsapp.com' not in js


def test_admin_dashboard_contains_support_team_contacts():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    assert "admin-support-contacts" in js
    assert "Instagram Support Team" not in js  # keep the concise UI label
    assert "@developerhcr — Support Team" in js
    assert "mailto:developerhcr@gmail.com" in js
