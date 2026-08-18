from __future__ import annotations
try:
    from fastapi import FastAPI
except Exception:
    FastAPI = None

try:
    from .runtime_registry import RuntimeRegistry
    from .event_bus import EventBus
    from .settings_store import SettingsStore
except ImportError:
    from runtime_registry import RuntimeRegistry
    from event_bus import EventBus
    from settings_store import SettingsStore

registry = RuntimeRegistry()
bus = EventBus()
settings = SettingsStore()

app = FastAPI(title="DeveloperHCR JARVIS v0.9", version="0.9.0") if FastAPI else None

if app:
    @app.get("/api/v09/runtimes")
    def runtimes():
        data = registry.scan()
        bus.emit("runtime_scan", {"count": len(data)}, "api")
        return data

    @app.get("/api/v09/events")
    def events(limit: int = 100):
        return bus.recent(limit)

    @app.get("/api/v09/settings")
    def get_settings():
        return settings.load()

    @app.post("/api/v09/settings")
    def update_settings(payload: dict):
        allowed = {k:v for k,v in payload.items() if k in settings.load()}
        return settings.update(**allowed)
