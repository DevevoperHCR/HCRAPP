from pathlib import Path

def test_factory_reset_endpoint():
    text=(Path(__file__).parents[1]/"server.py").read_text(encoding="utf-8")
    assert '@app.post("/api/auth/factory-reset")' in text
    assert '"YES"' in text
    assert '127.0.0.1' in text and '::1' in text
    assert 'db.init_db()' in text

def test_factory_reset_ui():
    root=Path(__file__).parents[1]
    html=(root/"static/index.html").read_text(encoding="utf-8")
    js=(root/"static/app.js").read_text(encoding="utf-8")
    assert 'id="login-factory-reset"' in html
    assert '/api/auth/factory-reset' in js
    assert 'confirm:"YES"' in js
    assert 'Click OK / Yes to confirm' in js
