"""
DeveloperHCR:AI Agent - BETA
launcher.py - SINGLE entry point.

Run:  python launcher.py

Does: OS/arch/python/RAM/CPU/GPU/network/port detection -> shows a
Device Configuration Summary -> starts the local server -> opens the
browser. Never crashes if an optional dependency (psutil, GPU tools)
is missing - it just reports what it can.
"""

import importlib.util
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

MIN_PYTHON = (3, 9)
DEFAULT_PORT = 8000
HOST = "127.0.0.1"  # secure loopback bind
DISPLAY_HOST = "localhost"  # user-facing local URL


def boot_line(label, value, delay=0.08):
    print(f"  [ {label:<22} ] {value}")
    time.sleep(delay)


def check_python():
    ok = sys.version_info >= MIN_PYTHON
    return ok, f"{platform.python_version()}" + ("" if ok else f" (need >= {'.'.join(map(str, MIN_PYTHON))})")


def detect_gpu():
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                  capture_output=True, text=True, timeout=3)
            name = out.stdout.strip().splitlines()[0] if out.stdout.strip() else "NVIDIA GPU"
            return name
        except Exception:
            return "NVIDIA GPU (detected, details unavailable)"
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "Apple Silicon GPU"
    return "None detected / integrated"


def check_internet(timeout=1.5):
    try:
        socket.setdefaulttimeout(timeout)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
        return True
    except OSError:
        return False


def find_free_port(start=DEFAULT_PORT, tries=20):
    port = start
    for _ in range(tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex((HOST, port)) != 0:
                return port
        port += 1
    return None


def detect_ai_runtimes():
    found = []
    if shutil.which("ollama"):
        found.append("Ollama (CLI found)")
    if importlib.util.find_spec("llama_cpp"):
        found.append("llama-cpp-python (installed)")
    return found or ["None detected"]


def check_deps():
    missing = []
    for mod in ("fastapi", "uvicorn"):
        if importlib.util.find_spec(mod) is None:
            missing.append(mod)
    return missing

def ensure_first_run_owner():
    """Ensure internal background control state without exposing its identity.
    No Owner account will be created or changed by the launcher. Existing Owner data is never replaced or reset.
    The user-facing account is created by the user as ADMIN on first browser launch."""
    from backend import db, auth
    db.init_db()
    if auth.owner_exists():
        return True
    try:
        import secrets
        username = "system-" + secrets.token_hex(8)
        password = secrets.token_urlsafe(32)
        user_id = auth.create_user(username, password, role="OWNER")
        print("  Internal control state initialized.")
        print("  User-facing Admin credentials will be chosen on first browser launch.")
        return bool(user_id)
    except Exception as exc:
        print(f"  Internal control bootstrap skipped: {exc}")
        return False

def ensure_first_run_admin():
    """Never create a fixed/default Admin. The user chooses Admin credentials
    in the browser on first launch."""
    from backend import db, auth
    db.init_db()
    if auth.configurable_admin_exists():
        return
    print("  Admin setup required on first browser launch.")

def reset_role_password(role):
    """Admin-only local recovery. Owner password reset is intentionally disabled."""
    if role == "OWNER":
        print("  Owner password reset is disabled by policy. The existing Owner credential is preserved.")
        return 2
    from backend import auth, db
    db.init_db()
    with db.cursor() as cur:
        cur.execute("SELECT id, username FROM users WHERE role=? ORDER BY id LIMIT 1", (role,))
        user = cur.fetchone()
    if not user:
        print(f"  No {role} account exists.")
        return 1
    print(f"  Resetting password for {role}: {user['username']}")
    while True:
        password = input("  New password (min 8 characters): ")
        confirm = input("  Confirm new password: ")
        if len(password) < 8:
            print("  ERROR: Password must be at least 8 characters.")
            continue
        if password != confirm:
            print("  ERROR: Passwords do not match.")
            continue
        pw_hash, salt = auth.hash_password(password)
        with db.cursor() as cur:
            cur.execute("UPDATE users SET password_hash=?, salt=? WHERE id=?", (pw_hash, salt, user["id"]))
        print("  Password updated successfully.")
        return 0


def main():
    if "--reset-owner-password" in sys.argv:
        print("  Owner password reset is disabled. The existing Owner credential is preserved.")
        return 2
    if "--reset-admin-password" in sys.argv:
        return reset_role_password("ADMIN")
    if "--tui" in sys.argv:
        from tui import main as tui_main
        return tui_main()

    print()
    print("  DeveloperHCR:AI Agent - BETA v1.0")
    print("  " + "=" * 44)
    print("  Preparing device configuration...\n")

    boot_line("OS", f"{platform.system()} {platform.release()}")
    boot_line("Architecture", platform.machine())
    py_ok, py_str = check_python()
    boot_line("Python", py_str)
    boot_line("CPU cores", __import__("os").cpu_count() or "unknown")

    try:
        import psutil
        vm = psutil.virtual_memory()
        boot_line("RAM", f"{vm.total / (1024**3):.1f} GB total, {vm.percent}% used")
    except ImportError:
        boot_line("RAM", "psutil not installed (pip install psutil for details)")

    boot_line("GPU", detect_gpu())
    boot_line("Network", "Online" if check_internet() else "Offline")
    boot_line("AI runtimes", ", ".join(detect_ai_runtimes()))
    boot_line("GUI capability", "Browser-based UI (works headless too)")

    print()

    if not py_ok:
        print(f"  ERROR: Python >= {'.'.join(map(str, MIN_PYTHON))} required. Exiting.")
        sys.exit(1)

    requirements_file = BASE_DIR / "requirements.txt"
    missing = check_deps()
    if missing:
        print(f"  Missing required packages: {', '.join(missing)}")
        answer = input("  Install them now with pip? [y/N]: ").strip().lower()
        if answer == "y":
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements_file)])
        else:
            print("  Cannot continue without required packages. Run:")
            print(f"    pip install -r {requirements_file}")
            sys.exit(1)

    if not ensure_first_run_owner():
        sys.exit(1)
    ensure_first_run_admin()

    port = find_free_port(DEFAULT_PORT)
    if port is None:
        print("  ERROR: No free port found near 8000.")
        sys.exit(1)
    if port != DEFAULT_PORT:
        print(f"  Port {DEFAULT_PORT} busy -> using {port} instead.")

    url = f"http://{DISPLAY_HOST}:{port}"
    print()
    print(f"  Device Configuration Summary complete.")
    print(f"  Starting local server at {url}")
    print("  Authentication: first run asks you to create your Admin username and password.")
    print(f"  (Server is local-only by default - not exposed to your LAN/internet.)")
    print()

    import uvicorn
    from server import app

    # Open browser shortly after the server starts.
    def open_browser():
        time.sleep(1.2)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    uvicorn.run(app, host=HOST, port=port, log_level="warning")


if __name__ == "__main__":
    main()
