import tempfile
from pathlib import Path
from jarvis.level7 import JarvisOrchestrator

def test_plan_and_safe_authorization():
    with tempfile.TemporaryDirectory() as d:
        j = JarvisOrchestrator(d)
        p = j.plan("open calculator")
        assert p["kind"] == "ACTION_REQUEST"
        assert j.authorize("echo hello")["allowed"] is True

def test_dangerous_is_blocked():
    with tempfile.TemporaryDirectory() as d:
        j = JarvisOrchestrator(d)
        r = j.authorize("rm -rf /")
        assert r["allowed"] is False
        assert r["status"] == "BLOCKED"
