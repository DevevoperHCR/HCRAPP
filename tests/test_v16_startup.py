from pathlib import Path

def test_v16_startup_critical_files_present():
    root=Path(__file__).resolve().parents[1]
    required=['launcher.py','server.py','config.py','requirements.txt','backend/db.py','backend/auth.py','static/index.html','static/app.js','static/style.css','static/developerhcr-logo.jpg','ai/manager.py','jarvis/core.py','updater.py']
    assert not [p for p in required if not (root/p).is_file()]
