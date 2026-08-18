from __future__ import annotations
import json, platform, time
from dataclasses import dataclass, asdict
from .action_log import ActionLog
from .control_policy import classify
from .desktop_bridge import DesktopBridge

@dataclass
class JarvisAction:
    action: str
    status: str
    source: str = "desktop"
    details: dict | None = None
    ts: float = 0.0

class JarvisOrchestrator:
    """Level-7 action router: plan -> authorize -> record; never silently bypasses policy."""
    def __init__(self, data_dir=None):
        self.bridge = DesktopBridge(data_dir)
        self.log = ActionLog(data_dir)

    def observe(self):
        state = self.bridge.system_state()
        self.log.record("JARVIS", "system_observe", "OK", {"platform": state.get("platform")})
        return state

    def plan(self, request: str):
        request = (request or "").strip()
        if not request:
            return {"kind": "EMPTY", "request": request, "steps": []}
        return {
            "kind": "ACTION_REQUEST",
            "request": request,
            "steps": [{"step": 1, "operation": "interpret"},
                      {"step": 2, "operation": "authorize"},
                      {"step": 3, "operation": "execute_if_allowed"}],
            "platform": platform.system(),
        }

    def authorize(self, command: str):
        result = self.bridge.authorize_command(command)
        self.log.record("JARVIS", "action_authorize", result["status"], {"command": command})
        return result

    def record_completed(self, action: str, source="desktop", details=None):
        event = JarvisAction(action, "COMPLETED", source, details or {}, time.time())
        self.log.record("JARVIS", action, "COMPLETED", asdict(event))
        return asdict(event)

    def record_denied(self, action: str, reason: str, source="desktop"):
        event = JarvisAction(action, "DENIED", source, {"reason": reason}, time.time())
        self.log.record("JARVIS", action, "DENIED", asdict(event))
        return asdict(event)
