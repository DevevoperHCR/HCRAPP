from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]

def test_first_run_owner_setup_and_admin_login_work():
    from fastapi.testclient import TestClient
    import server
    from backend import auth

    client = TestClient(server.app)
    # Both a fresh DB and a preserved release DB are valid. Never overwrite an existing Owner.
    status = client.get('/api/auth/status').json()
    if status['owner_configured'] is False:
        setup_password = 'OwnerTest_' + __import__('secrets').token_urlsafe(12)
        setup = client.post('/api/auth/setup-owner', json={'username':'Test Owner','password':setup_password})
        assert setup.status_code == 200
        assert setup.json()['user']['role'] == 'OWNER'
    assert client.get('/api/auth/status').json()['owner_configured'] is True

    # Admin remains a separate account and can authenticate normally.
    # Never depend on a shipped/fixed password; current policy requires
    # user-created Admin credentials and stores only salted hashes.
    login_user = 'test_admin_v1_0_2_final_' + str(__import__('os').getpid())
    try:
        admin_password = 'AdminTest_' + __import__('secrets').token_urlsafe(12)
        auth.create_user(login_user, admin_password, role='ADMIN')
    except Exception:
        with auth.db.cursor() as cur:
            cur.execute("DELETE FROM users WHERE username=?", (login_user,))
        admin_password = 'AdminTest_' + __import__('secrets').token_urlsafe(12)
        auth.create_user(login_user, admin_password, role='ADMIN')
    login = client.post('/api/auth/login', json={'username':login_user,'password':admin_password,'remember':False})
    assert login.status_code == 200
    assert login.json()['user']['role'] == 'ADMIN'


def test_owner_account_cannot_be_reset_by_launcher():
    launcher = (ROOT / 'launcher.py').read_text(encoding='utf-8')
    assert 'Owner password reset is disabled' in launcher
    assert 'No Owner account will be created or changed by the launcher.' in launcher or 'Existing Owner data is never replaced or reset.' in launcher


def test_startup_check_is_cached_for_one_server_run():
    from fastapi.testclient import TestClient
    import server
    client = TestClient(server.app)
    first = client.get('/api/startup/check').json()
    second = client.get('/api/startup/check').json()
    assert first['ok'] is True
    assert first['checked_once'] is True
    assert first['checked_at'] == second['checked_at']


def test_android_store_and_guest_contracts_are_present():
    app_js = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
    css = (ROOT / 'static' / 'style.css').read_text(encoding='utf-8')
    server_py = (ROOT / 'server.py').read_text(encoding='utf-8')
    assert 'CORE_APP_IDS' in app_js
    assert 'android-ui' in css and 'windows-ui' in css
    assert 'GUEST_MINUTES = 10' in server_py
    assert 'Only one person can use it at a time.' in server_py
    assert 'SUBSCRIBER_GUEST_PASSWORD_HASH' in server_py
    assert 'SUBSCRIBER_GUEST_PASSWORD = ' not in server_py


def test_owner_reset_is_disabled_and_not_exposed_in_first_run_ui():
    from fastapi.testclient import TestClient
    import server
    client = TestClient(server.app)
    r = client.post('/api/auth/reset-owner', json={'confirm':'RESET OWNER'})
    assert r.status_code == 403
    assert 'Owner reset is disabled by policy' in r.json()['error']
    app_js = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
    index = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
    assert 'owner-reset-start' not in app_js
    assert 'login-reset-owner' not in index


def test_no_fake_e2ee_option_and_single_feedback_route():
    index = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
    js = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
    server_py = (ROOT / 'server.py').read_text(encoding='utf-8')
    assert 'private_e2ee' not in index
    assert 'end-to-end encrypted' not in index.lower()
    assert server_py.count('@app.post("/api/feedback")') == 1
    # Start-menu app activation must not register competing pointerup handlers.
    assert 'btn.addEventListener("pointerup"' not in js
