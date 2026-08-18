from __future__ import annotations
import json
from pathlib import Path

DEFAULTS = {
    "assistant_name": "JARVIS",
    "landscape_mode": True,
    "auto_authorize_safe_actions": False,
    "voice_enabled": True,
    "voice_offline_only": True,
    "recording_indicator_required": True,
    "recording_enabled": True,
}

class SettingsStore:
    def __init__(self, path=None):
        self.path = Path(path or Path.home()/ "DeveloperHCR" / "Settings" / "jarvis.json")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.save(DEFAULTS)

    def load(self):
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            merged = dict(DEFAULTS); merged.update(data); return merged
        except Exception:
            return dict(DEFAULTS)

    def save(self, data):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)
        return data

    def update(self, **changes):
        data = self.load(); data.update(changes); return self.save(data)
