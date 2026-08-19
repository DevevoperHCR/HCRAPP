from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def test_stable_version_contract():
    assert (ROOT/"VERSION").read_text().strip()=="1.0-stable-cross-platform"
def test_alarm_and_real_sounds():
    js=(ROOT/"static/app.js").read_text(encoding="utf-8")
    assert "Persistent alarms" in js or "persistent alarms" in js.lower()
    assert "HCR_SOUND_FILES" in js
    assert "/static/assets/sounds/notify.wav" in js
def test_startup_skip_persists():
    html=(ROOT/"static/index.html").read_text(encoding="utf-8")
    assert "hcr-startup-check-skipped-v1" in html and 'id="boot-skip"' in html
def test_settings_in_every_window():
    js=(ROOT/"static/app.js").read_text(encoding="utf-8")
    assert "win-settings" in js and 'openApp("settings")' in js
def test_desktop_is_clean():
    js=(ROOT/"static/app.js").read_text(encoding="utf-8")
    assert 'DEFAULT_DESKTOP_APPS=["files","recyclebin","thispc"]' in js
