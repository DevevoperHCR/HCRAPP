import importlib

def test_app_health_route_exists():
    m = importlib.import_module("server")
    routes = {getattr(r, "path", "") for r in m.app.routes}
    assert "/api/app-health" in routes

def test_owner_is_not_user_visible():
    js = open("static/app.js", encoding="utf-8").read()
    assert '{ id: "owner", name: "Admin Control Center"' not in js
    assert 'name: "Admin Dashboard"' in js
