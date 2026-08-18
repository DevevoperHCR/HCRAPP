from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / 'static' / 'app.js').read_text()
CSS = (ROOT / 'static' / 'style.css').read_text()


def test_touch_launcher_never_creates_drag_ghost():
    assert "if(!el||touch(e))return;" in JS
    assert 'document.addEventListener("pointercancel",clear,true)' in JS
    assert 'grid.addEventListener("scroll",clear' in JS
    assert '.launcher-grid { touch-action: pan-y' in CSS
    assert '.drag-ghost { display: none !important; }' in CSS


def test_desktop_limit_defaults_to_unlimited_and_can_be_explicitly_10():
    assert 'if(!explicit && (v===null || v==="10")){ localStorage.setItem("hcr-desktop-app-limit","unlimited")' in JS
    assert 'localStorage.setItem("hcr-desktop-app-limit-explicit","1")' in JS
    assert '<option value="unlimited">Unlimited</option>' in JS


def test_new_v20_offline_tools_are_registered():
    for app_id in ['textdiff', 'timestamp', 'diagnostics', 'filehash', 'colorcontrast']:
        assert f'id: "{app_id}"' in JS
