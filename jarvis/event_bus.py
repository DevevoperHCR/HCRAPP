from __future__ import annotations
import time, uuid, threading
from collections import deque

class EventBus:
    """In-process event bus for Desktop/TUI/API synchronization."""
    def __init__(self, max_events=500):
        self._events = deque(maxlen=max_events)
        self._lock = threading.Lock()

    def emit(self, kind, payload=None, source="system"):
        event = {
            "id": str(uuid.uuid4()),
            "ts": time.time(),
            "kind": kind,
            "source": source,
            "payload": payload or {},
        }
        with self._lock:
            self._events.append(event)
        return event

    def recent(self, limit=100):
        with self._lock:
            return list(self._events)[-max(1, min(limit, len(self._events))):]
