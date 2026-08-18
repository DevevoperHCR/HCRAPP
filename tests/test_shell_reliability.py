from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_frontend_app_registry_can_finish_initialization():
    js = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
    assert 'function renderOwnerApp' in js
    assert 'function installFinalShellController' in js
    assert 'window.__HCR_SHELL_READY__=true' in js
    assert 'btn.onclick=(e)=>' in js
    assert 'hcr-hcr-shortcut' in js
    assert 'desktop-icon-size' in js
    assert 'suppressClick' in js
    assert 'grid.onclick=' in js


def test_windows_batch_launcher_is_real_batch_file():
    bat = (ROOT / 'start_windows.bat').read_bytes()
    assert b'@echo off\r\n' in bat
    assert b'python launcher.py\r\n' in bat
    assert b'\\n' not in bat


def test_version_is_beta_v1():
    assert (ROOT / 'VERSION').read_text(encoding='utf-8').strip() == '2.0-beta'
    html = (ROOT / 'static' / 'index.html').read_text(encoding='utf-8')
    assert 'BETA v2.0' in html
