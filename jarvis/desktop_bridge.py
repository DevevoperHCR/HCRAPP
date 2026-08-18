from __future__ import annotations
from pathlib import Path
import platform, os, shutil, socket, time
from .action_log import ActionLog
from .control_policy import classify, can_execute
class DesktopBridge:
    def __init__(self, data_dir=None): self.log = ActionLog(data_dir)
    def system_state(self):
        s={"timestamp":time.time(),"platform":platform.system(),"release":platform.release(),"machine":platform.machine(),"python":platform.python_version(),"hostname":socket.gethostname(),"cwd":os.getcwd()}
        try:
            total,used,free=shutil.disk_usage(Path.home()); s["disk"]={"total":total,"used":used,"free":free}
        except Exception: pass
        try:
            import psutil
            s["cpu_percent"]=psutil.cpu_percent(interval=0.05); s["ram"]=dict(psutil.virtual_memory()._asdict()); b=psutil.sensors_battery(); s["battery"]=dict(b._asdict()) if b else None; s["process_count"]=len(psutil.pids())
        except Exception: pass
        return s
    def note(self, action, status="INFO", details=None): return self.log.record("JARVIS", action, status, details)
    def authorize_command(self, command):
        status=classify(command); self.note("command_authorization", status, {"command":command}); return {"status":status,"allowed":can_execute(command)}
try:
    from fastapi import FastAPI
    app=FastAPI(title="DeveloperHCR JARVIS Desktop Bridge", version="0.6.0"); bridge=DesktopBridge()
    @app.get("/api/jarvis/system")
    def system(): return bridge.system_state()
    @app.get("/api/jarvis/actions")
    def actions(limit:int=100): return bridge.log.recent(max(1,min(limit,500)))
    @app.post("/api/jarvis/authorize")
    def authorize(payload:dict): return bridge.authorize_command(str(payload.get("command","")))
except Exception: app=None
