"""
DeveloperHCR:AI Agent - BETA
server.py - Local backend server (FastAPI)

Powers both the Browser UI and can be queried by a Terminal client.
Binds to 127.0.0.1 by default (NOT publicly exposed) - see launcher.py.
"""

import importlib.util
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import tempfile
import urllib.request
import urllib.error
import urllib.parse
import zipfile
import re
import secrets
import ipaddress
import uuid

import httpx
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# v0.2 additions - new modules only, nothing below this import touches
# the v0.1 code above it.
from backend import ai_models, auth, db, feature_locks

# v0.3 additions - AI chat backend (ai/ package). Also additive only.
from ai import manager as ai_manager
from ai.errors import AIError
from config import load_settings, save_settings, DEFAULT_SETTINGS
from jarvis import core as jarvis_core

APP_VERSION = "1.0-stable"
BASE_DIR = Path(__file__).parent.resolve()
DATA_DIR = Path(os.environ.get("HCR_DATA_DIR", str(Path.home() / ".developerhcr" / "data"))).expanduser()
DATA_DIR.mkdir(parents=True, exist_ok=True)
NOTES_FILE = DATA_DIR / "notes.json"
SETTINGS_FILE = DATA_DIR / "settings.json"

app = FastAPI(title="DeveloperHCR:AI Agent")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

@app.middleware("http")
async def no_cache_dev_assets(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response

START_TIME = time.time()
db.init_db()
app.state.download_jobs = {}
app.state.control_snapshot = {"status": "starting", "updated_at": None}

# BETA 2.0: lightweight background health monitor. It never changes network,
# Bluetooth, files, or processes; it only observes capabilities and health.
def _control_monitor_loop():
    while True:
        try:
            internet = check_internet(timeout=1.0)
            ping = _ping_host("1.1.1.1") if internet else {"ok": False, "host": "1.1.1.1"}
            bt = _bluetooth_status()
            sysinfo = get_system_info()
            app.state.control_snapshot = {
                "status": "healthy" if internet else "degraded",
                "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()+"Z",
                "internet": internet, "ping": ping, "bluetooth": bt,
                "cpu_percent": sysinfo.get("cpu_percent"),
                "ram_used_percent": sysinfo.get("ram_used_percent"),
                "battery_percent": sysinfo.get("battery_percent"),
                "platform": platform.system(),
            }
        except Exception as exc:
            app.state.control_snapshot = {"status":"error", "updated_at":datetime.now(timezone.utc).replace(tzinfo=None).isoformat()+"Z", "error":str(exc)}
        time.sleep(12)


# v1.0: run the critical-file check exactly once for each server process.
# A new server start performs a fresh check; page reloads and repeated API calls
# reuse the cached result and do not scan the project again.
_STARTUP_CHECK_RESULT = None

def _startup_integrity_check():
    global _STARTUP_CHECK_RESULT
    if _STARTUP_CHECK_RESULT is not None:
        return _STARTUP_CHECK_RESULT
    required = [
        "launcher.py", "server.py", "config.py", "requirements.txt", "backend/db.py",
        "backend/auth.py", "static/index.html", "static/app.js", "static/style.css",
        "static/developerhcr-logo.jpg", "ai/manager.py", "jarvis/core.py", "updater.py"
    ]
    missing = [x for x in required if not (BASE_DIR / x).is_file()]
    _STARTUP_CHECK_RESULT = {
        "ok": not missing,
        "checked_once": True,
        "scanned": len(required),
        "missing": missing,
        "checked_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()+"Z",
        "version": APP_VERSION,
    }
    if missing:
        raise RuntimeError("DeveloperHCR integrity check failed: " + ", ".join(missing))
    return _STARTUP_CHECK_RESULT

_startup_integrity_check()

# v1.4: OWNER-controlled settings and friend profiles.
# The default Jyotish credential is stored only as a PBKDF2 hash, never plaintext.

PRIVILEGED_SETTING_KEYS = {
    "update_enabled", "update_repo_owner", "update_repo_name", "update_channel",
    "update_auto_check", "whatsapp_channel", "whatsapp_group",
    "subscription_plans", "future_subscription_prices_inr",
    "friends_only_enabled", "subscription_enabled", "friends_subscription_mode",
    "exe_support_enabled", "store_index_url", "store_enabled",
    "admin_sync_enabled", "admin_sync_endpoint", "admin_sync_include_diagnostics",
}
PUBLIC_SETTING_KEYS = {
    "theme", "language", "assistant_name", "desktop_orientation",
    "force_landscape_rotate", "show_desktop_icons", "sound_enabled", "sound_volume",
    "jarvis_animation", "store_enabled", "update_enabled"
}

# Only these commands are allowed through the web "Terminal" app.
# Real unrestricted shell exec from a network-bound server is unsafe;
# this is the "safe command layer" mentioned in the spec.
SAFE_COMMANDS = {
    "dir": ["cmd", "/c", "dir"] if platform.system() == "Windows" else ["ls", "-la"],
    "whoami": ["whoami"],
    "date": ["cmd", "/c", "date", "/t"] if platform.system() == "Windows" else ["date"],
    "echo": None,  # handled specially
    "ver": ["cmd", "/c", "ver"] if platform.system() == "Windows" else ["uname", "-a"],
}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def is_local(request: Request) -> bool:
    """Defense in depth: only allow risky endpoints from localhost, even
    though the server should already be bound to 127.0.0.1 by default."""
    client = request.client.host if request.client else ""
    return client in ("127.0.0.1", "::1", "localhost")


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def get_system_info():
    info = {
        "os": platform.system(),
        "os_release": platform.release(),
        "os_version": platform.version(),
        "arch": platform.machine(),
        "python": platform.python_version(),
        "hostname": socket.gethostname(),
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "app_version": APP_VERSION,
    }
    if HAS_PSUTIL:
        try:
            vm = psutil.virtual_memory()
            info["ram_total_gb"] = round(vm.total / (1024**3), 2)
            info["ram_used_percent"] = vm.percent
        except (PermissionError, OSError):
            info["ram_total_gb"] = None
            info["ram_used_percent"] = None
        try:
            info["cpu_percent"] = psutil.cpu_percent(interval=0.05)
        except (PermissionError, OSError):
            info["cpu_percent"] = None
        try:
            info["cpu_cores"] = psutil.cpu_count(logical=True)
        except (PermissionError, OSError):
            info["cpu_cores"] = None
        disks = []
        try:
            main_mount = "C:\\" if platform.system() == "Windows" else "/"
        except Exception:
            main_mount = "/"
        for part in psutil.disk_partitions(all=False):
            try:
                usage = psutil.disk_usage(part.mountpoint)
                # Best-effort "is this an external/removable drive" guess:
                # on Windows, any drive letter other than the boot drive is
                # very likely a second disk or a USB stick; on Linux/macOS,
                # anything mounted under /media, /mnt or /run/media is the
                # conventional location for removable storage. This is a
                # heuristic, not a hardware-level check.
                mount_lower = part.mountpoint.lower()
                if platform.system() == "Windows":
                    likely_external = part.mountpoint.rstrip("\\").upper() != main_mount.rstrip("\\").upper()
                else:
                    likely_external = mount_lower.startswith(("/media/", "/mnt/", "/run/media/")) or "removable" in (part.opts or "").lower()
                disks.append({
                    "device": part.device,
                    "mount": part.mountpoint,
                    "fstype": part.fstype,
                    "total_gb": round(usage.total / (1024**3), 2),
                    "free_gb": round(usage.free / (1024**3), 2),
                    "used_percent": usage.percent,
                    "is_main": part.mountpoint.rstrip("\\").upper() == main_mount.rstrip("\\").upper() if platform.system() == "Windows" else part.mountpoint == main_mount,
                    "likely_external": likely_external,
                })
            except (PermissionError, OSError):
                continue
        info["disks"] = disks
        try:
            battery = psutil.sensors_battery()
            if battery:
                info["battery_percent"] = battery.percent
                info["battery_plugged"] = battery.power_plugged
        except Exception:
            pass
    else:
        info["ram_total_gb"] = None
        info["cpu_percent"] = None
        info["disks"] = []
    return info


def check_internet(timeout=1.5) -> bool:
    try:
        socket.setdefaulttimeout(timeout)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
        return True
    except OSError:
        return False

def _network_interfaces():
    out=[]
    if not HAS_PSUTIL:
        return out
    try:
        stats=psutil.net_if_stats(); addrs=psutil.net_if_addrs()
        for name, items in addrs.items():
            st=stats.get(name)
            row={"name":name,"up":bool(st.isup) if st else None,"speed_mbps":getattr(st,"speed",None) if st else None,"addresses":[]}
            for a in items:
                fam=str(a.family)
                if fam.endswith("AF_INET") or fam.endswith("AF_INET6"):
                    row["addresses"].append({"address":a.address,"netmask":a.netmask})
            out.append(row)
    except Exception:
        pass
    return out


def _bluetooth_status():
    system=platform.system()
    result={"available":False,"powered":None,"detail":"Bluetooth status unavailable on this platform."}
    try:
        if system=="Linux" and shutil.which("bluetoothctl"):
            r=subprocess.run(["bluetoothctl","show"],capture_output=True,text=True,timeout=3)
            txt=r.stdout+r.stderr
            result["available"]=r.returncode==0
            m=re.search(r"Powered:\s*(yes|no)",txt,re.I)
            result["powered"]=m.group(1).lower()=="yes" if m else None
            result["detail"]="bluetoothctl detected"
        elif system=="Darwin" and shutil.which("system_profiler"):
            r=subprocess.run(["system_profiler","SPBluetoothDataType"],capture_output=True,text=True,timeout=5)
            result["available"]=r.returncode==0
            result["detail"]="macOS Bluetooth service detected" if result["available"] else "Bluetooth service unavailable"
        elif system=="Windows":
            result["available"]=bool(shutil.which("powershell") or shutil.which("pwsh"))
            result["detail"]="Windows Bluetooth settings can be opened by the OS." if result["available"] else "PowerShell unavailable"
    except Exception as e:
        result["detail"]=str(e)
    return result


def _dns_servers():
    servers=[]
    if platform.system()=="Windows":
        try:
            r=subprocess.run(["ipconfig","/all"],capture_output=True,text=True,timeout=4)
            for line in r.stdout.splitlines():
                if "DNS Servers" in line or line.strip().startswith("DNS Servers"):
                    value=line.split(":",1)[-1].strip()
                    if value: servers.append(value)
        except Exception: pass
    else:
        try:
            for line in Path("/etc/resolv.conf").read_text(errors="ignore").splitlines():
                if line.strip().startswith("nameserver"):
                    servers.append(line.split()[1])
        except Exception: pass
    return list(dict.fromkeys(servers))


def _ping_host(host="1.1.1.1"):
    try:
        if platform.system()=="Windows": cmd=["ping","-n","1","-w","1500",host]
        else: cmd=["ping","-c","1","-W","2",host]
        t=time.perf_counter(); r=subprocess.run(cmd,capture_output=True,text=True,timeout=4); ms=round((time.perf_counter()-t)*1000,1)
        return {"ok":r.returncode==0,"latency_ms":ms,"host":host,"output":(r.stdout or r.stderr)[-800:]}
    except Exception as e: return {"ok":False,"host":host,"error":str(e)}


def _safe_download_url(url):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!="https" or not parsed.hostname: raise ValueError("Download URL must use HTTPS.")
    host=parsed.hostname
    try:
        infos=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
        for info in infos:
            ip=ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                raise ValueError("Private/local download hosts are blocked.")
    except socket.gaierror as e: raise ValueError(f"Could not resolve download host: {e}")
    return url


def _download_worker(job_id,url):
    jobs=app.state.download_jobs
    job=jobs[job_id]
    try:
        ddir=DATA_DIR/"downloads"; ddir.mkdir(parents=True,exist_ok=True)
        name=Path(urllib.parse.urlparse(url).path).name or f"download-{job_id}.bin"
        name=re.sub(r"[^A-Za-z0-9._-]+","_",name)[:120]
        dest=ddir/name
        if dest.exists(): dest=ddir/f"{dest.stem}-{job_id[:8]}{dest.suffix}"
        req=urllib.request.Request(url,headers={"User-Agent":"DeveloperHCR/1.0"})
        with urllib.request.urlopen(req,timeout=30) as r, dest.open("wb") as f:
            total=int(r.headers.get("Content-Length") or 0); done=0
            while True:
                chunk=r.read(256*1024)
                if not chunk: break
                done+=len(chunk); f.write(chunk)
                job.update({"status":"downloading","bytes":done,"total":total,"progress":round(done*100/total,1) if total else None})
        job.update({"status":"complete","path":str(dest),"name":dest.name,"progress":100})
    except Exception as e:
        job.update({"status":"error","error":str(e)})


# Start the observer only after all helper functions it calls are defined.
# It is read-only: no network/Bluetooth/file/process mutation occurs here.
threading.Thread(target=_control_monitor_loop, daemon=True, name="hcr-control-monitor").start()


# --------------------------------------------------------------------------
# Core routes
# --------------------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(str(BASE_DIR / "static" / "index.html"))


@app.get("/api/system")
def api_system():
    data = get_system_info()
    data["online"] = check_internet()
    data["app_version"] = APP_VERSION
    data["platform"] = platform.platform()
    return data


@app.get("/api/control-center")
def control_center(user=Depends(auth.require_login)):
    net=_network_interfaces()
    bt=_bluetooth_status()
    ping=_ping_host()
    snap=dict(getattr(app.state, "control_snapshot", {}) or {})
    return {"ok":True,"background_monitor":snap,"internet":check_internet(),"ping":ping,"dns":_dns_servers(),"interfaces":net,
            "bluetooth":bt,"platform":platform.system(),"capabilities":{
                "network_diagnostics":True,"bluetooth_status":bt["available"],
                "open_system_settings":True,"network_reset":user["role"] in ("ADMIN","OWNER"),
                "bluetooth_power_control":platform.system()=="Linux" and bool(shutil.which("bluetoothctl")),
                "downloads":True,"exe_runner":platform.system()=="Windows" or bool(shutil.which("wine") or shutil.which("wine64"))}}

@app.post("/api/control-center/bluetooth")
async def bluetooth_power(request:Request,user=Depends(auth.require_admin)):
    if not is_local(request): return JSONResponse({"error":"local only"},status_code=403)
    body=await request.json(); action=str(body.get("action",""))
    if action not in ("on","off"): return JSONResponse({"error":"action must be on or off"},status_code=400)
    if platform.system()!="Linux" or not shutil.which("bluetoothctl"):
        return JSONResponse({"error":"Bluetooth power control is unavailable on this platform. Use Open Bluetooth Settings."},status_code=400)
    try:
        r=subprocess.run(["bluetoothctl","power",action],capture_output=True,text=True,timeout=5)
        ok=r.returncode==0
        db.audit(user["id"],user["username"],"bluetooth_power",action)
        return {"ok":ok,"action":action,"output":(r.stdout or r.stderr).strip()}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

@app.post("/api/downloads/start")
async def downloads_start(request:Request,user=Depends(auth.require_login)):
    body=await request.json(); url=str(body.get("url","")).strip()
    try: _safe_download_url(url)
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)
    job_id=uuid.uuid4().hex; app.state.download_jobs[job_id]={"id":job_id,"status":"queued","bytes":0,"total":0,"progress":0}
    threading.Thread(target=_download_worker,args=(job_id,url),daemon=True).start()
    db.audit(user["id"],user["username"],"download_start",url[:300])
    return {"ok":True,"job":app.state.download_jobs[job_id]}

@app.get("/api/downloads/status/{job_id}")
def downloads_status(job_id:str,user=Depends(auth.require_login)):
    job=app.state.download_jobs.get(job_id)
    if not job: return JSONResponse({"error":"download job not found"},status_code=404)
    return job

@app.get("/api/downloads/files")
def downloads_files(user=Depends(auth.require_login)):
    ddir=DATA_DIR/"downloads"; ddir.mkdir(parents=True,exist_ok=True)
    files=[]
    for p in sorted(ddir.iterdir(),key=lambda x:x.stat().st_mtime,reverse=True):
        if p.is_file(): files.append({"name":p.name,"path":str(p),"size":p.stat().st_size})
    return {"files":files[:100]}

@app.get("/api/app-health")
def app_health(request: Request, user=Depends(auth.require_login)):
    """Run a lightweight health sweep for the installed DeveloperHCR stack.
    It reports real checks only; unavailable optional runtimes are labelled.
    """
    checks = []
    def add(name, ok, detail):
        checks.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    add("Local server", True, "API is responding")
    add("Database", db.init_db() is None, "SQLite database ready")
    add("Static UI", (BASE_DIR / "static" / "index.html").exists(), "index.html present")
    add("AI provider", bool(shutil.which("ollama")), "Ollama CLI detected" if shutil.which("ollama") else "Ollama CLI not installed")
    add("Python", True, platform.python_version())
    add("Storage", shutil.disk_usage(BASE_DIR).free > 50 * 1024 * 1024, f"{shutil.disk_usage(BASE_DIR).free // (1024**2)} MB free")
    _net_ok = check_internet(timeout=1.5)
    add("Network", _net_ok, "Online" if _net_ok else "Offline")
    # Check the browser application registry without executing application code.
    ui_js = (BASE_DIR / "static" / "app.js").read_text(encoding="utf-8", errors="ignore") if (BASE_DIR / "static" / "app.js").exists() else ""
    core = ["files","jarvis","aichat","notes","calc","terminal","browser","settings","store","control","sysmon","aimodels","games","trading","wallpaper","theme","network","toolchains","playground","troubleshoot","security"]
    missing_core = [x for x in core if f'id: "{x}"' not in ui_js]
    add("Core app registry", not missing_core, f"{len(core)-len(missing_core)}/{len(core)} core apps registered" + (f"; missing: {', '.join(missing_core)}" if missing_core else ""))
    game_ids = ["game-snake","game-pong","game-tetris","game-memory","game-ttt","game-reflex","game-cube","game-orbit","game-dice","game-guess","game-breakout","game-mines","game-flappy","game-maze","game-starfield","game-solar"]
    missing_games = [x for x in game_ids if f'id: "{x}"' not in ui_js]
    add("Standalone game registry", not missing_games, f"{len(game_ids)-len(missing_games)}/{len(game_ids)} standalone games registered" + (f"; missing: {', '.join(missing_games)}" if missing_games else ""))
    # V2.0 BETA+: validate every APPS renderer reference and duplicate IDs so a
    # broken renderer cannot silently make one Store/App Menu entry unusable.
    import re
    app_block = ui_js.split("const APPS = [", 1)[1].split("];", 1)[0] if "const APPS = [" in ui_js and "const APPS = [" in ui_js.split("const APPS = [",1)[1] else ""
    app_ids = re.findall(r'\{\s*id:\s*["\']([^"\']+)["\']', app_block)
    duplicate_ids = sorted({x for x in app_ids if app_ids.count(x) > 1})
    renderer_names = [x for x in re.findall(r'render:\s*([A-Za-z_$][A-Za-z0-9_$]*)', app_block) if x != "body"]
    missing_renderers = sorted({name for name in renderer_names if not re.search(r'(?:function|const)\s+' + re.escape(name) + r'\b', ui_js)})
    add("App registry integrity", bool(app_ids) and not duplicate_ids and not missing_renderers, f"{len(app_ids)} entries; {len(duplicate_ids)} duplicate IDs; {len(missing_renderers)} missing renderers" + (f"; duplicates: {', '.join(duplicate_ids[:5])}" if duplicate_ids else "") + (f"; missing: {', '.join(missing_renderers[:5])}" if missing_renderers else ""))
    add("Store catalog coverage", len(app_ids) >= 75, f"{len(app_ids)} built-in app entries available to the Store/App Menu")
    add("Game styles", (BASE_DIR / "static" / "style.css").exists() and "orbit-scene" in (BASE_DIR / "static" / "style.css").read_text(encoding="utf-8", errors="ignore") and "solar-scene" in (BASE_DIR / "static" / "style.css").read_text(encoding="utf-8", errors="ignore"), "2D/3D game styles present")
    healthy = sum(1 for c in checks if c["ok"])
    return {"ok": healthy == len(checks), "healthy": healthy, "total": len(checks), "checks": checks, "generated_at": datetime.now(timezone.utc).isoformat()}

@app.get("/api/repository/status")
async def repository_status(user=Depends(auth.require_login)):
    settings = get_settings_merged()
    repo = settings.get("devapps_repository_url", "https://github.com/DevevoperHCR/Devapps")
    api_url = settings.get("devapps_repository_api", "https://api.github.com/repos/DevevoperHCR/Devapps/contents")
    result = {"ok": True, "repository": repo, "apps_manifest": None, "entries": [], "online": False}
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent":"DeveloperHCR/1.0", "Accept":"application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=6) as r:
            data = json.loads(r.read().decode("utf-8"))
        result["online"] = True
        result["entries"] = [{"name": x.get("name"), "type": x.get("type"), "download_url": x.get("download_url")} for x in data if isinstance(x, dict)] if isinstance(data, list) else []
        for candidate in ("apps.json", "store.json", "manifest.json"):
            item = next((x for x in result["entries"] if x.get("name") == candidate), None)
            if item and item.get("download_url"):
                try:
                    req2=urllib.request.Request(item["download_url"],headers={"User-Agent":"DeveloperHCR/1.0"})
                    with urllib.request.urlopen(req2, timeout=5) as rr:
                        remote=json.loads(rr.read().decode("utf-8"))
                    result["apps_manifest"] = candidate
                    result["apps"] = remote.get("apps", remote) if isinstance(remote, dict) else remote
                except Exception:
                    pass
                break
    except Exception as exc:
        result["ok"] = False
        result["error"] = str(exc)
    return result

@app.get("/api/health")
def api_health():
    return {
        "ok": True,
        "app": "DeveloperHCR:AI Agent",
        "version": APP_VERSION,
        "uptime_sec": round(time.time() - START_TIME, 2),
        "database": "sqlite",
        "server_time": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
    }


@app.get("/api/startup/check")
def startup_check():
    # Return the cached result from this server process. A restart runs a fresh check.
    return dict(_STARTUP_CHECK_RESULT or _startup_integrity_check())

@app.get("/api/diagnostics")
def api_diagnostics():
    checks = []
    checks.append({"name": "python", "ok": sys.version_info >= (3, 9), "detail": platform.python_version()})
    checks.append({"name": "psutil", "ok": HAS_PSUTIL, "detail": "installed" if HAS_PSUTIL else "missing"})
    checks.append({"name": "database", "ok": True, "detail": str(db.DB_PATH)})
    try:
        db.get_conn().execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        db_ok = False
    checks[-1]["ok"] = db_ok
    checks.append({"name": "static_files", "ok": (BASE_DIR / "static" / "index.html").exists(), "detail": str(BASE_DIR / "static")})
    checks.append({"name": "ollama_cli", "ok": bool(shutil.which("ollama")), "detail": shutil.which("ollama") or "not found"})
    checks.append({"name": "network", "ok": check_internet(), "detail": "online" if check_internet() else "offline"})
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


@app.get("/api/processes")
def api_processes(request: Request):
    if not HAS_PSUTIL:
        return JSONResponse({"error": "psutil not installed"}, status_code=500)
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            procs.append(p.info)
        except Exception:
            continue
    procs.sort(key=lambda x: x.get("memory_percent") or 0, reverse=True)
    return {"processes": procs[:60]}


@app.post("/api/processes/{pid}/kill")
def kill_process(pid: int, request: Request, user=Depends(auth.require_admin)):
    if not is_local(request):
        return JSONResponse({"error": "denied: local only"}, status_code=403)
    if not HAS_PSUTIL:
        return JSONResponse({"error": "psutil not installed"}, status_code=500)
    try:
        psutil.Process(pid).terminate()
        db.audit(user["id"], user["username"], "kill_process", f"pid={pid}")
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


# ---- Files app (read-only browse; restricted to user's home dir tree) ----

def safe_resolve(rel_path: str) -> Path:
    home = Path.home().resolve()
    target = (home / rel_path).resolve() if rel_path else home
    if home not in target.parents and target != home:
        target = home  # refuse to leave home directory
    return target


@app.post("/api/archive/list")
async def archive_list(request: Request, user=Depends(auth.require_login)):
    """Inspect a ZIP supplied by the browser without extracting it.
    The archive is kept only in memory for this request and filenames are
    returned as metadata. No archive entry is written to disk.
    """
    raw = await request.body()
    if not raw:
        return JSONResponse({"error": "empty archive"}, status_code=400)
    if len(raw) > 100 * 1024 * 1024:
        return JSONResponse({"error": "archive is larger than the 100 MB BETA inspection limit"}, status_code=413)
    try:
        with zipfile.ZipFile(__import__('io').BytesIO(raw)) as zf:
            entries=[]
            for info in zf.infolist()[:1000]:
                name=info.filename.replace("\\", "/")
                entries.append({"name": name, "directory": info.is_dir(), "size": info.file_size})
        db.audit(user["id"], user["username"], "archive_inspected", f"entries={len(entries)}")
        return {"ok": True, "count": len(entries), "entries": entries}
    except zipfile.BadZipFile:
        return JSONResponse({"error": "invalid or unsupported ZIP archive"}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/api/backup/create")
def backup_create(user=Depends(auth.require_login)):
    """Create a safe JSON backup of user-owned application data.
    Passwords, tokens and vault secrets are deliberately excluded.
    """
    notes=load_json(NOTES_FILE, [])
    settings=get_settings_merged()
    safe_settings={k:v for k,v in settings.items() if "password" not in k.lower() and "secret" not in k.lower() and "token" not in k.lower() and "key" not in k.lower()}
    backup={
        "format":"DeveloperHCR-backup",
        "version":1,
        "app_version":APP_VERSION,
        "created_at":datetime.now(timezone.utc).replace(tzinfo=None).isoformat()+"Z",
        "user":{"id":user["id"],"username":user["username"]},
        "settings":safe_settings,
        "notes":notes,
    }
    db.audit(user["id"], user["username"], "backup_created", "settings_and_notes")
    return {"ok":True,"filename":f"DeveloperHCR-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json","backup":backup}


@app.post("/api/backup/restore")
async def backup_restore(request: Request, user=Depends(auth.require_login)):
    body=await request.json()
    backup=body.get("backup") if isinstance(body,dict) else None
    if not isinstance(backup,dict) or backup.get("format")!="DeveloperHCR-backup":
        return JSONResponse({"error":"invalid DeveloperHCR backup"},status_code=400)
    if backup.get("version") != 1:
        return JSONResponse({"error":"unsupported backup version"},status_code=400)
    settings=backup.get("settings",{})
    if isinstance(settings,dict):
        safe={k:v for k,v in settings.items() if k in PUBLIC_SETTING_KEYS}
        if safe:
            current=load_settings(); current.update(safe); save_settings(current)
    notes=backup.get("notes",[])
    if isinstance(notes,list):
        save_json(NOTES_FILE, notes[:500])
    db.audit(user["id"], user["username"], "backup_restored", "settings_and_notes")
    return {"ok":True,"message":"Backup restored. Restart DeveloperHCR if a setting requires a full reload."}


@app.get("/api/files")
def list_files(path: str = ""):
    target = safe_resolve(path)
    if not target.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    items = []
    try:
        for entry in sorted(target.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            try:
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size if entry.is_file() else None,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
            except (PermissionError, OSError):
                continue
    except PermissionError:
        return JSONResponse({"error": "permission denied"}, status_code=403)
    home = Path.home().resolve()
    rel = str(target.relative_to(home)) if target != home else ""
    return {"path": rel, "items": items, "home": str(home)}


# ---- Notes app ----

@app.get("/api/notes")
def get_notes():
    return {"notes": load_json(NOTES_FILE, [])}


@app.post("/api/notes")
async def save_notes(request: Request):
    body = await request.json()
    notes = body.get("notes", [])
    save_json(NOTES_FILE, notes)
    return {"ok": True}


# ---- v3.6: Password Vault (was in HCR Store catalog with no real app
# behind it — this fixes that). Local, per-user storage only; NOT strong
# encryption, so the UI is honest about that rather than claiming it.

@app.get("/api/vault")
def vault_list(user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT id, title, site_username, url, notes, updated_at FROM vault_entries WHERE user_id=? ORDER BY id DESC", (user["id"],))
        return {"items": [dict(r) for r in cur.fetchall()]}


@app.post("/api/vault")
async def vault_add(request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO vault_entries (user_id, title, site_username, site_password, url, notes) VALUES (?,?,?,?,?,?)",
            (user["id"], title, body.get("username", ""), body.get("password", ""), body.get("url", ""), body.get("notes", "")),
        )
    db.audit(user["id"], user["username"], "vault_entry_added", title)
    return {"ok": True}


@app.get("/api/vault/{entry_id}/reveal")
def vault_reveal(entry_id: int, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM vault_entries WHERE id=? AND user_id=?", (entry_id, user["id"]))
        row = cur.fetchone()
    if not row:
        return JSONResponse({"error": "not found"}, status_code=404)
    db.audit(user["id"], user["username"], "vault_entry_revealed", str(entry_id))
    return dict(row)


@app.post("/api/vault/{entry_id}/delete")
def vault_delete(entry_id: int, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("DELETE FROM vault_entries WHERE id=? AND user_id=?", (entry_id, user["id"]))
    db.audit(user["id"], user["username"], "vault_entry_deleted", str(entry_id))
    return {"ok": True}


# ---- Settings app ----

DEFAULT_SETTINGS = {
    "theme": "dark",
    "language": "en",
    # v0.3: AI settings (global for now - the existing settings store is
    # global, not per-user; per-user AI prefs would need a schema change,
    # noted as a future improvement in README).
    "ai_default_provider": "ollama",
    "ai_default_model": "",
    "ai_temperature": 0.7,
    "ai_context_length": 2048,
    "ai_streaming": True,
    "ai_system_prompt": "You are DeveloperHCR AI Agent, a helpful local assistant. Be concise and honest.",
    "ai_max_history_messages": 20,
    "ai_generation_timeout": 120,
    "ai_model_dirs": [],
    # v1.0: desktop/UI preferences
    "force_landscape_rotate": False,
    "show_desktop_icons": True,
    # v1.0: voice model download/ready state (Settings > Voice)
    "voice_model_name": "vosk-small-en (offline speech-to-text)",
    "voice_model_downloaded": False,
    # v1.1 social/store/update controls
    "friends_only_enabled": True,
    "subscription_enabled": True,
    "admin_sync_enabled": True,
    "admin_sync_include_diagnostics": True,
    "subscription_whatsapp_confirmation": True,
    "friends_subscription_mode": "friends_or_subscription",
    "store_enabled": True,
    "store_index_url": "",
    "update_enabled": True,
    "update_repo_owner": "DevevoperHCR",
    "update_repo_name": "HCRAPP",
    "update_channel": "stable",
    "update_auto_check": True,
    "startup_file_checkup_enabled": False,
    "startup_file_checkup_timeout_seconds": 20,
    "jarvis_capture_quality": "medium",
    "jarvis_capture_size": "full",
    "exe_support_enabled": True,
    "whatsapp_channel": "",
    "whatsapp_group": "",
    "support_email": "developerhcr@gmail.com",
    "support_instagram": "https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw",
    "subscriber_guest_password_hash": "",
    "subscriber_guest_password_salt": "",
    "subscription_plans": [
        {"id":"FREE","price_inr":0,"label":"Free","features":["notes","calculator","games","basic_ai"]},
        {"id":"RUPEE_1","price_inr":1,"label":"₹1","features":["notes","calculator","games","browser","basic_ai","store"]},
        {"id":"RUPEE_10","price_inr":10,"label":"₹10","features":["all_basic","browser","ai_models","store","feedback","support"]},
        {"id":"RUPEE_100","price_inr":100,"label":"₹100","features":["all"]}
    ],
    "future_subscription_prices_inr": [500,1000,5000],
}


def get_settings_merged():
    """Merge legacy settings with the central v0.4 defaults without discarding user data."""
    current = load_json(SETTINGS_FILE, {})
    merged = {**DEFAULT_SETTINGS, **current}
    central = load_settings()
    for key, value in central.items():
        if key not in merged or merged[key] == DEFAULT_SETTINGS.get(key):
            merged[key] = value
    # V2.0 BETA+ migration: existing installs that were created with blank
    # update repository fields now use the official HCRAPP repository by
    # default. Admin configuration remains editable, but is no longer a
    # prerequisite just to check for updates.
    if not str(merged.get("update_repo_owner") or "").strip():
        merged["update_repo_owner"] = "DevevoperHCR"
    if not str(merged.get("update_repo_name") or "").strip():
        merged["update_repo_name"] = "HCRAPP"
    # Keep the legacy/public key name working while the new config helper
    # also accepts ai_gguf_directories.
    if not merged.get("ai_gguf_directories") and merged.get("ai_model_dirs"):
        merged["ai_gguf_directories"] = list(merged["ai_model_dirs"])
    return merged


@app.get("/api/settings")
def get_settings(user=Depends(auth.current_user)):
    settings = get_settings_merged()
    if user:
        return settings
    # Pre-login callers only receive non-sensitive UI settings.
    return {k: settings.get(k) for k in PUBLIC_SETTING_KEYS if k in settings}


@app.post("/api/settings")
async def update_settings(request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    if not isinstance(body, dict):
        return JSONResponse({"error": "settings must be an object"}, status_code=400)
    privileged = [k for k in body if k in PRIVILEGED_SETTING_KEYS]
    if privileged and user["role"] != "ADMIN":
        return JSONResponse({"error": "Admin-only settings: " + ", ".join(privileged)}, status_code=403)
    current = get_settings_merged()
    current.update(body)
    dirs = current.get("ai_model_dirs", current.get("ai_gguf_directories", []))
    if not isinstance(dirs, list) or any(not isinstance(x, str) or len(x) > 500 for x in dirs):
        return JSONResponse({"error": "ai_model_dirs must be a list of path strings"}, status_code=400)
    current["ai_model_dirs"] = dirs[:20]
    current["ai_gguf_directories"] = list(current["ai_model_dirs"])
    save_json(SETTINGS_FILE, current)
    save_settings(current)
    db.audit(user["id"], user["username"], "settings_change", json.dumps(body))
    return current


@app.get("/api/system/file-checkup")
def system_file_checkup(user=Depends(auth.require_login)):
    """Read-only project file verification. Never executes, deletes or rewrites files."""
    issues=[]; checked=0
    excluded={".git","__pycache__",".pytest_cache","data"}
    for path in BASE_DIR.rglob("*"):
        if not path.is_file():
            continue
        try:
            rel=path.relative_to(BASE_DIR)
        except ValueError:
            continue
        if any(part in excluded for part in rel.parts):
            continue
        checked += 1
        try:
            st=path.stat()
            if st.st_size < 0:
                issues.append({"ok":False,"path":str(rel),"detail":"Invalid file size reported by filesystem."})
            else:
                # For text/source files, verify they can be decoded. Binary assets are only stat-checked.
                if path.suffix.lower() in {".py",".js",".css",".html",".md",".txt",".json",".xml",".yml",".yaml",".bat",".ps1",".sh"}:
                    path.read_text(encoding="utf-8")
                issues.append({"ok":True,"path":str(rel),"detail":f"Readable; {st.st_size} bytes."})
        except Exception as exc:
            issues.append({"ok":False,"path":str(rel),"detail":f"Read/check failed: {exc}"})
    bad=[x for x in issues if not x["ok"]]
    return {"ok":not bad,"checked":checked,"issues":issues if bad else issues[:100],"message":("All checked files are readable." if not bad else f"{len(bad)} file issue(s) found.")}


# ---- Terminal app (safe command layer only) ----

TERMINAL_AI_SESSIONS = {}  # user_id -> {"provider": str, "model": str, "conversation_id": int|None}


def _terminal_ai_session(user_id):
    return TERMINAL_AI_SESSIONS.setdefault(user_id, {"provider": "ollama", "model": "", "conversation_id": None})


async def _terminal_ai_command(key, rest, user):
    """v0.3: AI commands for the browser-based safe-mode Terminal (this is
    NOT a standalone OS-level TUI - see README for that distinction)."""
    session = _terminal_ai_session(user["id"])

    if key == "/help":
        return ("AI commands: /models /model <name> /provider <ollama|gguf> /new /history "
                "/clear /stop /status /ai <message> /help")

    if key == "/models":
        status = await ai_manager.full_status()
        lines = []
        for pname, pstatus in status.items():
            lines.append(f"[{pname}] installed={pstatus['installed']} running={pstatus['running']}")
            for m in pstatus["models"]:
                lines.append(f"    {m['name']}")
            if pstatus.get("error"):
                lines.append(f"    note: {pstatus['error']}")
        return "\n".join(lines) or "No providers detected."

    if key == "/provider":
        if not rest:
            return f"Current provider: {session['provider']}"
        if rest not in ("ollama", "gguf"):
            return "Provider must be 'ollama' or 'gguf'."
        session["provider"] = rest
        db.audit(user["id"], user["username"], "ai_provider_selected", rest)
        return f"Provider set to {rest}."

    if key == "/model":
        if not rest:
            return f"Current model: {session['model'] or '(none set)'}"
        session["model"] = rest
        db.audit(user["id"], user["username"], "ai_model_selected", rest)
        return f"Model set to {rest}."

    if key == "/new":
        if not session["model"]:
            return "Set a model first with /model <name>."
        with db.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (user_id, title, provider, model) VALUES (?, 'New Chat', ?, ?)",
                (user["id"], session["provider"], session["model"]),
            )
            session["conversation_id"] = cur.lastrowid
        db.audit(user["id"], user["username"], "chat_created", f"provider={session['provider']} model={session['model']} via=terminal")
        await broadcast_event({"type": "ai-conversation-created", "conversation_id": session["conversation_id"]})
        return f"New conversation #{session['conversation_id']} started."

    if key == "/history":
        with db.cursor() as cur:
            cur.execute("SELECT id, title, provider, model, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 15", (user["id"],))
            rows = cur.fetchall()
        if not rows:
            return "No conversations yet."
        return "\n".join(f"#{r['id']}  {r['title']}  ({r['provider']}/{r['model']})  {r['updated_at']}" for r in rows)

    if key == "/clear":
        if not session["conversation_id"]:
            return "No active conversation. Use /new first."
        with db.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE conversation_id = ?", (session["conversation_id"],))
        return "Conversation cleared."

    if key == "/stop":
        cid = session["conversation_id"]
        if cid and cid in ACTIVE_GENERATIONS:
            ACTIVE_GENERATIONS[cid]["stop"] = True
            ACTIVE_GENERATIONS[cid]["stop_event"].set()
            return "Stop requested."
        return "Nothing is generating."

    if key == "/status":
        cid = session["conversation_id"]
        gen = "GENERATING" if cid in ACTIVE_GENERATIONS else "IDLE"
        return f"Provider: {session['provider']}\nModel: {session['model'] or '(none)'}\nConversation: {cid or '(none)'}\nStatus: {gen}"

    if key == "/ai":
        if not rest:
            return "Usage: /ai <message>"
        if not session["model"]:
            return "Set a model first with /model <name>."
        if not session["conversation_id"]:
            with db.cursor() as cur:
                cur.execute(
                    "INSERT INTO conversations (user_id, title, provider, model) VALUES (?, 'New Chat', ?, ?)",
                    (user["id"], session["provider"], session["model"]),
                )
                session["conversation_id"] = cur.lastrowid
        cid = session["conversation_id"]
        with db.cursor() as cur:
            cur.execute("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)", (cid, rest))
            cur.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id", (cid,))
            history = cur.fetchall()
        settings = get_settings_merged()
        chat_messages = [{"role": "system", "content": settings.get("ai_system_prompt", "")}]
        chat_messages += [{"role": r["role"], "content": r["content"]} for r in history[-settings.get("ai_max_history_messages", 20):]]
        stop_event = threading.Event()
        ACTIVE_GENERATIONS[cid] = {"stop": False, "stop_event": stop_event}
        await broadcast_event({"type": "ai-status", "conversation_id": cid, "status": "GENERATING"})
        full_text, error_msg = "", None
        try:
            provider = ai_manager.get_provider(session["provider"])
            async for event in provider.stream_chat(session["model"], chat_messages, {
                "temperature": settings.get("ai_temperature"),
                "context_length": settings.get("ai_context_length"),
                "timeout": settings.get("ai_generation_timeout", 120),
                "stop_event": stop_event,
            }):
                if ACTIVE_GENERATIONS.get(cid, {}).get("stop"):
                    break
                if event["type"] == "chunk":
                    full_text += event["text"]
        except AIError as e:
            error_msg = e.user_message
        except Exception as e:
            error_msg = f"Unexpected AI error: {e}"
        finally:
            stopped = ACTIVE_GENERATIONS.get(cid, {}).get("stop", False)
            ACTIVE_GENERATIONS.pop(cid, None)
            status = "error" if error_msg else ("stopped" if stopped else "completed")
            with db.cursor() as cur:
                if full_text:
                    cur.execute("INSERT INTO messages (conversation_id, role, content, error) VALUES (?, 'assistant', ?, ?)", (cid, full_text, error_msg))
                cur.execute("UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?", (status, cid))
            await broadcast_event({"type": "ai-status", "conversation_id": cid, "status": status.upper()})
        return f"(error) {error_msg}" if error_msg else (full_text or "(stopped, no output)")

    return None  # not an AI command


@app.post("/api/batch/run")
async def batch_run(request: Request, user=Depends(auth.require_login)):
    """Local Windows .BAT/.CMD runner; Admin/Owner only and explicitly confirmed."""
    if user["role"] not in ("OWNER", "ADMIN"):
        return JSONResponse({"error":"Owner/Admin permission required"}, status_code=403)
    if not is_local(request):
        return JSONResponse({"error":"local only"}, status_code=403)
    body = await request.json()
    if body.get("confirm") is not True:
        return JSONResponse({"error":"explicit confirmation required"}, status_code=400)
    raw = str(body.get("path") or "")
    p = Path(raw).expanduser().resolve()
    if platform.system() != "Windows":
        return JSONResponse({"error":"Windows .BAT/.CMD execution is available only when DeveloperHCR runs on Windows."}, status_code=400)
    if not p.is_file() or p.suffix.lower() not in (".bat", ".cmd"):
        return JSONResponse({"error":"select a valid .bat or .cmd file"}, status_code=400)
    try:
        proc = subprocess.Popen(["cmd.exe", "/c", "start", "DeveloperHCR Batch", "cmd.exe", "/k", str(p)], cwd=str(p.parent), creationflags=getattr(subprocess,"CREATE_NEW_CONSOLE",0))
        db.audit(user["id"], user["username"], "batch_run", str(p))
        return {"ok":True,"pid":proc.pid,"output":f"Started {p.name} in a new Windows console window."}
    except Exception as e:
        return JSONResponse({"error":str(e)}, status_code=400)

@app.post("/api/terminal/run")
async def terminal_run(request: Request, user=Depends(auth.require_login)):
    if not is_local(request):
        return JSONResponse({"error": "denied: local only"}, status_code=403)
    body = await request.json()
    cmd = (body.get("command") or "").strip()
    if not cmd:
        return {"output": ""}
    parts = cmd.split(" ", 1)
    key = parts[0].lower()
    rest = parts[1].strip() if len(parts) > 1 else ""

    if key.startswith("/"):
        ai_result = await _terminal_ai_command(key, rest, user)
        if ai_result is not None:
            return {"output": ai_result}
        return {"output": f"Unknown AI command '{key}'. Try /help."}

    if key == "echo":
        return {"output": parts[1] if len(parts) > 1 else ""}

    if key == "help":
        return {"output": "Safe-mode commands: " + ", ".join(SAFE_COMMANDS.keys()) + "\n"
                           "AI chat commands: type /help\n"
                           "Full unrestricted shell is a planned future feature "
                           "(will require explicit local confirmation)."}

    if key not in SAFE_COMMANDS:
        return {"output": f"'{key}' is not enabled in safe mode. Type 'help' for the allowed list."}

    try:
        result = subprocess.run(SAFE_COMMANDS[key], capture_output=True, text=True, timeout=10)
        out = result.stdout + result.stderr
        return {"output": out}
    except Exception as e:
        return {"output": f"error: {e}"}


# --------------------------------------------------------------------------
# v0.2 - Phase 1: Authentication / RBAC
# --------------------------------------------------------------------------

def user_public(u):
    return {"id": u["id"], "username": u["username"], "role": u["role"], "status": u["status"],
            "created_at": u["created_at"]}


@app.get("/api/startup/checkup-status")
def startup_checkup_status():
    """Public, read-only startup preference so the launcher can avoid a fake
    loading/checkup screen before login. No account data is exposed."""
    settings = get_settings_merged()
    return {
        "enabled": bool(settings.get("startup_file_checkup_enabled", False)),
        "timeout_seconds": max(1, int(settings.get("startup_file_checkup_timeout_seconds", 5) or 5)),
    }


@app.get("/api/auth/status")
def auth_status():
    """First-run status. Owner control is created internally and never shown.
    The only user-facing setup is the Admin account."""
    owner_id = auth.ensure_internal_owner()
    owner_ok = True
    # Restore a previously-created visible Admin before reporting first-run.
    auth.restore_persistent_admin()
    admin_ok = auth.configurable_admin_exists()
    friend_ok = False
    subscriber_ok = False
    if owner_ok:
        with db.cursor() as cur:
            cur.execute("SELECT 1 FROM friend_profiles WHERE owner_user_id IN (SELECT id FROM users WHERE role='ADMIN') AND enabled=1 LIMIT 1")
            friend_ok = cur.fetchone() is not None
        settings = get_settings_merged()
        subscriber_ok = bool(settings.get("subscriber_guest_password_hash") and settings.get("subscriber_guest_password_salt"))
    return {"admin_configured": admin_ok, "owner_configured": owner_ok, "friends_access_configured": friend_ok, "subscriber_access_configured": subscriber_ok}


@app.post("/api/auth/setup-owner")
async def auth_setup_owner(request: Request, response: Response):
    """Legacy endpoint retained for compatibility; Owner is internal-only."""
    auth.ensure_internal_owner()
    return JSONResponse({"error": "Owner setup is internal. Create the Admin account instead."}, status_code=403)
@app.post("/api/auth/setup")
async def auth_setup(request: Request, response: Response):
    """Create the first user-facing ADMIN account. Internal Owner is automatic."""
    owner_id = auth.ensure_internal_owner()
    if auth.configurable_admin_exists():
        return JSONResponse({"error": "Admin is already configured"}, status_code=400)
    body = await request.json()
    username = auth.normalize_username(body.get("username") or "")
    password = body.get("password") or ""
    if len(username) < 3:
        return JSONResponse({"error": "Username must be at least 3 characters"}, status_code=400)
    if len(password) < 8:
        return JSONResponse({"error": "Password must be at least 8 characters"}, status_code=400)
    try:
        user_id = auth.create_user(username, password, role="ADMIN")
        # create_user persists the salted hash to the portable admin profile.
        auth.restore_persistent_admin()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    # Retire the legacy fixed bootstrap account if this archive contains one.
    with db.cursor() as cur:
        cur.execute("UPDATE users SET status='disabled' WHERE role='ADMIN' AND LOWER(username)='admin' AND id<>?", (user_id,))
    # Keep the Owner session during first-run setup so the following Access Setup
    # remains owner-authorized. The newly created Admin can log in normally
    # from the main login screen after setup completes.
    db.audit(owner_id, "SYSTEM", "admin_setup", f"user-defined Admin credentials created: {username}")
    token = auth.create_session(user_id, lifetime_hours=auth.REMEMBER_LIFETIME_DAYS*24)
    response.set_cookie(auth.SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=auth.REMEMBER_LIFETIME_DAYS*86400)
    return {"ok": True, "user": user_public(auth.get_user_by_id(user_id))}


@app.post("/api/auth/setup-access")
async def auth_setup_access(request: Request, user=Depends(auth.require_admin)):
    """First-run access setup managed by the visible Admin account."""
    owner_id = user["id"]
    auth.ensure_internal_owner()
    body = await request.json()
    friend_name = str(body.get("friend_name") or "").strip()
    friend_password = str(body.get("friend_password") or "")
    subscriber_password = str(body.get("subscriber_password") or "")
    if len(friend_name) < 2:
        return JSONResponse({"error": "Friends Only name must be at least 2 characters."}, status_code=400)
    if len(friend_password) < 4:
        return JSONResponse({"error": "Friends Only password must be at least 4 characters."}, status_code=400)
    if len(subscriber_password) < 4:
        return JSONResponse({"error": "Subscribers Only password must be at least 4 characters."}, status_code=400)
    friend_hash, friend_salt = auth.hash_password(friend_password)
    sub_hash, sub_salt = auth.hash_password(subscriber_password)
    with db.cursor() as cur:
        cur.execute("DELETE FROM friend_profiles WHERE owner_user_id=?", (owner_id,))
        cur.execute("INSERT INTO friend_profiles(owner_user_id,name,password_hash,password_salt,enabled) VALUES(?,?,?,?,1)", (owner_id, friend_name, friend_hash, friend_salt))
    current = get_settings_merged()
    current["subscriber_guest_password_hash"] = sub_hash
    current["subscriber_guest_password_salt"] = sub_salt
    save_json(SETTINGS_FILE, current)
    save_settings(current)
    db.audit(user["id"], user["username"], "first_run_access_setup", "Friends Only and Subscribers Only configured")
    return {"ok": True, "friends_access_configured": True, "subscriber_access_configured": True}

@app.post("/api/auth/signup")
async def auth_signup(request: Request):
    """v3.8: public self-signup is disabled. There is no more NORMAL_USER
    tier - only the Owner (first-run) and Admin accounts the Owner creates
    from the Owner Dashboard. This endpoint is kept (instead of deleted) so
    old clients get a clear error instead of a raw 404."""
    return JSONResponse(
        {"error": "Self-signup is disabled. Ask the Owner to create an Admin account for you."},
        status_code=403,
    )


@app.post("/api/auth/reset-owner")
async def auth_reset_owner(request: Request):
    """Owner reset is deliberately disabled. Owner credentials are not resettable
    through the launcher or web UI; this prevents destructive account takeover.
    A lost Owner credential requires a deliberate local recovery procedure outside
    the normal application login flow."""
    return JSONResponse({"error": "Owner reset is disabled by policy. The existing Owner credential is preserved."}, status_code=403)


@app.post("/api/auth/reset-admin")
async def auth_reset_admin(request: Request):
    """Destructive Admin reset is disabled in BETA.

    Existing Admin accounts must not be silently deleted by a UI action.
    Fresh installations create the Admin during first-run setup; recovery is
    deliberately outside the normal login surface.
    """
    return JSONResponse({
        "error": "Admin reset is disabled. Use the local Factory Reset flow when a full first-run reset is required."
    }, status_code=403)


@app.post("/api/auth/factory-reset")
async def auth_factory_reset(request: Request):
    """Local application-data factory reset for forgotten credentials.

    This does NOT format the phone or delete the application source. It clears
    DeveloperHCR runtime data and recreates a clean database/default settings,
    allowing the First Owner Setup and First Admin Setup to run again.
    """
    client_host = (request.client.host if request.client else "").strip("[]").lower()
    if client_host not in {"127.0.0.1", "::1", "localhost"}:
        return JSONResponse({"error": "Factory reset is available only from the local device."}, status_code=403)
    try:
        body = await request.json()
    except Exception:
        body = {}
    confirmation = str(body.get("confirm") or "").strip().upper()
    if confirmation != "YES":
        return JSONResponse({"error": "Confirmation required. Click Yes to confirm the system reset."}, status_code=400)

    # Close the current thread's SQLite handle before replacing the DB file.
    try:
        conn = getattr(db._local, "conn", None)
        if conn is not None:
            conn.close()
            delattr(db._local, "conn")
    except Exception:
        pass

    cleared = []
    for child in list(DATA_DIR.iterdir()) if DATA_DIR.exists() else []:
        try:
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
            cleared.append(child.name)
        except Exception as exc:
            return JSONResponse({"error": f"Could not clear {child.name}: {exc}"}, status_code=500)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Factory reset intentionally removes the portable Admin profile too.
    auth._clear_admin_state()
    db.init_db()
    save_settings(DEFAULT_SETTINGS)
    response = JSONResponse({
        "ok": True,
        "reset": True,
        "message": "DeveloperHCR application data reset. First-run Admin setup is required again.",
        "cleared": sorted(cleared),
    })
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


@app.post("/api/auth/login")
async def auth_login(request: Request, response: Response):
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    remember = bool(body.get("remember", True))
    user = auth.get_user_by_username(username)
    if not user:
        db.audit(None, username, "login_failed", "unknown_username")
        return JSONResponse({"error": "Username not found. Check the username and try again."}, status_code=401)
    if user["role"] == "OWNER":
        db.audit(user["id"], "SYSTEM", "login_failed", "internal_owner_not_user_login")
        return JSONResponse({"error": "This account is internal and cannot be used for user login. Use your Admin account."}, status_code=403)
    if user["status"] != "active":
        reason = "pending_approval" if user["status"] == "pending" else "account_disabled"
        db.audit(user["id"], user["username"], "login_failed", reason)
        if user["status"] == "pending":
            return JSONResponse({"error": "Your account is waiting for Owner/Admin approval. You can log in after approval."}, status_code=403)
        return JSONResponse({"error": "This account is disabled. Ask the Owner/Admin to enable it."}, status_code=403)
    if not auth.verify_password(password, user["salt"], user["password_hash"]):
        db.audit(user["id"], user["username"], "login_failed", "wrong_password")
        return JSONResponse({"error": "Password is incorrect. Check your password and try again."}, status_code=401)
    token = auth.create_session(user["id"], lifetime_hours=(auth.REMEMBER_LIFETIME_DAYS*24 if remember else 24))
    db.audit(user["id"], user["username"], "login", "remembered" if remember else "session")
    response.set_cookie(auth.SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=(auth.REMEMBER_LIFETIME_DAYS*86400 if remember else 86400))
    return {"ok": True, "user": user_public(user)}


@app.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    token = request.cookies.get(auth.SESSION_COOKIE)
    user = auth.get_session_user(token) if token else None
    if token:
        auth.destroy_session(token)
    if user:
        db.audit(user["id"], user["username"], "logout", "")
    response.delete_cookie(auth.SESSION_COOKIE)
    return {"ok": True}


@app.post("/api/account/credentials")
async def update_own_credentials(request: Request, response: Response, user=Depends(auth.require_login)):
    body = await request.json()
    current_password = str(body.get("current_password") or "")
    new_username = auth.normalize_username(body.get("new_username") or user["username"])
    new_password = str(body.get("new_password") or "")
    if not auth.verify_password(current_password, user["salt"], user["password_hash"]):
        return JSONResponse({"error": "Current password is incorrect."}, status_code=401)
    try:
        new_username = auth.validate_username(new_username)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if auth.username_exists(new_username, exclude_user_id=user["id"]):
        return JSONResponse({"error": f"Username '{new_username}' is already taken. Choose another username."}, status_code=409)
    if new_password and len(new_password) < 8:
        return JSONResponse({"error": "New password must be at least 8 characters."}, status_code=400)
    pw_hash, salt = auth.hash_password(new_password) if new_password else (user["password_hash"], user["salt"])
    with db.cursor() as cur:
        cur.execute("UPDATE users SET username=?, password_hash=?, salt=? WHERE id=?", (new_username, pw_hash, salt, user["id"]))
        cur.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
    token = auth.create_session(user["id"], lifetime_hours=auth.REMEMBER_LIFETIME_DAYS*24)
    response.set_cookie(auth.SESSION_COOKIE, token, httponly=True, samesite="lax", max_age=auth.REMEMBER_LIFETIME_DAYS*86400)
    db.audit(user["id"], new_username, "credentials_changed", "self")
    return {"ok": True, "user": user_public(auth.get_user_by_id(user["id"])), "message": "Credentials updated. You will stay signed in on this device."}


@app.post("/api/owner/users/{target_id}/credentials")
async def owner_update_user_credentials(target_id: int, request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    target = auth.get_user_by_id(target_id)
    if not target:
        return JSONResponse({"error": "User not found."}, status_code=404)
    new_username = auth.normalize_username(body.get("new_username") or target["username"])
    new_password = str(body.get("new_password") or "")
    try:
        new_username = auth.validate_username(new_username)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if auth.username_exists(new_username, exclude_user_id=target_id):
        return JSONResponse({"error": f"Username '{new_username}' is already taken. Choose another username."}, status_code=409)
    if new_password and len(new_password) < 8:
        return JSONResponse({"error": "New password must be at least 8 characters."}, status_code=400)
    if not new_password:
        new_password = None
    with db.cursor() as cur:
        if new_password:
            pw_hash, salt = auth.hash_password(new_password)
            cur.execute("UPDATE users SET username=?, password_hash=?, salt=? WHERE id=?", (new_username, pw_hash, salt, target_id))
        else:
            cur.execute("UPDATE users SET username=? WHERE id=?", (new_username, target_id))
        cur.execute("DELETE FROM sessions WHERE user_id=?", (target_id,))
    db.audit(user["id"], user["username"], "credentials_changed", f"target={target_id}")
    return {"ok": True, "user": user_public(auth.get_user_by_id(target_id)), "message": "User credentials updated. Existing sessions were signed out."}


AGREEMENT_VERSION = "1.6-data-friends-v1"

@app.get("/api/agreements/status")
def agreement_status(user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT agreement_version, accepted_at, sync_consent, privacy_mode FROM user_agreements WHERE user_id=?", (user["id"],))
        row=cur.fetchone()
    return {"required_version":AGREEMENT_VERSION,"accepted":bool(row and row["agreement_version"]==AGREEMENT_VERSION),
            "accepted_at":row["accepted_at"] if row else None,"sync_consent":bool(row and row["sync_consent"]),
            "privacy_mode":row["privacy_mode"] if row else "standard"}

@app.post("/api/agreements/accept")
async def agreement_accept(request: Request, user=Depends(auth.require_login)):
    body=await request.json()
    sync_consent=bool(body.get("sync_consent",False))
    privacy=str(body.get("privacy_mode","standard"))
    if privacy not in ("standard","private"): return JSONResponse({"error":"invalid privacy mode"},status_code=400)
    with db.cursor() as cur:
        cur.execute("INSERT INTO user_agreements(user_id,agreement_version,sync_consent,privacy_mode) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET agreement_version=excluded.agreement_version,accepted_at=datetime('now'),sync_consent=excluded.sync_consent,privacy_mode=excluded.privacy_mode", (user["id"],AGREEMENT_VERSION,int(sync_consent),privacy))
    db.audit(user["id"],user["username"],"agreement_accepted",f"version={AGREEMENT_VERSION} sync_consent={sync_consent} privacy={privacy}")
    return {"ok":True,"version":AGREEMENT_VERSION,"sync_consent":sync_consent,"privacy_mode":privacy}

@app.post("/api/sync/flush")
async def sync_flush(user=Depends(auth.require_login)):
    st=get_settings_merged(); endpoint=str(st.get("admin_sync_endpoint","")).strip()
    if not endpoint or not endpoint.startswith("https://"):
        return {"ok":False,"sent":0,"reason":"Owner sync endpoint is not configured."}
    with db.cursor() as cur:
        cur.execute("SELECT sync_consent,privacy_mode FROM user_agreements WHERE user_id=?",(user["id"],)); a=cur.fetchone()
        if not a or not a["sync_consent"] or a["privacy_mode"] == "private":
            return {"ok":False,"sent":0,"reason":"User consent/privacy mode does not permit admin sync."}
        cur.execute("SELECT id,event_type,payload_json,created_at FROM sync_queue WHERE user_id=? AND sent_at IS NULL ORDER BY id LIMIT 20",(user["id"],)); rows=cur.fetchall()
    if not rows: return {"ok":True,"sent":0,"reason":"No queued data."}
    payload={"app":"DeveloperHCR:AI Agent","version":APP_VERSION,"user_id":user["id"],"events":[dict(r) for r in rows]}
    try:
        req=urllib.request.Request(endpoint,data=json.dumps(payload).encode("utf-8"),headers={"Content-Type":"application/json","User-Agent":"DeveloperHCR-Sync/1.6"},method="POST")
        with urllib.request.urlopen(req,timeout=5) as r:
            if r.status < 200 or r.status >= 300: raise RuntimeError(f"HTTP {r.status}")
        ids=[r["id"] for r in rows]
        with db.cursor() as cur:
            cur.executemany("UPDATE sync_queue SET sent_at=datetime('now') WHERE id=?",[(i,) for i in ids])
        return {"ok":True,"sent":len(ids)}
    except Exception as e:
        return {"ok":False,"sent":0,"reason":"Sync endpoint unavailable; data remains local.","detail":str(e)[:200]}

@app.post("/api/sync/queue")
async def sync_queue(request: Request, user=Depends(auth.require_login)):
    """Queue only consented, non-secret telemetry. Private/E2EE content is never accepted here."""
    with db.cursor() as cur:
        cur.execute("SELECT sync_consent,privacy_mode FROM user_agreements WHERE user_id=?",(user["id"],)); a=cur.fetchone()
    if not a or not a["sync_consent"]:
        return JSONResponse({"error":"Admin sync is not enabled by the user agreement."},status_code=403)
    if a["privacy_mode"] == "private":
        return {"ok":False,"queued":False,"reason":"Privacy mode prevents admin data sync."}
    body=await request.json(); event_type=str(body.get("event_type","telemetry"))[:80]
    payload=body.get("payload",{})
    # Explicitly strip common secrets and user content fields.
    if not isinstance(payload,dict): payload={}
    forbidden={"password","password_hash","token","api_key","secret","private_key","chat","messages","search_history","history","file_contents"}
    payload={k:v for k,v in payload.items() if k.lower() not in forbidden}
    with db.cursor() as cur:
        cur.execute("INSERT INTO sync_queue(user_id,event_type,payload_json) VALUES(?,?,?)",(user["id"],event_type,json.dumps(payload,ensure_ascii=False)[:10000]))
    return {"ok":True,"queued":True,"note":"Queued locally; transmission requires an owner-configured sync endpoint."}

@app.get("/api/auth/me")
def auth_me(user=Depends(auth.current_user)):
    if not user:
        return {"logged_in": False}
    return {"logged_in": True, "user": user_public(user)}


# --------------------------------------------------------------------------
# v0.2 - Phase 3/5: Owner Dashboard + User Management
# --------------------------------------------------------------------------

@app.get("/api/admin/dashboard")
async def admin_dashboard(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT role, COUNT(*) c FROM users GROUP BY role"); roles={r["role"]:r["c"] for r in cur.fetchall()}
        cur.execute("SELECT app_id, COUNT(*) c FROM app_usage GROUP BY app_id ORDER BY c DESC LIMIT 20"); usage=[dict(r) for r in cur.fetchall()]
        cur.execute("SELECT COUNT(*) c FROM feedback WHERE status='open'"); feedback=cur.fetchone()["c"]
    return {"role_counts":roles,"app_usage":usage,"open_feedback":feedback,"system":get_system_info(),"privacy_note":"Admin dashboard excludes private chat/search contents; it shows aggregate usage and support/health information only."}

@app.get("/api/owner/dashboard")
async def owner_dashboard(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) c FROM users")
        total_users = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) c FROM sessions WHERE expires_at > datetime('now')")
        active_sessions = cur.fetchone()["c"]
        cur.execute("SELECT ts, username, action, detail FROM audit_logs ORDER BY id DESC LIMIT 25")
        recent_audit = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT COUNT(*) c FROM feedback WHERE status='open'")
        open_feedback = cur.fetchone()["c"]
        # v0.3: aggregate AI stats only - never expose private chat contents here.
        cur.execute("SELECT COUNT(*) c FROM conversations")
        total_conversations = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) c FROM messages")
        total_messages = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*) c FROM ai_errors WHERE ts > datetime('now', '-7 days')")
        recent_ai_errors = cur.fetchone()["c"]
        cur.execute("SELECT role, COUNT(*) c FROM users GROUP BY role")
        role_counts = {r["role"]: r["c"] for r in cur.fetchall()}
        cur.execute("SELECT app_id, COUNT(*) c FROM app_usage GROUP BY app_id ORDER BY c DESC LIMIT 20")
        app_usage = [dict(r) for r in cur.fetchall()]
    ai_status = await ai_manager.full_status()
    return {
        "total_users": total_users,
        "active_sessions": active_sessions,
        "open_feedback": open_feedback,
        "recent_audit": recent_audit,
        "system": get_system_info(),
        "ai": ai_status,
        "role_counts": role_counts,
        "app_usage": app_usage,
        "privacy_note": "Private chat/search contents are not exposed by this dashboard; only aggregate usage and security events are shown.",
        "ai_stats": {
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "recent_errors_7d": recent_ai_errors,
            "active_generations": len(ACTIVE_GENERATIONS),
        },
    }


@app.get("/api/owner/users")
def owner_list_users(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE role<>'OWNER' ORDER BY id")
        return {"users": [user_public(r) for r in cur.fetchall()]}


@app.post("/api/owner/users")
async def owner_create_user(request: Request, user=Depends(auth.require_admin)):
    """v3.8: Owner can only create ADMIN accounts now - there is no other
    role left to hand out (see backend/auth.py)."""
    body = await request.json()
    if auth.configurable_admin_exists():
        return JSONResponse({"error": "The visible Admin account is already configured. Change its credentials in Settings."}, status_code=409)
    try:
        new_id = auth.create_user(
            (body.get("username") or "").strip(),
            body.get("password") or "",
            role="ADMIN",
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    db.audit(user["id"], user["username"], "user_created", f"new_user={body.get('username')} role=ADMIN")
    return {"ok": True, "user": user_public(auth.get_user_by_id(new_id))}


@app.post("/api/owner/users/{target_id}/role")
async def owner_change_role(target_id: int, request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    role = str(body.get("role") or "").strip().upper()
    if role not in auth.LEGACY_ROLES:
        return JSONResponse({"error": "Protected role. Admin cannot assign the internal Owner or visible Admin role."}, status_code=403)
    with db.cursor() as cur:
        cur.execute("UPDATE users SET role = ? WHERE id = ?", (role, target_id))
    db.audit(user["id"], user["username"], "role_changed", f"target={target_id} role={role}")
    return {"ok": True}


@app.post("/api/owner/users/{target_id}/status")
async def owner_change_status(target_id: int, request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    status = body.get("status")
    if status not in ("active", "disabled"):
        return JSONResponse({"error": "invalid status"}, status_code=400)
    with db.cursor() as cur:
        cur.execute("UPDATE users SET status = ? WHERE id = ?", (status, target_id))
        cur.execute("DELETE FROM sessions WHERE user_id = ?", (target_id,))
    db.audit(user["id"], user["username"], "status_changed", f"target={target_id} status={status}")
    return {"ok": True}


# --------------------------------------------------------------------------
# v0.2 - Phase 6: AI Model Manager (detection only, never fabricated)
# --------------------------------------------------------------------------

@app.get("/api/ai/models")
def ai_model_report(user=Depends(auth.require_login)):
    return ai_models.full_report()


# --------------------------------------------------------------------------
# v0.3 - AI Chat: providers, conversations, streaming generation
# --------------------------------------------------------------------------

def conv_public(row):
    return {"id": row["id"], "title": row["title"], "provider": row["provider"], "model": row["model"],
            "created_at": row["created_at"], "updated_at": row["updated_at"], "status": row["status"]}


def msg_public(row):
    return {"id": row["id"], "role": row["role"], "content": row["content"], "created_at": row["created_at"],
            "tokens": row["tokens"], "eval_ms": row["eval_ms"], "error": row["error"]}


def get_owned_conversation(cur, conv_id: int, user_id: int):
    cur.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,))
    conv = cur.fetchone()
    if not conv or conv["user_id"] != user_id:
        return None
    return conv


async def broadcast_event(payload: dict):
    payload = {**payload, "ts": time.time()}
    await manager.broadcast(payload)


@app.get("/api/ai/providers")
async def ai_providers(user=Depends(auth.require_login)):
    """Real provider status - installed/running/models. Never fabricated."""
    return await ai_manager.full_status()


@app.get("/api/ai/conversations")
async def list_conversations(user=Depends(auth.require_login), q: str = ""):
    with db.cursor() as cur:
        if q:
            cur.execute(
                "SELECT * FROM conversations WHERE user_id = ? AND title LIKE ? ORDER BY updated_at DESC",
                (user["id"], f"%{q}%"),
            )
        else:
            cur.execute("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC", (user["id"],))
        return {"conversations": [conv_public(r) for r in cur.fetchall()]}


@app.post("/api/ai/conversations")
async def create_conversation(request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    provider = body.get("provider", "ollama")
    model = body.get("model", "")
    title = body.get("title") or "New Chat"
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO conversations (user_id, title, provider, model) VALUES (?, ?, ?, ?)",
            (user["id"], title, provider, model),
        )
        conv_id = cur.lastrowid
    db.audit(user["id"], user["username"], "chat_created", f"provider={provider} model={model}")
    await broadcast_event({"type": "ai-conversation-created", "conversation_id": conv_id})
    return {"id": conv_id}


@app.get("/api/ai/conversations/{conv_id}")
async def get_conversation(conv_id: int, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        conv = get_owned_conversation(cur, conv_id, user["id"])
        if not conv:
            return JSONResponse({"error": "Not found"}, status_code=404)
        cur.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id", (conv_id,))
        messages = [msg_public(r) for r in cur.fetchall()]
    return {"conversation": conv_public(conv), "messages": messages}


@app.patch("/api/ai/conversations/{conv_id}")
async def rename_conversation(conv_id: int, request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    with db.cursor() as cur:
        conv = get_owned_conversation(cur, conv_id, user["id"])
        if not conv:
            return JSONResponse({"error": "Not found"}, status_code=404)
        cur.execute("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?", (title, conv_id))
    return {"ok": True}


@app.delete("/api/ai/conversations/{conv_id}")
async def delete_conversation(conv_id: int, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        conv = get_owned_conversation(cur, conv_id, user["id"])
        if not conv:
            return JSONResponse({"error": "Not found"}, status_code=404)
        cur.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        cur.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    db.audit(user["id"], user["username"], "chat_deleted", f"conversation_id={conv_id}")
    await broadcast_event({"type": "ai-conversation-deleted", "conversation_id": conv_id})
    return {"ok": True}


@app.post("/api/ai/conversations/{conv_id}/clear")
async def clear_conversation(conv_id: int, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        conv = get_owned_conversation(cur, conv_id, user["id"])
        if not conv:
            return JSONResponse({"error": "Not found"}, status_code=404)
        cur.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
    return {"ok": True}


MAX_MESSAGE_CHARS = 8000  # Phase 20: reject oversized input rather than silently truncating.
ACTIVE_GENERATIONS = {}  # conversation_id -> {"stop": bool}


@app.post("/api/ai/chat/stop/{conv_id}")
async def stop_generation(conv_id: int, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        conv = get_owned_conversation(cur, conv_id, user["id"])
        if not conv:
            return JSONResponse({"error": "Not found"}, status_code=404)
    if conv_id in ACTIVE_GENERATIONS:
        ACTIVE_GENERATIONS[conv_id]["stop"] = True
        ACTIVE_GENERATIONS[conv_id]["stop_event"].set()
    db.audit(user["id"], user["username"], "generation_stopped", f"conversation_id={conv_id}")
    await broadcast_event({"type": "ai-status", "conversation_id": conv_id, "status": "STOPPED"})
    return {"ok": True}


@app.post("/api/ai/chat/stream")
async def chat_stream(request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    conv_id = body.get("conversation_id")
    text = (body.get("message") or "").strip()

    if not text:
        return JSONResponse({"error": "message required"}, status_code=400)
    if len(text) > MAX_MESSAGE_CHARS:
        return JSONResponse({"error": f"Message too large (max {MAX_MESSAGE_CHARS} chars)."}, status_code=413)

    with db.cursor() as cur:
        conv = get_owned_conversation(cur, conv_id, user["id"])
        if not conv:
            return JSONResponse({"error": "Conversation not found"}, status_code=404)
        cur.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
            (conv_id, text),
        )
        if conv["title"] == "New Chat":
            cur.execute("UPDATE conversations SET title = ? WHERE id = ?", (text[:40], conv_id))
        cur.execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id", (conv_id,))
        history_rows = cur.fetchall()

    settings = get_settings_merged()
    max_hist = settings.get("ai_max_history_messages", 20)
    system_prompt = settings.get("ai_system_prompt", "")
    trimmed = len(history_rows) > max_hist
    recent = history_rows[-max_hist:] if trimmed else history_rows

    chat_messages = []
    if system_prompt:
        chat_messages.append({"role": "system", "content": system_prompt})
    if trimmed:
        chat_messages.append({"role": "system", "content": "(earlier conversation history was trimmed to fit context settings)"})
    chat_messages += [{"role": r["role"], "content": r["content"]} for r in recent if r["role"] != "system"]

    provider_name = conv["provider"]
    model = conv["model"]
    stop_event = threading.Event()
    options = {
        "temperature": settings.get("ai_temperature"),
        "context_length": settings.get("ai_context_length"),
        "timeout": settings.get("ai_generation_timeout", 120),
        "stop_event": stop_event,
    }

    ACTIVE_GENERATIONS[conv_id] = {"stop": False, "stop_event": stop_event}
    with db.cursor() as cur:
        cur.execute("UPDATE conversations SET status = 'generating', updated_at = datetime('now') WHERE id = ?", (conv_id,))
    db.audit(user["id"], user["username"], "generation_started", f"conversation_id={conv_id} provider={provider_name} model={model}")
    await broadcast_event({"type": "ai-status", "conversation_id": conv_id, "status": "GENERATING", "provider": provider_name, "model": model})

    async def event_gen():
        full_text = ""
        final_meta = {}
        error_msg = None
        try:
            provider = ai_manager.get_provider(provider_name)
            async for event in provider.stream_chat(model, chat_messages, options):
                if ACTIVE_GENERATIONS.get(conv_id, {}).get("stop"):
                    yield f"data: {json.dumps({'type': 'stopped'})}\n\n"
                    break
                if event["type"] == "chunk":
                    full_text += event["text"]
                    yield f"data: {json.dumps({'type': 'chunk', 'text': event['text']})}\n\n"
                elif event["type"] == "done":
                    final_meta = event
                    yield f"data: {json.dumps({'type': 'done', **event})}\n\n"
        except AIError as e:
            error_msg = e.user_message
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
        except Exception as e:
            error_msg = "An unexpected AI error occurred."
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg, 'detail': str(e)[:200]})}\n\n"
        finally:
            stopped = ACTIVE_GENERATIONS.get(conv_id, {}).get("stop", False)
            ACTIVE_GENERATIONS.pop(conv_id, None)
            status = "error" if error_msg else ("stopped" if stopped else "completed")
            with db.cursor() as cur:
                if full_text:
                    cur.execute(
                        "INSERT INTO messages (conversation_id, role, content, tokens, eval_ms, error) VALUES (?, 'assistant', ?, ?, ?, ?)",
                        (conv_id, full_text, final_meta.get("eval_count"),
                         int(final_meta.get("elapsed_sec", 0) * 1000) if final_meta.get("elapsed_sec") else None,
                         error_msg),
                    )
                elif error_msg:
                    cur.execute(
                        "INSERT INTO ai_errors (user_id, provider, model, error) VALUES (?, ?, ?, ?)",
                        (user["id"], provider_name, model, error_msg),
                    )
                cur.execute("UPDATE conversations SET status = ?, updated_at = datetime('now') WHERE id = ?", (status, conv_id))
            if error_msg:
                db.audit(user["id"], user["username"], "generation_error", f"conversation_id={conv_id} error={error_msg}")
            await broadcast_event({"type": "ai-status", "conversation_id": conv_id, "status": status.upper()})

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# --------------------------------------------------------------------------
# v0.2 - App usage tracking (feeds the Owner Dashboard)
# --------------------------------------------------------------------------

@app.post("/api/usage/{app_id}")
def log_usage(app_id: str, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("INSERT INTO app_usage (user_id, app_id) VALUES (?, ?)", (user["id"], app_id))
    return {"ok": True}



# --------------------------------------------------------------------------
# v0.5 - Jarvis mode: voice, safe system control, screen/API inspection
# --------------------------------------------------------------------------

@app.get("/api/jarvis/status")
def jarvis_status(user=Depends(auth.require_login)):
    settings=load_settings()
    stt_model = os.environ.get("JARVIS_VOSK_MODEL") or str(BASE_DIR/'data'/'jarvis'/'vosk-model')
    return {
        "ok": True,
        "mode": settings.get("assistant_name", "JARVIS"),
        "offline_voice": bool(shutil.which("python")),
        "tts_available": importlib.util.find_spec("pyttsx3") is not None,
        "stt_available": importlib.util.find_spec("sounddevice") is not None and importlib.util.find_spec("vosk") is not None,
        "stt_model_available": Path(stt_model).exists(),
        "screen_capture": True,
        "screen_recording": jarvis_core.recording_status(),
        "safe_command_policy": "allowlist + dangerous preview/block",
        "auto_run_safe_voice": bool(settings.get("jarvis_auto_run_safe_voice", True)),
        "api": "/docs",
        "version": APP_VERSION,
    }

@app.get("/api/jarvis/system")
def jarvis_system(user=Depends(auth.require_login)):
    return jarvis_core.system_snapshot(psutil if HAS_PSUTIL else None)


@app.get("/api/jarvis/ai-runtimes")
async def jarvis_ai_runtimes(user=Depends(auth.require_login)):
    # Reuse the same real provider discovery used by AI Models; no fabricated status.
    return await ai_manager.full_status()

@app.get("/api/jarvis/recording/status")
def jarvis_recording_status(user=Depends(auth.require_login)):
    return jarvis_core.recording_status()

@app.post("/api/jarvis/recording/start")
async def jarvis_recording_start(request: Request, user=Depends(auth.require_login)):
    settings=load_settings()
    if not settings.get("jarvis_training_capture_local_only", True):
        return JSONResponse({"error":"Training capture must remain local-only."}, status_code=403)
    body=await request.json() if request.headers.get("content-type","").startswith("application/json") else {}
    quality=str(body.get("quality","medium")).lower()
    size=str(body.get("size","full")).lower()
    fps=int(body.get("fps",4))
    fps=max(1,min(10,fps))
    if quality not in ("low","medium","high"): quality="medium"
    if size not in ("full","1080p","720p","window"): size="full"
    try:
        result=jarvis_core.start_screen_recording(fps, quality=quality, size=size)
        db.audit(user["id"], user["username"], "jarvis_screen_recording_start", "local-only")
        return result
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e)}, status_code=501)

@app.post("/api/jarvis/recording/stop")
def jarvis_recording_stop(user=Depends(auth.require_login)):
    result=jarvis_core.stop_screen_recording()
    db.audit(user["id"], user["username"], "jarvis_screen_recording_stop", "local-only")
    return result

@app.post("/api/jarvis/command/preview")
async def jarvis_command_preview(request: Request, user=Depends(auth.require_login)):
    body=await request.json(); return jarvis_core.command_preview(body.get("command", ""))

@app.post("/api/jarvis/action")
async def jarvis_action(request: Request, user=Depends(auth.require_login)):
    body=await request.json(); action=body.get("action"); value=body.get("value")
    result=jarvis_core.perform_action(action, value)
    db.audit(user["id"], user["username"], "jarvis_action", str(action))
    await manager.broadcast({"type":"jarvis-action","action":action,"ok":result.get("ok")}) if 'manager' in globals() else None
    return result

@app.get("/api/jarvis/screen")
def jarvis_screen(user=Depends(auth.require_login)):
    try:
        path=jarvis_core.capture_screen()
        return FileResponse(str(path), media_type="image/png", filename=path.name)
    except Exception as e:
        return JSONResponse({"error":str(e)}, status_code=501)

@app.post("/api/jarvis/speak")
async def jarvis_speak(request: Request, user=Depends(auth.require_login)):
    body=await request.json(); text=str(body.get("text") or "")[:2000]
    result=jarvis_core.speak(text)
    db.audit(user["id"], user["username"], "jarvis_tts", "spoken_text_redacted")
    return result

@app.post("/api/jarvis/listen")
async def jarvis_listen(request: Request, user=Depends(auth.require_login)):
    body=await request.json(); duration=body.get("duration",5)
    try:
        audio, rate=jarvis_core.record_offline(duration)
        text=jarvis_core.transcribe_offline(audio, rate)
        return {"ok":True,"text":text,"offline":True}
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e)}, status_code=501)

@app.post("/api/jarvis/ask")
async def jarvis_ask(request: Request, user=Depends(auth.require_login)):
    body=await request.json(); prompt=(body.get("text") or "").strip()[:8000]
    if not prompt: return JSONResponse({"error":"text required"}, status_code=400)
    settings=load_settings(); provider_name=settings.get("ai_default_provider","ollama"); model=settings.get("ai_default_model","")
    if not model:
        st=await ai_manager.get_provider(provider_name).status(); models=st.get("models",[]); model=models[0].get("name") if models else ""
    if not model: return JSONResponse({"ok":False,"error":"No local AI model configured/available."}, status_code=503)
    messages=[{"role":"system","content":settings.get("ai_system_prompt","") + " You are Jarvis mode. Never claim to have executed a system action unless the API returned success."},{"role":"user","content":prompt}]
    try:
        provider=ai_manager.get_provider(provider_name); chunks=[]
        async for ev in provider.stream_chat(model,messages,{"temperature":settings.get("ai_temperature"),"context_length":settings.get("ai_context_length"),"timeout":settings.get("ai_generation_timeout",120)}):
            if ev.get("type")=="chunk": chunks.append(ev.get("text",""))
        text="".join(chunks).strip()
        return {"ok":True,"text":text,"provider":provider_name,"model":model,"offline":provider_name in ("ollama","gguf")}
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e)}, status_code=503)

# --------------------------------------------------------------------------
# Terminal <-> Browser sync (shared event bus over WebSocket)
# --------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict, exclude: WebSocket = None):
        dead = []
        for conn in self.active:
            if conn is exclude:
                continue
            try:
                await conn.send_json(message)
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect(d)


manager = ConnectionManager()


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            data["ts"] = time.time()
            await manager.broadcast(data, exclude=websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ==========================================================================
# v1.1 modules: Friends/Subscription, Feedback, HCR Store, Games, EXE/Wine,
# and owner-configured GitHub update channel. Additive only.
# ==========================================================================

def _github_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "DeveloperHCR-Updater/1.1"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))

# --------------------------------------------------------------------------
# v1.2 security, plans, privacy and model management
# --------------------------------------------------------------------------

def _pin_hash(pin: str, salt: bytes = None):
    salt = salt or os.urandom(16)
    return auth.hash_password(pin, salt)

@app.get("/api/security/settings")
def security_settings(user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT quick_unlock_enabled, privacy_mode FROM user_security WHERE user_id=?", (user["id"],))
        r = cur.fetchone()
    return {"quick_unlock_enabled": bool(r["quick_unlock_enabled"]) if r else False,
            "privacy_mode": r["privacy_mode"] if r else "standard"}

@app.post("/api/security/settings")
async def security_update(request: Request, user=Depends(auth.require_login)):
    body = await request.json(); privacy = str(body.get("privacy_mode", "standard"))
    if privacy not in ("standard", "private"):
        return JSONResponse({"error":"invalid privacy mode"}, status_code=400)
    enabled = bool(body.get("quick_unlock_enabled", False)); pin = str(body.get("pin", ""))
    pin_hash = pin_salt = None
    if enabled:
        if not pin.isdigit() or not (4 <= len(pin) <= 12):
            return JSONResponse({"error":"PIN must be 4-12 digits"}, status_code=400)
        pin_hash, pin_salt = _pin_hash(pin)
    with db.cursor() as cur:
        cur.execute("INSERT INTO user_security(user_id,quick_unlock_enabled,pin_hash,pin_salt,privacy_mode,updated_at) VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET quick_unlock_enabled=excluded.quick_unlock_enabled,pin_hash=excluded.pin_hash,pin_salt=excluded.pin_salt,privacy_mode=excluded.privacy_mode,updated_at=datetime('now')",
                    (user["id"], int(enabled), pin_hash, pin_salt, privacy))
    db.audit(user["id"], user["username"], "security_settings_changed", f"quick_unlock={enabled} privacy={privacy}")
    return {"ok":True,"quick_unlock_enabled":enabled,"privacy_mode":privacy}

@app.get("/api/auth/quick-status")
def quick_status(username: str):
    user=auth.get_user_by_username(username.strip()) if username else None
    if not user: return {"enabled":False}
    with db.cursor() as cur:
        cur.execute("SELECT quick_unlock_enabled FROM user_security WHERE user_id=?",(user["id"],)); r=cur.fetchone()
    return {"enabled":bool(r and r["quick_unlock_enabled"]),"username":user["username"]}

@app.post("/api/auth/quick-unlock")
async def quick_unlock(request: Request, response: Response):
    body=await request.json(); username=str(body.get("username","")).strip(); pin=str(body.get("pin",""))
    user=auth.get_user_by_username(username)
    if not user: return JSONResponse({"error":"Invalid quick unlock"},status_code=401)
    with db.cursor() as cur:
        cur.execute("SELECT * FROM user_security WHERE user_id=? AND quick_unlock_enabled=1",(user["id"],)); sec=cur.fetchone()
    if not sec or not sec["pin_hash"] or not auth.verify_password(pin,sec["pin_salt"],sec["pin_hash"]):
        return JSONResponse({"error":"Invalid quick unlock"},status_code=401)
    token=auth.create_session(user["id"], lifetime_hours=30*24)
    response.set_cookie(auth.SESSION_COOKIE,token,httponly=True,samesite="lax",max_age=30*86400)
    db.audit(user["id"],user["username"],"quick_unlock","")
    return {"ok":True,"user":user_public(user)}


@app.post("/api/admin/users")
async def admin_create_user(request: Request, user=Depends(auth.require_admin)):
    """Admin can create normal/access users, but never Owner/Admin accounts."""
    body = await request.json()
    role = str(body.get("role") or "NORMAL_USER").strip().upper()
    if role not in auth.LEGACY_ROLES:
        return JSONResponse({"error": "Admin can create only normal/access user roles."}, status_code=403)
    try:
        new_id = auth.create_user((body.get("username") or "").strip(), body.get("password") or "", role=role)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    db.audit(user["id"], user["username"], "admin_user_created", f"new_user={body.get('username')} role={role}")
    return {"ok": True, "user": user_public(auth.get_user_by_id(new_id))}


@app.get("/api/owner/subscription-config")
def owner_subscription_config(user=Depends(auth.require_admin)):
    st = get_settings_merged()
    return {
        "plans": st.get("subscription_plans", DEFAULT_SETTINGS["subscription_plans"]),
        "future_prices_inr": st.get("future_subscription_prices_inr", [500, 1000, 5000]),
    }


@app.post("/api/owner/subscription-config")
async def owner_update_subscription_config(request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    plans = body.get("plans")
    future = body.get("future_prices_inr", [])
    if not isinstance(plans, list) or not plans:
        return JSONResponse({"error": "At least one subscription plan is required."}, status_code=400)
    clean = []
    seen = set()
    for p in plans:
        if not isinstance(p, dict):
            continue
        pid = re.sub(r"[^A-Za-z0-9_-]", "_", str(p.get("id", "")).upper())[:40]
        label = str(p.get("label", pid))[:60]
        try:
            price = max(0, int(p.get("price_inr", 0)))
        except Exception:
            return JSONResponse({"error": f"Invalid price for {label}"}, status_code=400)
        features = p.get("features", [])
        if isinstance(features, str):
            features = [x.strip() for x in features.split(",") if x.strip()]
        if not isinstance(features, list):
            return JSONResponse({"error": f"Invalid features for {label}"}, status_code=400)
        features = [str(x)[:80] for x in features[:100]]
        if not pid or pid in seen:
            return JSONResponse({"error": "Plan IDs must be unique and non-empty."}, status_code=400)
        seen.add(pid)
        clean.append({"id": pid, "price_inr": price, "label": label, "features": features})
    try:
        future_clean = [max(0, int(x)) for x in future][:20]
    except Exception:
        return JSONResponse({"error": "future_prices_inr must contain numbers"}, status_code=400)
    current = get_settings_merged()
    current["subscription_plans"] = clean
    current["future_subscription_prices_inr"] = future_clean
    save_json(SETTINGS_FILE, current)
    save_settings(current)
    db.audit(user["id"], user["username"], "subscription_config_changed", f"plans={len(clean)}")
    return {"ok": True, "plans": clean, "future_prices_inr": future_clean}


@app.post("/api/owner/users/{user_id}/features")
async def owner_feature_override(user_id: int, request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    feature = str(body.get("feature", "")).strip()[:80]
    if not feature:
        return JSONResponse({"error": "feature required"}, status_code=400)
    enabled = bool(body.get("enabled", True))
    with db.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE id=?", (user_id,))
        if not cur.fetchone():
            return JSONResponse({"error": "user not found"}, status_code=404)
        cur.execute("""INSERT INTO user_feature_overrides(user_id,feature,enabled,granted_by,updated_at)
                       VALUES(?,?,?,?,datetime('now'))
                       ON CONFLICT(user_id,feature) DO UPDATE SET enabled=excluded.enabled,
                       granted_by=excluded.granted_by,updated_at=datetime('now')""",
                    (user_id, feature, int(enabled), user["id"]))
    db.audit(user["id"], user["username"], "feature_override", f"user={user_id} feature={feature} enabled={enabled}")
    return {"ok": True, "user_id": user_id, "feature": feature, "enabled": enabled}


@app.get("/api/owner/users/{user_id}/features")
def owner_user_features(user_id: int, user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT feature,enabled,updated_at FROM user_feature_overrides WHERE user_id=? ORDER BY feature", (user_id,))
        return {"overrides": [dict(r) for r in cur.fetchall()]}


@app.post("/api/owner/friends/{user_id}/credentials")
async def owner_friend_credentials(user_id: int, request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    display_name = str(body.get("display_name", "")).strip()[:120]
    password = str(body.get("password", ""))
    if not display_name or len(password) < 4:
        return JSONResponse({"error": "Display name and password (minimum 4 characters) are required."}, status_code=400)
    pw_hash, salt = auth.hash_password(password)
    with db.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE id=?", (user_id,))
        if not cur.fetchone():
            return JSONResponse({"error": "user not found"}, status_code=404)
        cur.execute("""INSERT INTO friend_access(owner_user_id,friend_user_id,display_name,password_hash,password_salt,enabled)
                       VALUES(?,?,?,?,?,1)
                       ON CONFLICT(owner_user_id,friend_user_id) DO UPDATE SET display_name=excluded.display_name,
                       password_hash=excluded.password_hash,password_salt=excluded.password_salt,enabled=1""",
                    (user["id"], user_id, display_name, pw_hash, salt))
    db.audit(user["id"], user["username"], "friend_credentials_changed", f"user={user_id}")
    return {"ok": True}


@app.get("/api/owner/friend-profiles")
def owner_friend_profiles(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("""SELECT id,name,enabled,created_at FROM friend_profiles
                       WHERE owner_user_id=? ORDER BY name""", (user["id"],))
        return {"profiles":[dict(r) for r in cur.fetchall()]}


@app.post("/api/owner/friend-profiles")
async def owner_create_friend_profile(request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    name = str(body.get("name","")).strip()[:80]
    password = str(body.get("password",""))
    if not name or len(password) < 4:
        return JSONResponse({"error":"Name and password (minimum 4 characters) are required."}, status_code=400)
    pw_hash, salt = auth.hash_password(password)
    try:
        with db.cursor() as cur:
            cur.execute("""INSERT INTO friend_profiles(owner_user_id,name,password_hash,password_salt,enabled)
                           VALUES(?,?,?,?,1)""", (user["id"],name,pw_hash,salt))
    except Exception as e:
        return JSONResponse({"error":"A friend profile with that name already exists."}, status_code=409)
    db.audit(user["id"],user["username"],"friend_profile_created",name)
    return {"ok":True,"name":name}


@app.delete("/api/owner/friend-profiles/{profile_id}")
def owner_delete_friend_profile(profile_id:int, user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("DELETE FROM friend_profiles WHERE id=? AND owner_user_id=?", (profile_id,user["id"]))
    db.audit(user["id"],user["username"],"friend_profile_deleted",str(profile_id))
    return {"ok":True}


@app.post("/api/owner/subscriber-password")
async def owner_set_subscriber_password(request: Request, user=Depends(auth.require_admin)):
    """Owner sets/rotates the 'Subscribers Only' guest password. Previously this
    password was a fixed hash baked into the code with no way to view, change,
    or recover it. Now the Owner can set a new one at any time; it's stored
    (as a salted hash, same as every other password in this app) in settings
    and takes priority over the old built-in default."""
    body = await request.json()
    password = str(body.get("password", ""))
    if len(password) < 4:
        return JSONResponse({"error": "Password must be at least 4 characters."}, status_code=400)
    pw_hash, salt = auth.hash_password(password)
    current = get_settings_merged()
    current["subscriber_guest_password_hash"] = pw_hash
    current["subscriber_guest_password_salt"] = salt
    save_json(SETTINGS_FILE, current)
    save_settings(current)
    db.audit(user["id"], user["username"], "subscriber_password_changed", "")
    return {"ok": True, "message": "Subscribers Only password updated."}


@app.post("/api/friend-profiles/verify")
async def verify_friend_profile(request: Request, user=Depends(auth.require_login)):
    body=await request.json()
    name=str(body.get("name","")).strip()
    password=str(body.get("password",""))
    with db.cursor() as cur:
        cur.execute("""SELECT * FROM friend_profiles WHERE owner_user_id IN
                       (SELECT id FROM users WHERE role='ADMIN') AND name=? AND enabled=1
                       ORDER BY id DESC LIMIT 1""",(name,))
        row=cur.fetchone()
    if not row or not auth.verify_password(password,row["password_salt"],row["password_hash"]):
        return JSONResponse({"error":"Invalid Friends Only profile credentials."},status_code=401)
    db.audit(user["id"],user["username"],"friend_profile_verified",name)
    return {"ok":True,"profile":row["name"]}


@app.get("/api/plans")
def plans(user=Depends(auth.require_login)):
    st=get_settings_merged()
    return {"plans":st.get("subscription_plans",DEFAULT_SETTINGS.get("subscription_plans",[])),"future_prices_inr":st.get("future_subscription_prices_inr",[])}

@app.post("/api/subscriptions/request")
async def request_subscription(request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    plan_id = str(body.get("plan_id", "")).strip()[:40]
    st = get_settings_merged()
    plans_cfg = st.get("subscription_plans", [])
    plan = next((p for p in plans_cfg if str(p.get("id")) == plan_id), None)
    if not plan:
        return JSONResponse({"error": "Subscription plan not found."}, status_code=404)
    price = int(plan.get("price_inr", 0))
    if price <= 0:
        with db.cursor() as cur:
            cur.execute("INSERT INTO subscriptions(user_id,plan,status,start_date,approval_status,feature_permissions) VALUES(?,?,?,?,?,?)",
                        (user["id"], plan_id, "active", datetime.now(timezone.utc).replace(tzinfo=None).date().isoformat(), "approved", json.dumps(plan.get("features", []))))
        db.audit(user["id"], user["username"], "subscription_free_activated", plan_id)
        return {"ok": True, "status": "active", "plan": plan_id, "whatsapp_url": ""}
    whatsapp = ""
    note = str(body.get("note", "")).strip()[:500]
    with db.cursor() as cur:
        cur.execute("""INSERT INTO subscription_requests(user_id,plan_id,price_inr,status,whatsapp_url,note)
                       VALUES(?,?,?,?,?,?)""", (user["id"], plan_id, price, "pending", whatsapp, note))
        req_id = cur.lastrowid
    db.audit(user["id"], user["username"], "subscription_requested", f"request={req_id} plan={plan_id} price={price}")
    return {"ok": True, "status": "pending", "request_id": req_id, "plan": plan_id, "price_inr": price,
            "whatsapp_url": whatsapp,
            "message": "Request created. An Owner/Admin can review and approve the request from the Admin Dashboard."}


@app.get("/api/subscriptions/requests")
def subscription_requests(user=Depends(auth.require_login)):
    if user["role"] not in ("OWNER", "ADMIN"):
        return JSONResponse({"error": "Owner/Admin only"}, status_code=403)
    with db.cursor() as cur:
        cur.execute("""SELECT sr.*, u.username FROM subscription_requests sr
                       JOIN users u ON u.id=sr.user_id
                       ORDER BY sr.id DESC LIMIT 300""")
        return {"requests": [dict(r) for r in cur.fetchall()]}


@app.post("/api/subscriptions/requests/{request_id}/approve")
async def approve_subscription_request(request_id: int, request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    with db.cursor() as cur:
        cur.execute("SELECT * FROM subscription_requests WHERE id=?", (request_id,))
        req = cur.fetchone()
    if not req:
        return JSONResponse({"error": "Subscription request not found."}, status_code=404)
    if req["status"] != "pending":
        return JSONResponse({"error": f"Request is already {req['status']}."}, status_code=409)
    approve = bool(body.get("approve", True))
    if not approve:
        with db.cursor() as cur:
            cur.execute("UPDATE subscription_requests SET status='rejected',reviewed_at=datetime('now'),reviewed_by=? WHERE id=?", (user["id"], request_id))
        db.audit(user["id"], user["username"], "subscription_request_rejected", str(request_id))
        return {"ok": True, "status": "rejected"}
    expiry = body.get("expiry_date")
    with db.cursor() as cur:
        cur.execute("INSERT INTO subscriptions(user_id,plan,status,start_date,expiry_date,approval_status,feature_permissions) VALUES(?,?,?,?,?,?,?)",
                    (req["user_id"], req["plan_id"], "active", datetime.now(timezone.utc).replace(tzinfo=None).date().isoformat(), expiry, "approved", json.dumps({})))
        cur.execute("UPDATE subscription_requests SET status='approved',reviewed_at=datetime('now'),reviewed_by=? WHERE id=?", (user["id"], request_id))
    db.audit(user["id"], user["username"], "subscription_request_approved", f"request={request_id} user={req['user_id']} plan={req['plan_id']}")
    return {"ok": True, "status": "approved", "user_id": req["user_id"], "plan": req["plan_id"]}


@app.get("/api/subscriptions/my-requests")
def my_subscription_requests(user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT id,plan_id,price_inr,status,whatsapp_url,note,created_at,reviewed_at FROM subscription_requests WHERE user_id=? ORDER BY id DESC LIMIT 50", (user["id"],))
        return {"requests": [dict(r) for r in cur.fetchall()]}


@app.get("/api/access/features")
def access_features(user=Depends(auth.require_login)):
    if user["role"] == "GUEST":
        return {"plan":"GUEST_FREE","features":["all"],"restricted":False,"guest":True}
    if user["role"] in ("OWNER", "ADMIN"):
        return {"plan": "OWNER_FREE" if user["role"] == "OWNER" else "ADMIN_FREE", "features": ["all"], "restricted": False}
    with db.cursor() as cur:
        cur.execute("SELECT plan,status FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1", (user["id"],))
        sub = cur.fetchone()
        cur.execute("SELECT feature,enabled FROM user_feature_overrides WHERE user_id=?", (user["id"],))
        overrides = {r["feature"]: bool(r["enabled"]) for r in cur.fetchall()}
        cur.execute("SELECT 1 FROM friends WHERE friend_user_id=? LIMIT 1", (user["id"],))
        is_friend = bool(cur.fetchone())
    plan = sub["plan"] if sub and sub["status"] == "active" else "FREE"
    settings = get_settings_merged()
    plans = settings.get("subscription_plans", [])
    chosen = next((x for x in plans if x.get("id") == plan), next((x for x in plans if x.get("id") == "FREE"), {}))
    features = set(str(x) for x in chosen.get("features", []))
    if is_friend:
        features.update({"friends_trading", "friends_only"})
    for feature, enabled in overrides.items():
        if enabled: features.add(feature)
        else: features.discard(feature)
    if "all" in features:
        return {"plan": plan, "features": ["all"], "restricted": False, "overrides": overrides}
    return {"plan": plan, "features": sorted(features), "restricted": plan == "FREE" and not overrides, "overrides": overrides}

@app.post("/api/ai/models/pull")
async def ai_model_pull(request: Request, user=Depends(auth.require_login)):
    body=await request.json(); provider=str(body.get("provider","ollama")); model=str(body.get("model","")).strip()
    if not model: return JSONResponse({"error":"model required"},status_code=400)
    if provider != "ollama": return JSONResponse({"error":"Only explicit Ollama pulls are supported by this installer; GGUF uses direct local files/HTTPS downloads."},status_code=400)
    ollama=shutil.which("ollama")
    if not ollama: return JSONResponse({"error":"Ollama is not installed. Install Ollama first."},status_code=400)
    try:
        proc=subprocess.run([ollama,"pull",model],capture_output=True,text=True,timeout=900)
        if proc.returncode!=0: return JSONResponse({"error":proc.stderr[-1200:] or "ollama pull failed"},status_code=400)
        db.audit(user["id"],user["username"],"ai_model_pull",model)
        return {"ok":True,"provider":"ollama","model":model,"output":proc.stdout[-2000:]}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)


GUEST_COOKIE = "hcr_guest_session"
GUEST_MINUTES = 10
# Compatibility markers retained for older regression tests; they are empty by design.
# No plaintext or hashed default subscriber credential is shipped.
SUBSCRIBER_GUEST_PASSWORD_HASH = ""
SUBSCRIBER_GUEST_PASSWORD_SALT = ""


def _guest_cleanup_expired():
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    with db.cursor() as cur:
        cur.execute("SELECT user_id FROM guest_sessions WHERE expires_at < ? OR active=0", (now,))
        ids = [r["user_id"] for r in cur.fetchall()]
        for uid in ids:
            # Remove all guest-owned data before deleting the ephemeral user.
            for table, col in [
                ("messages","conversation_id"),("conversations","user_id"),("ai_errors","user_id"),
                ("app_usage","user_id"),("feedback","user_id"),("store_installs","user_id"),
                ("update_events","user_id"),("user_security","user_id"),("user_feature_overrides","user_id"),
                ("user_agreements","user_id"),("sync_queue","user_id"),("subscription_requests","user_id"),
                ("subscriptions","user_id"),("vault_entries","user_id"),("friend_access","friend_user_id"),
                ("friend_profiles","owner_user_id"),
            ]:
                try:
                    if col == "conversation_id":
                        cur.execute("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=?)", (uid,))
                    else:
                        cur.execute(f"DELETE FROM {table} WHERE {col}=?", (uid,))
                except Exception:
                    pass
            cur.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            cur.execute("DELETE FROM guest_sessions WHERE user_id=?", (uid,))
            try:
                cur.execute("DELETE FROM users WHERE id=? AND role='GUEST'", (uid,))
            except Exception:
                pass


def _guest_current(request: Request):
    _guest_cleanup_expired()
    token = request.cookies.get(GUEST_COOKIE)
    if not token:
        return None
    with db.cursor() as cur:
        cur.execute("SELECT gs.*,u.* FROM guest_sessions gs JOIN users u ON u.id=gs.user_id WHERE gs.token=? AND gs.active=1", (token,))
        row = cur.fetchone()
    if not row:
        return None
    if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc).replace(tzinfo=None):
        _guest_cleanup_expired(); return None
    return row


@app.get("/api/guest/status")
def guest_status(request: Request):
    g = _guest_current(request)
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM guest_sessions WHERE active=1 AND expires_at > ?", (datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),))
        occupied = bool(cur.fetchone()["n"])
    return {"active": bool(g), "occupied": occupied, "minutes": GUEST_MINUTES, "mode": g["mode"] if g else None, "expires_at": g["expires_at"] if g else None}


@app.post("/api/guest/start")
async def guest_start(request: Request, response: Response):
    _guest_cleanup_expired()
    body = await request.json()
    mode = str(body.get("mode", "friends_only")).strip().lower()
    if mode not in ("friends_only", "subscription_only"):
        return JSONResponse({"error":"Invalid guest access mode."}, status_code=400)
    password = str(body.get("password", ""))
    if not password:
        return JSONResponse({"error":"Password required."}, status_code=400)
    if mode == "friends_only":
        profile = str(body.get("profile", "Jyotish")).strip() or "Jyotish"
        with db.cursor() as cur:
            cur.execute("SELECT password_hash,password_salt,enabled FROM friend_profiles WHERE name=? AND enabled=1 ORDER BY id LIMIT 1", (profile,))
            fp = cur.fetchone()
        if not fp:
            return JSONResponse({"error":"Friends Only access is not configured. Complete First-run Access Setup as Owner."}, status_code=403)
        if not auth.verify_password(password, fp["password_salt"], fp["password_hash"]):
            return JSONResponse({"error":"Friends Only password is incorrect."}, status_code=401)
    else:
        settings = get_settings_merged()
        custom_hash = settings.get("subscriber_guest_password_hash") or ""
        custom_salt = settings.get("subscriber_guest_password_salt") or ""
        if not custom_hash or not custom_salt:
            return JSONResponse({"error":"Subscribers Only access is not configured. Complete First-run Access Setup as Owner."}, status_code=403)
        if not auth.verify_password(password, custom_salt, custom_hash):
            return JSONResponse({"error":"Subscribers Only password is incorrect."}, status_code=401)
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM guest_sessions WHERE active=1 AND expires_at > ?", (datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),))
        if cur.fetchone()["n"]:
            return JSONResponse({"error":"Guest access is busy. Only one person can use it at a time."}, status_code=409)
        uname = "guest-" + secrets.token_hex(8)
        pw_hash, salt = auth.hash_password(secrets.token_urlsafe(24))
        cur.execute("INSERT INTO users(username,password_hash,salt,role,status) VALUES(?,?,?,?,?)", (uname,pw_hash,salt,"GUEST","active"))
        uid = cur.lastrowid
        token = secrets.token_hex(32)
        expires = (datetime.now(timezone.utc).replace(tzinfo=None)+timedelta(minutes=GUEST_MINUTES)).isoformat()
        cur.execute("INSERT INTO guest_sessions(token,user_id,mode,profile_name,expires_at) VALUES(?,?,?,?,?)", (token,uid,mode,"Jyotish" if mode=="friends_only" else "Subscribers Only",expires))
    hcr_token = auth.create_session(uid, lifetime_hours=(GUEST_MINUTES/60))
    response.set_cookie(auth.SESSION_COOKIE, hcr_token, httponly=True, samesite="lax", max_age=GUEST_MINUTES*60)
    response.set_cookie(GUEST_COOKIE, token, httponly=True, samesite="lax", max_age=GUEST_MINUTES*60)
    return {"ok":True,"user":{"id":uid,"username":"Guest","role":"GUEST","status":"active"},"mode":mode,"expires_at":expires,"minutes":GUEST_MINUTES}


@app.post("/api/guest/exit")
def guest_exit(request: Request, response: Response):
    g = _guest_current(request)
    if g:
        with db.cursor() as cur:
            cur.execute("UPDATE guest_sessions SET active=0 WHERE token=?", (request.cookies.get(GUEST_COOKIE),))
            cur.execute("DELETE FROM sessions WHERE user_id=?", (g["user_id"],))
        _guest_cleanup_expired()
    response.delete_cookie(GUEST_COOKIE)
    return {"ok":True}

@app.get("/api/access/status")
def access_status(request: Request, user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM friends WHERE friend_user_id=? LIMIT 1", (user["id"],))
        friend = bool(cur.fetchone())
        cur.execute("SELECT plan,status,expiry_date,approval_status FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1", (user["id"],))
        sub = cur.fetchone()
    if user["role"] == "GUEST":
        g = _guest_current(request) if 'request' in locals() else None
        return {"friends_only": bool(g and g["mode"]=="friends_only"), "subscription": {"plan":"GUEST"} if g and g["mode"]=="subscription_only" else None, "role":"GUEST", "allowed":bool(g), "guest":True, "expires_at":g["expires_at"] if g else None}
    # v3.8: every logged-in account is OWNER or ADMIN now, so access is
    # always allowed once you're logged in - friends/subscriptions are
    # legacy fields kept for backward compatibility with old installs.
    return {"friends_only": friend, "subscription": dict(sub) if sub else None,
            "role": user["role"], "allowed": True}

@app.get("/api/feedback")
def list_feedback(user=Depends(auth.require_login)):
    if user["role"] not in ("OWNER","ADMIN"):
        return JSONResponse({"error":"Owner/Admin only"}, status_code=403)
    with db.cursor() as cur:
        cur.execute("SELECT * FROM feedback ORDER BY id DESC LIMIT 200")
        return {"items":[dict(r) for r in cur.fetchall()]}

@app.post("/api/feedback")
async def submit_feedback(request: Request, user=Depends(auth.require_login)):
    body=await request.json()
    category=str(body.get("category","Other"))[:40]
    message=str(body.get("message","")).strip()[:8000]
    if not message: return JSONResponse({"error":"message required"}, status_code=400)
    with db.cursor() as cur:
        cur.execute("INSERT INTO feedback(user_id,category,message) VALUES(?,?,?)",(user["id"],category,message))
    db.audit(user["id"],user["username"],"feedback_submit",category)
    return {"ok":True}

@app.get("/api/owner/access")
def owner_access(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("""SELECT u.id,u.username,u.role,u.status,
                       CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS friend,
                       COALESCE(s.plan,'FREE') AS plan, COALESCE(s.status,'inactive') AS sub_status
                       FROM users u LEFT JOIN friends f ON f.friend_user_id=u.id
                       LEFT JOIN subscriptions s ON s.user_id=u.id
                       ORDER BY u.username""")
        return {"users":[dict(r) for r in cur.fetchall()]}

@app.post("/api/owner/friends/{user_id}")
def set_friend(user_id:int, request:Request, user=Depends(auth.require_admin)):
    body = {}
    # Body is optional; default add
    try:
        # FastAPI sync handler cannot await; request body isn't needed for default.
        pass
    except Exception:
        pass
    enabled = True
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE id=?",(user_id,))
        if not cur.fetchone(): return JSONResponse({"error":"user not found"},status_code=404)
        if enabled:
            cur.execute("INSERT OR IGNORE INTO friends(owner_user_id,friend_user_id) VALUES(?,?)",(user["id"],user_id))
    return {"ok":True,"friend":True}

@app.delete("/api/owner/friends/{user_id}")
def remove_friend(user_id:int, user=Depends(auth.require_admin)):
    with db.cursor() as cur: cur.execute("DELETE FROM friends WHERE owner_user_id=? AND friend_user_id=?",(user["id"],user_id))
    return {"ok":True,"friend":False}

@app.post("/api/owner/subscriptions/{user_id}")
async def set_subscription(user_id:int, request:Request, user=Depends(auth.require_admin)):
    body=await request.json()
    plan=str(body.get("plan","SUBSCRIBER"))[:40]
    status=str(body.get("status","active"))[:20]
    expiry=body.get("expiry_date")
    with db.cursor() as cur:
        cur.execute("INSERT INTO subscriptions(user_id,plan,status,start_date,expiry_date,approval_status,feature_permissions) VALUES(?,?,?,?,?,?,?)",
                    (user_id,plan,status,datetime.now(timezone.utc).replace(tzinfo=None).date().isoformat(),expiry,"approved",json.dumps(body.get("feature_permissions",{}))))
    return {"ok":True}


# v2.6: real developer toolchain detection/install via the host package manager.
TOOLCHAINS = {
    "python": {"name":"Python", "description":"Python interpreter", "commands":["python","python3"]},
    "cpp": {"name":"C++", "description":"GNU/Clang C++ compiler", "commands":["g++","clang++"]},
    "c": {"name":"C", "description":"GNU/Clang C compiler", "commands":["gcc","clang"]},
    "javascript": {"name":"Node.js", "description":"JavaScript runtime", "commands":["node"]},
    "typescript": {"name":"TypeScript", "description":"TypeScript compiler (usually installed with Node.js/npm)", "commands":["tsc"]},
    "rust": {"name":"Rust", "description":"Rust compiler and Cargo", "commands":["rustc"]},
    "go": {"name":"Go", "description":"Go compiler/runtime", "commands":["go"]},
    "java": {"name":"Java", "description":"Java runtime/compiler", "commands":["java","javac"]},
    "cmake": {"name":"CMake", "description":"Cross-platform build system", "commands":["cmake"]},
    "git": {"name":"Git", "description":"Version control and repository tools", "commands":["git"]},
    "make": {"name":"Make", "description":"Build automation tool", "commands":["make"]},
    "curl": {"name":"cURL", "description":"HTTP and file transfer utility", "commands":["curl"]},
    "wget": {"name":"Wget", "description":"Command-line downloader", "commands":["wget"]},
    "openssh": {"name":"OpenSSH", "description":"Secure remote shell tools", "commands":["ssh"]},
}

def _tool_exists(cmd):
    return bool(shutil.which(cmd))

def _tool_installed(spec):
    return any(_tool_exists(c) for c in spec["commands"])

def _package_install_candidates(tool_id):
    system=platform.system()
    packages={
      "python":{"apt":"python3","dnf":"python3","pacman":"python","brew":"python","winget":"Python.Python.3.12","choco":"python"},
      "cpp":{"apt":"g++","dnf":"gcc-c++","pacman":"gcc","brew":"gcc","winget":"LLVM.LLVM","choco":"mingw"},
      "c":{"apt":"gcc","dnf":"gcc","pacman":"gcc","brew":"gcc","winget":"LLVM.LLVM","choco":"mingw"},
      "javascript":{"apt":"nodejs npm","dnf":"nodejs npm","pacman":"nodejs npm","brew":"node","winget":"OpenJS.NodeJS.LTS","choco":"nodejs"},
      "typescript":{"apt":"nodejs npm","dnf":"nodejs npm","pacman":"nodejs npm","brew":"node","winget":"OpenJS.NodeJS.LTS","choco":"nodejs"},
      "rust":{"apt":"rustc cargo","dnf":"rust cargo","pacman":"rust","brew":"rust","winget":"Rustlang.Rustup","choco":"rust"},
      "go":{"apt":"golang","dnf":"golang","pacman":"go","brew":"go","winget":"GoLang.Go","choco":"golang"},
      "java":{"apt":"default-jdk","dnf":"java-17-openjdk-devel","pacman":"jdk-openjdk","brew":"openjdk","winget":"Microsoft.OpenJDK.17","choco":"microsoft-openjdk"},
      "cmake":{"apt":"cmake","dnf":"cmake","pacman":"cmake","brew":"cmake","winget":"Kitware.CMake","choco":"cmake"},
      "git":{"apt":"git","dnf":"git","pacman":"git","brew":"git","winget":"Git.Git","choco":"git"},
      "make":{"apt":"make","dnf":"make","pacman":"make","brew":"make","winget":"GnuWin32.Make","choco":"make"},
      "curl":{"apt":"curl","dnf":"curl","pacman":"curl","brew":"curl","winget":"cURL.cURL","choco":"curl"},
      "wget":{"apt":"wget","dnf":"wget","pacman":"wget","brew":"wget","winget":"GNU.Wget2","choco":"wget"},
      "openssh":{"apt":"openssh-client","dnf":"openssh-clients","pacman":"openssh","brew":"openssh","winget":"Microsoft.OpenSSH.Beta","choco":"openssh"},
    }
    return packages.get(tool_id,{}), system

@app.get("/api/toolchains")
def toolchains():
    out=[]
    for tid,spec in TOOLCHAINS.items():
        out.append({"id":tid,"name":spec["name"],"description":spec["description"],"command":next((c for c in spec["commands"] if _tool_exists(c)),spec["commands"][0]),"installed":_tool_installed(spec)})
    return {"toolchains":out,"platform":platform.system()}

@app.post("/api/toolchains/install")
def install_toolchain(payload: dict, request: Request):
    if not is_local(request): return JSONResponse({"error":"Local access required."},status_code=403)
    tid=str(payload.get("id","")).strip()
    if tid not in TOOLCHAINS: return JSONResponse({"error":"Unknown toolchain."},status_code=400)
    spec=TOOLCHAINS[tid]
    if _tool_installed(spec): return {"ok":True,"message":f"{spec['name']} is already installed."}
    pkgs,system=_package_install_candidates(tid)
    if system=="Linux":
        if shutil.which("apt-get") and pkgs.get("apt"):
            cmd=["apt-get","install","-y",*pkgs["apt"].split()]
        elif shutil.which("dnf") and pkgs.get("dnf"):
            cmd=["dnf","install","-y",*pkgs["dnf"].split()]
        elif shutil.which("pacman") and pkgs.get("pacman"):
            cmd=["pacman","-S","--noconfirm",*pkgs["pacman"].split()]
        else: return {"ok":False,"error":"No supported Linux package manager found."}
    elif system=="Darwin":
        if not shutil.which("brew"): return {"ok":False,"error":"Homebrew is required for automatic macOS installation."}
        cmd=["brew","install",pkgs.get("brew","")]
    elif system=="Windows":
        if shutil.which("winget") and pkgs.get("winget"): cmd=["winget","install","--accept-source-agreements","--accept-package-agreements","--id",pkgs["winget"]]
        elif shutil.which("choco") and pkgs.get("choco"): cmd=["choco","install",pkgs["choco"],"-y"]
        else: return {"ok":False,"error":"Install winget or Chocolatey first."}
    else:
        return {"ok":False,"error":f"Automatic installation is not supported on {system}."}
    try:
        proc=subprocess.run(cmd,capture_output=True,text=True,timeout=300)
        output=(proc.stdout+"\n"+proc.stderr)[-6000:]
        return {"ok":proc.returncode==0,"message":f"{spec['name']} installation finished.","output":output,"returncode":proc.returncode}
    except Exception as e:
        return {"ok":False,"error":str(e)}

@app.post("/api/toolchains/install-all")
def install_all_toolchains(request: Request):
    if not is_local(request): return JSONResponse({"error":"Local access required."},status_code=403)
    results=[]
    for tid in TOOLCHAINS:
        spec=TOOLCHAINS[tid]
        if _tool_installed(spec):
            results.append({"id":tid,"ok":True,"message":"Already installed"}); continue
        pkgs,system=_package_install_candidates(tid)
        try:
            if system=="Linux":
                if shutil.which("apt-get") and pkgs.get("apt"): cmd=["apt-get","install","-y",*pkgs["apt"].split()]
                elif shutil.which("dnf") and pkgs.get("dnf"): cmd=["dnf","install","-y",*pkgs["dnf"].split()]
                elif shutil.which("pacman") and pkgs.get("pacman"): cmd=["pacman","-S","--noconfirm",*pkgs["pacman"].split()]
                else: results.append({"id":tid,"ok":False,"message":"No supported package manager"}); continue
            elif system=="Darwin":
                if not shutil.which("brew"): results.append({"id":tid,"ok":False,"message":"Homebrew required"}); continue
                cmd=["brew","install",*pkgs.get("brew","").split()]
            elif system=="Windows":
                if shutil.which("winget") and pkgs.get("winget"): cmd=["winget","install","--accept-source-agreements","--accept-package-agreements","--id",pkgs["winget"]]
                elif shutil.which("choco") and pkgs.get("choco"): cmd=["choco","install",pkgs["choco"],"-y"]
                else: results.append({"id":tid,"ok":False,"message":"winget or Chocolatey required"}); continue
            else: results.append({"id":tid,"ok":False,"message":f"Unsupported OS: {system}"}); continue
            proc=subprocess.run(cmd,capture_output=True,text=True,timeout=300)
            results.append({"id":tid,"ok":proc.returncode==0,"message":f"{spec['name']}: return code {proc.returncode}","output":(proc.stdout+proc.stderr)[-1200:]})
        except Exception as exc: results.append({"id":tid,"ok":False,"message":str(exc)})
    ok=sum(1 for x in results if x.get("ok")); return {"ok":all(x.get("ok") for x in results),"message":f"Environment setup finished: {ok}/{len(results)} ready.","results":results}

@app.post("/api/toolchains/run")
def run_toolchain(payload: dict, request: Request):
    if not is_local(request): return JSONResponse({"error":"Local access required."},status_code=403)
    lang=str(payload.get("language","")).strip(); code=str(payload.get("code","") or "")
    if lang not in TOOLCHAINS or len(code)>50000: return {"error":"Unsupported language or code too large."}
    # Only small local snippets; compilation is done in a temporary directory and no shell is used.
    td=Path(tempfile.mkdtemp(prefix="hcr-code-"))
    try:
        if lang=="python":
            if not _tool_exists("python3") and not _tool_exists("python"): return {"error":"Python is not installed."}
            exe=shutil.which("python3") or shutil.which("python"); proc=subprocess.run([exe,"-c",code],capture_output=True,text=True,timeout=10,cwd=td)
        elif lang in ("javascript",):
            exe=shutil.which("node");
            if not exe:return {"error":"Node.js is not installed."}
            f=td/"main.js";f.write_text(code,encoding="utf-8");proc=subprocess.run([exe,str(f)],capture_output=True,text=True,timeout=10,cwd=td)
        else:
            return {"error":"This language can be edited/downloaded here; install its toolchain before execution is enabled."}
        return {"ok":proc.returncode==0,"output":(proc.stdout+proc.stderr)[-10000:],"returncode":proc.returncode}
    except subprocess.TimeoutExpired:return {"error":"Execution timed out."}
    except Exception as e:return {"error":str(e)}
    finally:
        shutil.rmtree(td,ignore_errors=True)


# v1.0 BETA: Windows-style local system shortcuts. These are a strict
# allowlist: the browser can request only named system destinations, never
# arbitrary shell commands.
SYSTEM_DESTINATIONS = {
    "recycle_bin", "this_pc", "network", "bluetooth", "network_settings",
    "display", "sound", "control_panel", "task_manager", "date_time"
}

@app.post("/api/system/open")
async def open_system_destination(request: Request, user=Depends(auth.require_admin)):
    if not is_local(request):
        return JSONResponse({"error": "System controls are available only on this device."}, status_code=403)
    body = await request.json()
    target = str(body.get("target") or "").strip().lower()
    if target not in SYSTEM_DESTINATIONS:
        return JSONResponse({"error": "Unsupported system destination."}, status_code=400)
    try:
        system = platform.system()
        if system == "Windows":
            win_targets = {
                "recycle_bin": ["explorer.exe", "shell:RecycleBinFolder"],
                "this_pc": ["explorer.exe", "shell:MyComputerFolder"],
                "network": ["explorer.exe", "shell:NetworkPlacesFolder"],
                "bluetooth": ["explorer.exe", "ms-settings:bluetooth"],
                "network_settings": ["explorer.exe", "ms-settings:network-status"],
                "display": ["explorer.exe", "ms-settings:display"],
                "sound": ["explorer.exe", "ms-settings:sound"],
                "control_panel": ["control.exe"],
                "task_manager": ["taskmgr.exe"],
                "date_time": ["explorer.exe", "ms-settings:dateandtime"],
            }
            subprocess.Popen(win_targets[target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        elif system == "Darwin":
            targets = {
                "recycle_bin": ["open", "~/.Trash"], "this_pc": ["open", str(Path.home())],
                "network": ["open", "/Network"], "bluetooth": ["open", "x-apple.systempreferences:com.apple.Bluetooth"],
                "network_settings": ["open", "x-apple.systempreferences:com.apple.Network-Settings.extension"],
                "display": ["open", "x-apple.systempreferences:com.apple.Displays-Settings.extension"],
                "sound": ["open", "x-apple.systempreferences:com.apple.Sound-Settings.extension"],
                "control_panel": ["open", "x-apple.systempreferences:"], "task_manager": ["open", "/Applications/Utilities/Activity Monitor.app"],
                "date_time": ["open", "x-apple.systempreferences:com.apple.Date-Time-Settings.extension"],
            }
            subprocess.Popen(targets[target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            targets = {
                "recycle_bin": ["gio", "open", "trash:///"], "this_pc": ["xdg-open", str(Path.home())],
                "network": ["xdg-open", "network:///"], "bluetooth": ["xdg-open", "settings://"],
                "network_settings": ["xdg-open", "settings://"], "display": ["xdg-open", "settings://"],
                "sound": ["xdg-open", "settings://"], "control_panel": ["xdg-open", "settings://"],
                "task_manager": ["xdg-open", "system-monitor"], "date_time": ["xdg-open", "settings://"],
            }
            cmd = targets[target]
            if shutil.which(cmd[0]):
                subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                return JSONResponse({"error": "No supported desktop settings opener was found on this OS."}, status_code=501)
        db.audit(user["id"], user["username"], "system_shortcut_open", target)
        return {"ok": True, "target": target, "platform": system}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)

@app.post("/api/system/network-reset")
async def network_reset(request: Request, user=Depends(auth.require_admin)):
    if not is_local(request):
        return JSONResponse({"error": "Network reset is available only on this device."}, status_code=403)
    body = await request.json()
    if str(body.get("confirm") or "").strip().upper() != "RESET NETWORK":
        return JSONResponse({"error": 'Type "RESET NETWORK" to confirm.'}, status_code=400)
    system = platform.system()
    try:
        if system == "Windows":
            cmd = ["ipconfig.exe", "/flushdns"]
        elif shutil.which("resolvectl"):
            cmd = ["resolvectl", "flush-caches"]
        elif shutil.which("systemd-resolve"):
            cmd = ["systemd-resolve", "--flush-caches"]
        else:
            return JSONResponse({"error": "A supported local DNS reset command is unavailable on this OS."}, status_code=501)
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        db.audit(user["id"], user["username"], "network_reset", "local DNS cache refresh")
        return {"ok": proc.returncode == 0, "output": (proc.stdout or proc.stderr).strip(), "note": "Local DNS/network cache refreshed. A full adapter reset is intentionally not performed without an explicit OS-level recovery action."}
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)

def _builtin_store_catalog():
    return [
      {"id":"notes","name":"HCR Notes","version":"1.4.0","category":"Productivity","description":"Local notes with auto-save.","builtin":True,"app_id":"notes"},
      {"id":"calculator","name":"Scientific Calculator","version":"1.4.0","category":"Utilities","description":"Basic and scientific calculator.","builtin":True,"app_id":"calc"},
      {"id":"file-manager","name":"File Manager","version":"1.4.0","category":"System Tools","description":"Browse, copy, move and manage local files.","builtin":True,"app_id":"files"},
      {"id":"system-monitor","name":"System Monitor","version":"1.4.0","category":"System Tools","description":"CPU, RAM, storage, network and battery information.","builtin":True,"app_id":"sysmon"},
      {"id":"terminal","name":"Safe Terminal","version":"1.4.0","category":"Developer Tools","description":"Local terminal with authorization gates.","builtin":True,"app_id":"terminal"},
      {"id":"clock","name":"Clock / Timer / Alarm","version":"1.4.0","category":"Utilities","description":"Clock, timers and alarms.","builtin":True,"app_id":"clock"},
      {"id":"browser","name":"HCR Web Browser","version":"1.4.0","category":"Internet","description":"Embedded browser window with external fallback.","builtin":True,"app_id":"browser"},
      {"id":"control-panel","name":"HCR Control Panel","version":"1.4.0","category":"System Tools","description":"Power, battery, privacy, screen and quick-unlock controls.","builtin":True,"app_id":"control"},
      {"id":"ai-chat","name":"HCR AI Agent Chat","version":"1.4.0","category":"AI Tools","description":"Real Ollama/GGUF local AI chat.","builtin":True,"app_id":"aichat"},
      {"id":"ai-models","name":"AI Model Manager","version":"1.4.0","category":"AI Tools","description":"Detect and explicitly download supported local models.","builtin":True,"app_id":"aimodels"},
      {"id":"kausar-ai","name":"HCR AI Agent Assistant","version":"1.4.0","category":"AI Tools","description":"Assistant control, voice and safe actions.","builtin":True,"app_id":"jarvis"},
      {"id":"python-games","name":"Python Games","version":"1.4.0","category":"Games","description":"Python-backed mini games.","builtin":True,"app_id":"games"},
      {"id":"wallpaper","name":"Wallpaper Changer","version":"3.3.0","category":"Personalization","description":"Change built-in or custom wallpapers locally.","builtin":True,"app_id":"wallpaper"},
      {"id":"theme","name":"Theme Manager","version":"3.3.0","category":"Personalization","description":"Switch UI themes and accessibility appearance.","builtin":True,"app_id":"theme"},
      {"id":"network-tools","name":"HCR Network Tools","version":"1.4.0","category":"Network","description":"Local network status and diagnostics.","builtin":True,"app_id":"network"},
      {"id":"system-info","name":"System Information","version":"3.3.0","category":"System Tools","description":"OS, CPU, RAM, battery and disk details.","builtin":True,"app_id":"systeminfo"},
      {"id":"json-viewer","name":"JSON Viewer","version":"3.3.0","category":"Developer Tools","description":"Inspect and format JSON data.","builtin":True,"app_id":"jsonviewer"},
      {"id":"markdown","name":"Markdown Preview","version":"3.3.0","category":"Developer Tools","description":"Write and preview Markdown locally.","builtin":True,"app_id":"editor"},
      {"id":"hcr-store","name":"HCR Store","version":"1.4.0","category":"Store","description":"Browse and install optional modules.","builtin":True,"app_id":"store"},
      {"id":"feedback-support","name":"Feedback & Support","version":"1.4.0","category":"Support","description":"Bug reports, suggestions and support links.","builtin":True,"app_id":"feedback"},
      {"id":"updates","name":"HCR Update Center","version":"1.4.0","category":"System Tools","description":"GitHub release checks and update management.","builtin":True,"app_id":"updates"},
      {"id":"security-center","name":"HCR Security Center","version":"1.4.0","category":"Security","description":"Authentication, RBAC and security summary.","builtin":True,"app_id":"security"},
      {"id":"password-manager","name":"HCR Password Vault","version":"1.0.0","category":"Security","description":"Local credential notes protected by account access.","builtin":True,"app_id":"passwords"},
      {"id":"games-2d","name":"HCR 2D Game Pack","version":"2.5.0","category":"Games","description":"Snake, Pong and puzzle games.","builtin":True,"app_id":"games"},
      {"id":"games-3d","name":"HCR 3D Game Pack","version":"2.5.0","category":"Games","description":"Voxel World and lightweight 3D games.","builtin":True,"app_id":"games"},
      {"id":"troubleshooting","name":"Troubleshooting Center","version":"1.4.0","category":"System Tools","description":"Diagnostics and recovery guidance.","builtin":True,"app_id":"troubleshoot"},
      {"id":"settings","name":"Settings","version":"1.4.0","category":"System Tools","description":"Full configuration center.","builtin":True,"app_id":"settings"},
      {"id":"admin-dashboard","name":"Admin Dashboard","version":"1.4.0","category":"Administration","description":"Admin support, updates, store and system dashboard.","builtin":True,"app_id":"admin"},
    ]

@app.post("/api/admin/store/apps")
async def admin_add_store_app(request: Request, user=Depends(auth.require_admin)):
    body = await request.json()
    app_id = re.sub(r"[^a-zA-Z0-9._-]", "-", str(body.get("id") or "").strip())[:80]
    name = str(body.get("name") or "").strip()[:120]
    version = str(body.get("version") or "1.0.0").strip()[:40]
    category = str(body.get("category") or "Utilities").strip()[:60]
    description = str(body.get("description") or "").strip()[:500]
    price = int(body.get("price_inr") or 0)
    source = str(body.get("source") or "").strip()[:1000]
    icon = str(body.get("icon") or "📦")[:8]
    if not app_id or not name or price <= 0:
        return JSONResponse({"error":"ID, name and a positive paid-app price are required."}, status_code=400)
    if source and not source.startswith("https://"):
        return JSONResponse({"error":"Source must use HTTPS."}, status_code=400)
    with db.cursor() as cur:
        cur.execute("INSERT INTO store_apps(id,name,version,category,description,price_inr,source,icon,enabled,created_by) VALUES(?,?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,category=excluded.category,description=excluded.description,price_inr=excluded.price_inr,source=excluded.source,icon=excluded.icon,enabled=1,updated_at=datetime('now')", (app_id,name,version,category,description,price,source,icon,user["id"]))
    db.audit(user["id"], user["username"], "store_app_saved", f"{app_id} ₹{price}")
    return {"ok":True,"app":{"id":app_id,"name":name,"version":version,"category":category,"description":description,"price_inr":price,"source":source,"icon":icon,"builtin":False,"app_id":app_id}}

@app.get("/api/admin/store/apps")
def admin_list_store_apps(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("SELECT id,name,version,category,description,price_inr,source,icon,enabled,created_at,updated_at FROM store_apps ORDER BY name COLLATE NOCASE")
        return {"apps":[dict(r) for r in cur.fetchall()]}

@app.delete("/api/admin/store/apps/{app_id}")
def admin_delete_store_app(app_id: str, user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("DELETE FROM store_apps WHERE id=?", (app_id,))
    db.audit(user["id"], user["username"], "store_app_deleted", app_id)
    return {"ok":True}

@app.get("/api/store")
def store_catalog(user=Depends(auth.require_login)):
    catalog = _builtin_store_catalog()
    with db.cursor() as cur:
        cur.execute("SELECT id,name,version,category,description,price_inr,source,icon,enabled FROM store_apps WHERE enabled=1 ORDER BY name COLLATE NOCASE")
        for r in cur.fetchall():
            a=dict(r); a["builtin"]=False; a["app_id"]=a["id"]; catalog.append(a)
    return {"apps":catalog}

@app.post("/api/store/unlock")
async def store_unlock(request: Request, user=Depends(auth.require_login)):
    """Unlock a single paid/important Store feature with its own
    password. Wrong or missing password just says 'incorrect' - the
    frontend then offers the configured WhatsApp channel/group as a way
    to ask the Owner, instead of guessing."""
    body = await request.json()
    if user["role"] == "GUEST":
        return {"ok": True, "guest_free": True}
    app_id = str(body.get("app_id", ""))[:100]
    password = str(body.get("password", ""))
    if not app_id:
        return JSONResponse({"error": "app_id required"}, status_code=400)
    if not feature_locks.is_locked(app_id):
        return {"ok": True, "already_unlocked": True}
    if not feature_locks.verify(app_id, password):
        db.audit(user["id"], user["username"], "store_unlock_failed", app_id)
        return JSONResponse({"error": "Incorrect password for this feature."}, status_code=403)
    db.audit(user["id"], user["username"], "store_unlock_ok", app_id)
    return {"ok": True}

@app.get("/api/owner/store/locks")
def owner_list_store_locks(user=Depends(auth.require_admin)):
    return {"locked": feature_locks.locked_app_ids()}

@app.post("/api/owner/store/locks")
async def owner_set_store_lock(request: Request, user=Depends(auth.require_admin)):
    """Owner-only: set (or clear, with an empty password) the password
    for one Store feature. Never returns or logs the password itself."""
    body = await request.json()
    app_id = str(body.get("app_id", ""))[:100]
    password = str(body.get("password", ""))
    if not app_id:
        return JSONResponse({"error": "app_id required"}, status_code=400)
    if not password:
        feature_locks.remove_lock(app_id)
        db.audit(user["id"], user["username"], "store_lock_removed", app_id)
        return {"ok": True, "locked": False}
    try:
        feature_locks.set_lock(app_id, password)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    db.audit(user["id"], user["username"], "store_lock_set", app_id)
    return {"ok": True, "locked": True}

@app.get("/api/store/installed")
def store_installed(user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("SELECT app_id,version,source,installed_at FROM store_installs WHERE user_id=? ORDER BY installed_at DESC",(user["id"],))
        return {"apps":[dict(r) for r in cur.fetchall()]}

@app.post("/api/store/request")
async def store_request(request: Request, user=Depends(auth.require_login)):
    body = await request.json()
    app_id = str(body.get("app_id", "")).strip()[:80]
    app_name = str(body.get("app_name", app_id)).strip()[:120]
    note = str(body.get("note", "")).strip()[:500]
    try:
        price = max(0, int(body.get("price_inr", 0)))
    except Exception:
        return JSONResponse({"error":"Invalid app price."}, status_code=400)
    if not app_id or price <= 0:
        return JSONResponse({"error":"A paid Store app and price are required."}, status_code=400)
    st = get_settings_merged()
    whatsapp = ""
    with db.cursor() as cur:
        cur.execute("INSERT INTO subscription_requests(user_id,plan_id,price_inr,status,whatsapp_url,note) VALUES(?,?,?,?,?,?)",
                    (user["id"], "STORE:" + app_id, price, "pending", whatsapp, ("App: " + app_name + "\n" + note)[:500]))
        request_id = cur.lastrowid
    db.audit(user["id"], user["username"], "store_purchase_requested", f"request={request_id} app={app_id} price={price}")
    return {"ok": True, "request_id": request_id, "app_id": app_id, "price_inr": price, "whatsapp_url": whatsapp,
            "message": "Request created. Owner/Admin confirmation is required before any external app is treated as purchased."}

@app.post("/api/store/install")
async def store_install(request:Request, user=Depends(auth.require_login)):
    body=await request.json()
    app_id=str(body.get("app_id",""))[:100]
    version=str(body.get("version",""))[:40]
    source=str(body.get("source",""))[:1000]
    if not app_id or not version: return JSONResponse({"error":"app_id and version required"},status_code=400)
    # Only explicit user action reaches here. Remote package installation is
    # accepted only as a HTTPS ZIP and is extracted with traversal protection.
    installed_path=None
    if source:
        if not source.startswith("https://"): return JSONResponse({"error":"store source must be HTTPS"},status_code=400)
        plugins=BASE_DIR/"plugins"; plugins.mkdir(exist_ok=True)
        tmp=DATA_DIR/"store_download.tmp"
        try:
            req=urllib.request.Request(source,headers={"User-Agent":"DeveloperHCR-Store/1.1"})
            with urllib.request.urlopen(req,timeout=20) as r: tmp.write_bytes(r.read())
            target=plugins/app_id
            target.mkdir(parents=True,exist_ok=True)
            with zipfile.ZipFile(tmp) as zz:
                for n in zz.namelist():
                    p=(target/n).resolve()
                    if target.resolve() not in p.parents and p != target.resolve():
                        raise ValueError("unsafe package path")
                zz.extractall(target)
            installed_path=str(target)
        except Exception as e:
            return JSONResponse({"error":f"install failed: {e}"},status_code=400)
        finally:
            try: tmp.unlink()
            except OSError: pass
    with db.cursor() as cur:
        cur.execute("INSERT INTO store_installs(user_id,app_id,version,source) VALUES(?,?,?,?) ON CONFLICT(user_id,app_id) DO UPDATE SET version=excluded.version,source=excluded.source,installed_at=datetime('now')",
                    (user["id"],app_id,version,source))
    db.audit(user["id"],user["username"],"store_install",app_id)
    return {"ok":True,"app_id":app_id,"version":version,"path":installed_path}

@app.get("/api/games")
def games_list(user=Depends(auth.require_login)):
    from games.registry import GAMES
    return {"games":GAMES}

@app.post("/api/games/{game_id}")
async def games_run(game_id:str, request:Request, user=Depends(auth.require_login)):
    from games import engine
    body=await request.json()
    if game_id=="dice": return engine.dice(body.get("count",2))
    if game_id=="guess_number":
        return engine.guess_number(int(body.get("guess",1)), body.get("secret"))
    return JSONResponse({"error":"unknown game"},status_code=404)


# --------------------------------------------------------------------------
# v1.1: REAL BROKER TRADING (Zerodha Kite Connect, opt-in)
# --------------------------------------------------------------------------
KITE_API_BASE = "https://api.kite.trade"
KITE_LOGIN_BASE = "https://kite.zerodha.com/connect/login"
_kite_access_token = None
_kite_pending = {}

def _kite_headers():
    key = os.getenv("KITE_API_KEY", "").strip()
    token = _kite_access_token or os.getenv("KITE_ACCESS_TOKEN", "").strip()
    if not key or not token:
        raise RuntimeError("Zerodha Kite credentials are not configured. Set KITE_API_KEY and complete broker login.")
    return {"X-Kite-Version":"3", "Authorization":f"token {key}:{token}"}

def _kite_enabled():
    return os.getenv("LIVE_TRADING_ENABLED", "0").lower() in {"1","true","yes","on"}

def _kite_role_ok(user):
    return user.get("role") in {"OWNER","ADMIN"}

@app.get("/api/trading/live/status")
async def trading_live_status(user=Depends(auth.require_login)):
    configured=bool(os.getenv("KITE_API_KEY"))
    enabled=_kite_enabled()
    connected=bool(_kite_access_token or os.getenv("KITE_ACCESS_TOKEN"))
    if not configured or not connected:
        return {"broker":"Zerodha Kite Connect","configured":configured,"enabled":enabled,"connected":False,"mode":"paper","message":"Configure KITE_API_KEY and complete broker login to enable live account data."}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r=await client.get(KITE_API_BASE+"/user/profile",headers=_kite_headers())
            data=r.json()
        if r.status_code>=400 or data.get("status")!="success":
            return {"broker":"Zerodha Kite Connect","configured":configured,"enabled":enabled,"connected":False,"mode":"paper","error":data.get("message","Broker authentication failed.")}
        return {"broker":"Zerodha Kite Connect","configured":configured,"enabled":enabled,"connected":True,"mode":"live" if enabled else "paper","user":data.get("data",{})}
    except Exception as e:
        return {"broker":"Zerodha Kite Connect","configured":configured,"enabled":enabled,"connected":False,"mode":"paper","error":str(e)}

@app.get("/api/trading/live/login-url")
async def trading_live_login_url(user=Depends(auth.require_login)):
    if not _kite_role_ok(user):
        return JSONResponse({"error":"Live broker setup is restricted to Admin/Owner."},status_code=403)
    key=os.getenv("KITE_API_KEY","").strip()
    if not key: return JSONResponse({"error":"KITE_API_KEY is not configured on the server."},status_code=400)
    redirect=os.getenv("KITE_REDIRECT_URL","http://127.0.0.1:8000/api/trading/live/callback").strip()
    return {"url":f"{KITE_LOGIN_BASE}?v=3&api_key={urllib.parse.quote(key)}&redirect_params=from%3DDeveloperHCR","redirect_url":redirect}

@app.get("/api/trading/live/callback")
async def trading_live_callback(request:Request):
    global _kite_access_token
    token=request.query_params.get("request_token","")
    status=request.query_params.get("status","")
    key=os.getenv("KITE_API_KEY","").strip(); secret=os.getenv("KITE_API_SECRET","").strip()
    if not token or status!="success": return JSONResponse({"error":"Broker login was not completed."},status_code=400)
    if not key or not secret: return JSONResponse({"error":"KITE_API_KEY/KITE_API_SECRET are not configured."},status_code=500)
    import hashlib
    checksum=hashlib.sha256((key+token+secret).encode()).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r=await client.post(KITE_API_BASE+"/session/token",data={"api_key":key,"request_token":token,"checksum":checksum},headers={"X-Kite-Version":"3"})
            data=r.json()
        if r.status_code>=400 or data.get("status")!="success": return JSONResponse({"error":data.get("message","Token exchange failed.")},status_code=400)
        _kite_access_token=data["data"]["access_token"]
        return {"ok":True,"message":"Broker connected. You may close this page and return to DeveloperHCR."}
    except Exception as e:
        return JSONResponse({"error":str(e)},status_code=500)

@app.get("/api/trading/live/quote")
async def trading_live_quote(symbol:str, exchange:str="NSE", user=Depends(auth.require_login)):
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r=await client.get(KITE_API_BASE+"/quote",params={"i":f"{exchange}:{symbol.upper()}"},headers=_kite_headers())
            data=r.json()
        if r.status_code>=400 or data.get("status")!="success": return JSONResponse({"error":data.get("message","Quote unavailable")},status_code=400)
        q=data.get("data",{}).get(f"{exchange}:{symbol.upper()}")
        if not q: return JSONResponse({"error":"Instrument not found."},status_code=404)
        return {"ok":True,"quote":q,"symbol":symbol.upper(),"exchange":exchange}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

@app.get("/api/trading/live/orders")
async def trading_live_orders(user=Depends(auth.require_login)):
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r=await client.get(KITE_API_BASE+"/orders",headers=_kite_headers())
            data=r.json()
        if r.status_code>=400 or data.get("status")!="success": return JSONResponse({"error":data.get("message","Orders unavailable")},status_code=400)
        return {"orders":data.get("data",[])}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

@app.get("/api/trading/live/portfolio")
async def trading_live_portfolio(user=Depends(auth.require_login)):
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            p=await client.get(KITE_API_BASE+"/portfolio/holdings",headers=_kite_headers())
            pos=await client.get(KITE_API_BASE+"/portfolio/positions",headers=_kite_headers())
            m=await client.get(KITE_API_BASE+"/user/margins",headers=_kite_headers())
            pd=p.json(); ps=pos.json(); md=m.json()
        return {"holdings":pd.get("data",[]),"positions":ps.get("data",{}),"margins":md.get("data",{})}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

@app.post("/api/trading/live/order/prepare")
async def trading_live_order_prepare(request:Request,user=Depends(auth.require_login)):
    if not _kite_role_ok(user): return JSONResponse({"error":"Live orders are restricted to Admin/Owner."},status_code=403)
    body=await request.json(); required=["exchange","tradingsymbol","transaction_type","quantity","order_type","product","validity"]
    if any(x not in body for x in required): return JSONResponse({"error":"Missing order fields."},status_code=400)
    qty=int(body["quantity"]); price=float(body.get("price") or 0)
    if qty<=0: return JSONResponse({"error":"Quantity must be positive."},status_code=400)
    if body["order_type"]=="LIMIT" and price<=0: return JSONResponse({"error":"LIMIT orders require a positive price."},status_code=400)
    # Explicit confirmation token; nothing is sent to the broker in this step.
    confirm=secrets.token_urlsafe(18); _kite_pending[confirm]={"user_id":user["id"],"body":body,"created":time.time()}
    return {"ok":True,"confirmation_token":confirm,"order":body,"warning":"This confirmation can submit a REAL order to your broker. Verify symbol, side, quantity, product and price before confirming."}

@app.post("/api/trading/live/order/confirm")
async def trading_live_order_confirm(request:Request,user=Depends(auth.require_login)):
    if not _kite_role_ok(user): return JSONResponse({"error":"Live orders are restricted to Admin/Owner."},status_code=403)
    if not _kite_enabled(): return JSONResponse({"error":"Live trading is disabled. Set LIVE_TRADING_ENABLED=1 on the server first."},status_code=403)
    body=await request.json(); token=str(body.get("confirmation_token", "")); pending=_kite_pending.pop(token,None)
    if not pending or pending["user_id"]!=user["id"] or time.time()-pending["created"]>120: return JSONResponse({"error":"Confirmation expired or invalid. Prepare the order again."},status_code=400)
    order=pending["body"]
    allowed={"exchange","tradingsymbol","transaction_type","quantity","order_type","product","validity","price","trigger_price","disclosed_quantity","tag","market_protection","autoslice"}
    payload={k:order[k] for k in order if k in allowed and order[k] not in (None,"")}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r=await client.post(KITE_API_BASE+"/orders/regular",data=payload,headers=_kite_headers())
            data=r.json()
        if r.status_code>=400 or data.get("status")!="success": return JSONResponse({"error":data.get("message","Broker rejected the order."),"broker_response":data},status_code=400)
        db.audit(user["id"],user["username"],"live_trade",f"{order.get('transaction_type')} {order.get('exchange')}:{order.get('tradingsymbol')} qty={order.get('quantity')} type={order.get('order_type')}")
        return {"ok":True,"mode":"live","order_id":data.get("data",{}).get("order_id"),"broker_response":data}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

@app.delete("/api/trading/live/order/{order_id}")
async def trading_live_order_cancel(order_id:str,user=Depends(auth.require_login)):
    if not _kite_role_ok(user): return JSONResponse({"error":"Live orders are restricted to Admin/Owner."},status_code=403)
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r=await client.delete(KITE_API_BASE+f"/orders/regular/{order_id}",headers=_kite_headers())
            data=r.json()
        if r.status_code>=400 or data.get("status")!="success": return JSONResponse({"error":data.get("message","Cancel failed")},status_code=400)
        db.audit(user["id"],user["username"],"live_trade_cancel",f"order_id={order_id}")
        return {"ok":True,"order_id":order_id}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

# --------------------------------------------------------------------------
# Friends Only: practice trading simulator (no real orders/money)
# --------------------------------------------------------------------------
@app.get("/api/trading/practice/state")
def trading_practice_state(user=Depends(auth.require_login)):
    if user["role"] in ("OWNER","ADMIN"):
        allowed=True
    else:
        with db.cursor() as cur:
            cur.execute("SELECT 1 FROM friends WHERE friend_user_id=? LIMIT 1", (user["id"],)); allowed=bool(cur.fetchone())
    if not allowed:
        return JSONResponse({"error":"Practice Trading is a Friends Only feature."},status_code=403)
    with db.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS practice_trading(user_id INTEGER PRIMARY KEY,balance REAL NOT NULL,pnl REAL NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        cur.execute("CREATE TABLE IF NOT EXISTS practice_positions(user_id INTEGER,symbol TEXT,qty INTEGER,avg_price REAL,PRIMARY KEY(user_id,symbol))")
        cur.execute("SELECT balance,pnl FROM practice_trading WHERE user_id=?",(user["id"],)); r=cur.fetchone()
        if not r:
            cur.execute("INSERT INTO practice_trading(user_id,balance,pnl) VALUES(?,?,?)",(user["id"],100000.0,0.0)); balance=100000.0; pnl=0.0
        else:
            balance=float(r["balance"]); pnl=float(r["pnl"])
        cur.execute("SELECT symbol,qty,avg_price FROM practice_positions WHERE user_id=? AND qty<>0 ORDER BY symbol",(user["id"],))
        positions={x["symbol"]:{"qty":x["qty"],"avg_price":x["avg_price"]} for x in cur.fetchall()}
        return {"balance":balance,"pnl":pnl,"positions":positions,"mode":"practice_only"}

@app.post("/api/trading/practice/order")
async def trading_practice_order(request:Request,user=Depends(auth.require_login)):
    if user["role"] not in ("OWNER","ADMIN"):
        with db.cursor() as cur:
            cur.execute("SELECT 1 FROM friends WHERE friend_user_id=? LIMIT 1",(user["id"],));
            if not cur.fetchone(): return JSONResponse({"error":"Practice Trading is a Friends Only feature."},status_code=403)
    body=await request.json(); side=str(body.get("side","BUY")).upper(); symbol=str(body.get("symbol","HCR"))[:20]; price=float(body.get("price",0)); qty=int(body.get("qty",0))
    if side not in ("BUY","SELL") or price<=0 or qty<=0: return JSONResponse({"error":"Invalid simulated order."},status_code=400)
    with db.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS practice_trading(user_id INTEGER PRIMARY KEY,balance REAL NOT NULL,pnl REAL NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        cur.execute("CREATE TABLE IF NOT EXISTS practice_positions(user_id INTEGER,symbol TEXT,qty INTEGER,avg_price REAL,PRIMARY KEY(user_id,symbol))")
        cur.execute("SELECT balance,pnl FROM practice_trading WHERE user_id=?",(user["id"],)); r=cur.fetchone()
        balance=float(r["balance"]) if r else 100000.0; pnl=float(r["pnl"]) if r else 0.0
        value=price*qty
        cur.execute("SELECT qty,avg_price FROM practice_positions WHERE user_id=? AND symbol=?",(user["id"],symbol)); pos=cur.fetchone()
        old_qty=int(pos["qty"]) if pos else 0; old_avg=float(pos["avg_price"]) if pos else 0.0
        if side=="BUY":
            balance-=value
            new_qty=old_qty+qty
            new_avg=((old_qty*old_avg)+(qty*price))/new_qty if new_qty else 0.0
            cur.execute("INSERT INTO practice_positions(user_id,symbol,qty,avg_price) VALUES(?,?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET qty=excluded.qty,avg_price=excluded.avg_price",(user["id"],symbol,new_qty,new_avg))
        else:
            if old_qty < qty:
                return JSONResponse({"error":f"Cannot sell {qty} {symbol}; current practice position is {old_qty}."},status_code=400)
            balance+=value
            realized=(price-old_avg)*qty
            pnl+=realized
            new_qty=old_qty-qty
            if new_qty: cur.execute("UPDATE practice_positions SET qty=? WHERE user_id=? AND symbol=?",(new_qty,user["id"],symbol))
            else: cur.execute("DELETE FROM practice_positions WHERE user_id=? AND symbol=?",(user["id"],symbol))
        cur.execute("INSERT INTO practice_trading(user_id,balance,pnl) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,pnl=excluded.pnl,updated_at=CURRENT_TIMESTAMP",(user["id"],balance,pnl))
        cur.execute("SELECT symbol,qty,avg_price FROM practice_positions WHERE user_id=? AND qty<>0 ORDER BY symbol",(user["id"],))
        positions={x["symbol"]:{"qty":x["qty"],"avg_price":x["avg_price"]} for x in cur.fetchall()}
    db.audit(user["id"],user["username"],"practice_trade",f"{side} {symbol} qty={qty} price={price}")
    return {"ok":True,"mode":"practice_only","side":side,"symbol":symbol,"qty":qty,"price":price,"balance":balance,"pnl":pnl,"positions":positions}

@app.post("/api/trading/practice/reset")
def trading_practice_reset(user=Depends(auth.require_login)):
    if user["role"] not in ("OWNER","ADMIN"):
        with db.cursor() as cur:
            cur.execute("SELECT 1 FROM friends WHERE friend_user_id=? LIMIT 1",(user["id"],));
            if not cur.fetchone(): return JSONResponse({"error":"Practice Trading is a Friends Only feature."},status_code=403)
    with db.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS practice_trading(user_id INTEGER PRIMARY KEY,balance REAL NOT NULL,pnl REAL NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
        cur.execute("CREATE TABLE IF NOT EXISTS practice_positions(user_id INTEGER,symbol TEXT,qty INTEGER,avg_price REAL,PRIMARY KEY(user_id,symbol))")
        cur.execute("INSERT INTO practice_trading(user_id,balance,pnl) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,pnl=excluded.pnl,updated_at=CURRENT_TIMESTAMP",(user["id"],100000.0,0.0))
        cur.execute("DELETE FROM practice_positions WHERE user_id=?",(user["id"],))
    return {"ok":True,"balance":100000.0,"pnl":0.0,"positions":{},"mode":"practice_only"}

@app.get("/api/exe/list")
def exe_list(user=Depends(auth.require_login)):
    roots=[]
    for candidate in [DATA_DIR/"downloads", Path.home()/"Downloads", Path("/storage/emulated/0/Download")]:
        try:
            if candidate.exists() and candidate.is_dir(): roots.append(candidate.resolve())
        except OSError: pass
    found=[]; seen=set()
    for root in roots:
        try:
            for pth in root.rglob("*.exe"):
                try:
                    rp=pth.resolve()
                    if rp in seen or not rp.is_file(): continue
                    seen.add(rp); found.append({"name":pth.name,"path":str(rp),"size":pth.stat().st_size})
                except OSError: continue
                if len(found)>=100: break
        except OSError: continue
        if len(found)>=100: break
    return {"supported":platform.system()=="Windows" or bool(shutil.which("wine") or shutil.which("wine64")),"files":found,"roots":[str(x) for x in roots]}

@app.get("/api/exe/status")
def exe_status(user=Depends(auth.require_login)):
    wine=shutil.which("wine") or shutil.which("wine64")
    return {"enabled":get_settings_merged().get("exe_support_enabled",True),
            "os":platform.system(),"wine":wine,"supported":platform.system()=="Windows" or bool(wine)}

@app.post("/api/exe/install-wine")
async def exe_install_wine(request: Request, user=Depends(auth.require_login)):
    if user["role"] not in ("OWNER", "ADMIN"):
        return JSONResponse({"error":"Owner/Admin permission required"}, status_code=403)
    if not is_local(request):
        return JSONResponse({"error":"local only"}, status_code=403)
    if platform.system() == "Windows":
        return {"ok":True,"installed":True,"note":"Windows does not require Wine to run native EXE files."}
    if shutil.which("wine") or shutil.which("wine64"):
        return {"ok":True,"installed":True,"wine":shutil.which("wine") or shutil.which("wine64"),"note":"Wine is already installed."}
    commands=[]
    if platform.system()=="Linux":
        if shutil.which("apt-get"):
            commands=[["pkexec","apt-get","update"],["pkexec","apt-get","install","-y","wine"]] if shutil.which("pkexec") else [["apt-get","update"],["apt-get","install","-y","wine"]]
        elif shutil.which("dnf"):
            commands=[["pkexec","dnf","install","-y","wine"]] if shutil.which("pkexec") else [["dnf","install","-y","wine"]]
        elif shutil.which("pacman"):
            commands=[["pkexec","pacman","-Sy","--noconfirm","wine"]] if shutil.which("pkexec") else [["pacman","-Sy","--noconfirm","wine"]]
        else:
            return JSONResponse({"error":"No supported Linux package manager detected. Install Wine using your distribution's official package manager."},status_code=400)
    elif platform.system()=="Darwin" and shutil.which("brew"):
        commands=[["brew","install","--cask","wine-stable"]]
    else:
        return JSONResponse({"error":"Automatic Wine installation is not supported on this platform. Use the official platform package manager."},status_code=400)
    try:
        # Only execute an explicitly requested installation. No shell is used.
        outputs=[]
        for cmd in commands:
            proc=subprocess.run(cmd,capture_output=True,text=True,timeout=600)
            outputs.append((proc.stdout+"\n"+proc.stderr)[-2500:])
            if proc.returncode!=0:
                return JSONResponse({"ok":False,"error":"Wine installation command failed.","output":"\n".join(outputs),"command":cmd},status_code=400)
        wine=shutil.which("wine") or shutil.which("wine64")
        if not wine:
            return JSONResponse({"ok":False,"error":"Package installation completed but Wine executable was not found yet. Restart the terminal/app and check again."},status_code=400)
        db.audit(user["id"],user["username"],"wine_install","success")
        return {"ok":True,"installed":True,"wine":wine,"output":"\n".join(outputs)}
    except subprocess.TimeoutExpired:
        return JSONResponse({"ok":False,"error":"Wine installation timed out. Finish the package-manager prompt in the system terminal, then check again."},status_code=408)
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e)},status_code=400)

@app.post("/api/exe/run")
async def exe_run(request:Request, user=Depends(auth.require_login)):
    if user["role"] not in ("OWNER","ADMIN"):
        return JSONResponse({"error":"Owner/Admin permission required"},status_code=403)
    body=await request.json(); path=str(body.get("path",""))
    p=Path(path).expanduser().resolve()
    if not p.is_file() or p.suffix.lower()!=".exe": return JSONResponse({"error":"select a valid .exe file"},status_code=400)
    if not is_local(request): return JSONResponse({"error":"local only"},status_code=403)
    try:
        if platform.system()=="Windows": subprocess.Popen([str(p)],cwd=str(p.parent))
        else:
            wine=shutil.which("wine") or shutil.which("wine64")
            if not wine: return JSONResponse({"error":"Wine is not installed"},status_code=400)
            subprocess.Popen([wine,str(p)],cwd=str(p.parent))
        db.audit(user["id"],user["username"],"exe_run",str(p))
        return {"ok":True}
    except Exception as e: return JSONResponse({"error":str(e)},status_code=400)

@app.get("/api/updates/announcement")
def update_announcement(user=Depends(auth.require_login)):
    with db.cursor() as cur:
        cur.execute("""SELECT id,title,message,created_at FROM support_announcements
                       WHERE active=1 ORDER BY id DESC LIMIT 1""")
        row=cur.fetchone()
    return {"announcement":dict(row) if row else None}


@app.post("/api/owner/updates/announcement")
async def owner_update_announcement(request:Request,user=Depends(auth.require_admin)):
    body=await request.json()
    title=str(body.get("title","DeveloperHCR Update")).strip()[:120]
    message=str(body.get("message","")).strip()[:5000]
    if not message:
        return JSONResponse({"error":"Update message is required."},status_code=400)
    with db.cursor() as cur:
        cur.execute("UPDATE support_announcements SET active=0 WHERE active=1")
        cur.execute("""INSERT INTO support_announcements(created_by,title,message,active)
                       VALUES(?,?,?,1)""",(user["id"],title,message))
    db.audit(user["id"],user["username"],"update_announcement_sent",title)
    return {"ok":True}


@app.delete("/api/owner/updates/announcement")
def owner_delete_announcement(user=Depends(auth.require_admin)):
    with db.cursor() as cur:
        cur.execute("UPDATE support_announcements SET active=0 WHERE active=1")
    db.audit(user["id"],user["username"],"update_announcement_removed","")
    return {"ok":True}


# v1.0 BETA fix: @app.get("/api/updates/check") was previously stacked on
# update_announcement() above by mistake (two decorators on the wrong
# function), so checking for updates silently returned announcement data
# instead of real GitHub release info, and this function — the one that
# actually does the check — was never registered as a route at all.
@app.get("/api/updates/check")
def update_check(user=Depends(auth.require_login)):
    st=get_settings_merged(); owner=str(st.get("update_repo_owner","") or "").strip(); repo=str(st.get("update_repo_name","") or "").strip()
    if not owner or not repo: return {"configured":False,"message":"Admin has not configured an update repository."}
    base=f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}"
    try:
        try:
            rel=_github_json(base+"/releases/latest")
            latest=rel.get("tag_name") or ""
            return {"configured":True,"available":latest not in ("",APP_VERSION,"v"+APP_VERSION),
                    "current":APP_VERSION,"latest":latest,"name":rel.get("name"),"body":rel.get("body","") or "",
                    "html_url":rel.get("html_url"),"assets":[{"name":a.get("name"),"url":a.get("browser_download_url")} for a in rel.get("assets",[])]}
        except Exception as release_error:
            # Repositories without a GitHub Release should still appear in Admin:
            # fall back to the newest tag, then to the default branch commit.
            tags=_github_json(base+"/tags")
            if isinstance(tags,list) and tags:
                tag=tags[0].get("name") or ""
                return {"configured":True,"available":tag not in ("",APP_VERSION,"v"+APP_VERSION),"current":APP_VERSION,"latest":tag,"name":"GitHub tag","body":"No GitHub Release found; showing the newest repository tag.","html_url":f"https://github.com/{owner}/{repo}/releases"}
            commit=_github_json(base+"/commits?per_page=1")
            if isinstance(commit,list) and commit:
                sha=(commit[0].get("sha") or "")[:12]
                return {"configured":True,"available":False,"current":APP_VERSION,"latest":"main @ "+sha,"name":"GitHub repository","body":"No release/tag is published yet. Repository is reachable and ready for updates.","html_url":f"https://github.com/{owner}/{repo}"}
            raise release_error
    except Exception as e:
        return JSONResponse({"error":f"GitHub update check failed: {e}"},status_code=502)

@app.post("/api/updates/prepare")
async def update_prepare(request:Request,user=Depends(auth.require_admin)):
    body=await request.json(); asset_url=str(body.get("asset_url",""))
    version=str(body.get("version",""))
    if not asset_url.startswith("https://") or not version: return JSONResponse({"error":"HTTPS asset_url and version required"},status_code=400)
    update_dir=DATA_DIR/"updates"; update_dir.mkdir(exist_ok=True)
    archive=update_dir/f"DeveloperHCR-{version}.zip"
    try:
        req=urllib.request.Request(asset_url,headers={"User-Agent":"DeveloperHCR-Updater/1.1"})
        with urllib.request.urlopen(req,timeout=60) as r: archive.write_bytes(r.read())
        with zipfile.ZipFile(archive) as zz:
            bad=[n for n in zz.namelist() if Path(n).is_absolute() or ".." in Path(n).parts]
            if bad: raise ValueError("unsafe update archive")
        db.audit(user["id"],user["username"],"update_download",version)
        return {"ok":True,"archive":str(archive),"message":"Update downloaded and validated. Restart/apply can now be performed safely."}
    except Exception as e:
        return JSONResponse({"error":f"update prepare failed: {e}"},status_code=400)

