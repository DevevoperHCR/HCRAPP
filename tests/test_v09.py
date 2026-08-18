import tempfile
from pathlib import Path

def test_settings_persist():
    from jarvis.settings_store import SettingsStore
    with tempfile.TemporaryDirectory() as d:
        s = SettingsStore(Path(d) / "settings.json")
        s.update(assistant_name="NOVA", landscape_mode=True)
        assert s.load()["assistant_name"] == "NOVA"

def test_event_bus():
    from jarvis.event_bus import EventBus
    b = EventBus()
    e = b.emit("test", {"ok": True}, "test")
    assert e["kind"] == "test"
    assert b.recent(1)[0]["payload"]["ok"] is True

def test_runtime_registry_shape():
    from jarvis.runtime_registry import RuntimeRegistry
    data = RuntimeRegistry().scan()
    assert isinstance(data, list)
    assert all("name" in x and "available" in x and "status" in x for x in data)
