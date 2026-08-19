from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_beta2_version_and_background_monitor():
    assert (ROOT / "VERSION").read_text(encoding="utf-8").strip() == "1.0-stable-cross-platform"
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    assert "hcr-control-monitor" in server
    assert "control_snapshot" in server

def test_windows_do_not_sit_under_desktop_icons():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    assert "#desktop-icons { z-index: 5 !important" in css
    assert "#windows-layer { z-index: 20 !important" in css
    assert "#windows-layer .win.window-active { z-index: 1000 !important" in css

def test_native_mouse_cursor_is_not_disabled():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    assert "cursor: auto !important" in css
    assert 'document.body.classList.remove("custom-cursor-mode")' in js

def test_landscape_is_not_document_rotation():
    css = (ROOT / "static" / "style.css").read_text(encoding="utf-8")
    assert "body.force-landscape, body.force-landscape #desktop { transform:none !important; }" in css

def test_control_centre_is_a_visible_core_app():
    js = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    assert 'id: "control"' in js
    assert 'name: "Control Panel"' in js


def test_app_health_route_does_not_call_missing_network_helper():
    from fastapi.testclient import TestClient
    import time
    import server
    from backend import auth
    client = TestClient(server.app)
    username = "b2health" + str(time.time_ns())[-12:]
    password = "Beta2Health_123!"
    auth.create_user(username, password, role="ADMIN")
    r = client.post("/api/auth/login", json={"username": username, "password": password, "remember": False})
    assert r.status_code == 200
    health = client.get("/api/app-health")
    assert health.status_code == 200
    assert isinstance(health.json().get("checks"), list)

def test_control_background_monitor_has_runtime_snapshot():
    from fastapi.testclient import TestClient
    import time
    import server
    from backend import auth
    client = TestClient(server.app)
    username = "b2monitor" + str(time.time_ns())[-12:]
    password = "Beta2Monitor_123!"
    auth.create_user(username, password, role="ADMIN")
    assert client.post("/api/auth/login", json={"username": username, "password": password, "remember": False}).status_code == 200
    time.sleep(0.1)
    snap = client.get("/api/control-center").json().get("background_monitor", {})
    assert snap.get("status") in {"starting", "healthy", "degraded", "error"}
    assert "updated_at" in snap
