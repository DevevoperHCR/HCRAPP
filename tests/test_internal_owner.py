from pathlib import Path

def test_owner_is_internal_and_admin_is_user_facing():
    root = Path(__file__).parents[1]
    auth = (root / 'backend' / 'auth.py').read_text(encoding='utf-8')
    server = (root / 'server.py').read_text(encoding='utf-8')
    js = (root / 'static' / 'app.js').read_text(encoding='utf-8')
    assert 'ensure_internal_owner' in auth
    assert 'internal_owner_not_user_login' in server
    assert 'Create the main Admin account' in js
    assert 'function showOwnerSetup' not in js
