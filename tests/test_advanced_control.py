from pathlib import Path
import importlib


def test_control_center_routes_and_download_manager():
    m = importlib.import_module('server')
    routes = {getattr(r, 'path', '') for r in m.app.routes}
    for path in ('/api/control-center','/api/control-center/bluetooth','/api/downloads/start','/api/downloads/status/{job_id}','/api/downloads/files'):
        assert path in routes


def test_no_owner_dashboard_in_visible_app_catalog():
    js = (Path(__file__).parents[1] / 'static' / 'app.js').read_text(encoding='utf-8')
    assert 'name: "Owner Dashboard"' not in js
    assert 'name: "Admin Dashboard"' in js


def test_force_landscape_does_not_rotate_document():
    css = (Path(__file__).parents[1] / 'static' / 'style.css').read_text(encoding='utf-8')
    assert 'body.force-landscape' in css and 'transform: none' in css


def test_real_download_ui_and_exe_runner_present():
    js = (Path(__file__).parents[1] / 'static' / 'app.js').read_text(encoding='utf-8')
    assert '/api/downloads/start' in js
    assert '/api/downloads/status/' in js
    assert '/api/exe/run' in js
