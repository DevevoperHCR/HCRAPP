from __future__ import annotations
import json, sqlite3, time
from pathlib import Path

class ActionLog:
    def __init__(self, base_dir=None):
        base = Path(base_dir or Path.home() / "DeveloperHCR" / "Data")
        base.mkdir(parents=True, exist_ok=True)
        self.db = base / "jarvis_actions.sqlite3"
        with sqlite3.connect(self.db) as con:
            con.execute("CREATE TABLE IF NOT EXISTS actions(id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, details TEXT NOT NULL)")
            con.commit()
    def record(self, actor, action, status, details=None):
        payload = details if isinstance(details, str) else json.dumps(details or {}, ensure_ascii=False)
        with sqlite3.connect(self.db) as con:
            cur = con.execute("INSERT INTO actions(ts,actor,action,status,details) VALUES(?,?,?,?,?)", (time.time(), actor, action, status, payload))
            con.commit(); return int(cur.lastrowid)
    def recent(self, limit=100):
        with sqlite3.connect(self.db) as con:
            con.row_factory = sqlite3.Row
            return [dict(x) for x in con.execute("SELECT * FROM actions ORDER BY id DESC LIMIT ?", (limit,))]
