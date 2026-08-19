"""
DeveloperHCR:AI Agent - BETA
launcher.py - SINGLE entry point.

Run:  python launcher.py

Does: OS/arch/python/RAM/CPU/GPU/network/port detection -> starts the
local server -> opens one platform-appropriate HCR launcher UI.
Desktop platforms prefer a native application window; Android/Termux
uses the local browser UI because Termux has no universal native WebView.
Never crashes if optional desktop dependencies are missing.
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


def is_android_termux():
    exe = str(Path(sys.executable)).lower()
    plat = platform.platform().lower()
    return sys.platform == "android" or "android_root" in os.environ or "android_data" in os.environ or "com.termux" in exe or "linux-android" in plat


def dependency_profile():
    return BASE_DIR / ("requirements-termux.txt" if is_android_termux() else "requirements.txt")


def optional_system_stats():
    try:
        import psutil
        return psutil.virtual_memory()
    except (ImportError, OSError):
        return None

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
    if is_android_termux():
        # Termux/Android must not accept the old Pydantic 1.10.15 build: on
        # Python 3.13 it triggers ForwardRef._evaluate() errors.
        for mod in ("fastapi", "uvicorn", "pydantic"):
            if importlib.util.find_spec(mod) is None:
                missing.append(mod)
        if "pydantic" not in missing:
            try:
                import pydantic
                from packaging.version import Version
                if Version(pydantic.__version__) < Version("1.10.21"):
                    missing.append("pydantic>=1.10.21")
            except Exception:
                # Avoid adding a packaging dependency just for this check.
                try:
                    parts = tuple(int(x) for x in pydantic.__version__.split(".")[:3])
                    if parts < (1, 10, 21):
                        missing.append("pydantic>=1.10.21")
                except Exception:
                    missing.append("pydantic>=1.10.21")
    else:
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


def open_local_url(url: str):
    """Open the HCR UI in the platform-appropriate shell."""
    try:
        if is_android_termux() and shutil.which("termux-open-url"):
            subprocess.Popen(["termux-open-url", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        return bool(webbrowser.open(url))
    except Exception:
        return False


def launch_native_desktop(url: str):
    """Use pywebview on Windows/Linux/macOS when available.
    Returns True when a native window was launched, otherwise False.
    """
    if is_android_termux():
        return False
    try:
        import webview
        title = "DeveloperHCR"
        system = platform.system()
        if system == "Windows":
            title = "DeveloperHCR"
        elif system == "Linux":
            title = "DeveloperHCR — Linux"
        elif system == "Darwin":
            title = "DeveloperHCR — macOS"
        webview.create_window(title, url, width=1440, height=900,
                              min_size=(900, 600), resizable=True,
                              text_select=True, confirm_close=True)
        webview.start(debug=False)
        return True
    except Exception as exc:
        print(f"  Native desktop shell unavailable: {exc}")
        return False


def launch_terminal_ui(url: str):
    """Optional terminal client; never launched automatically by the main launcher."""
    env = os.environ.copy()
    env["HCR_SERVER_URL"] = url
    tui = str(BASE_DIR / "tui.py")
    try:
        if platform.system() == "Windows":
            flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
            return subprocess.Popen([sys.executable, tui], cwd=str(BASE_DIR), env=env, creationflags=flags)
        if is_android_termux() and shutil.which("tmux"):
            return subprocess.Popen(["tmux", "new-window", "-n", "HCRAPP", sys.executable, tui],
                                    cwd=str(BASE_DIR), env=env)
        for term in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
            if not shutil.which(term):
                continue
            if term == "gnome-terminal":
                return subprocess.Popen([term, "--", sys.executable, tui], cwd=str(BASE_DIR), env=env)
            if term == "konsole":
                return subprocess.Popen([term, "-e", sys.executable, tui], cwd=str(BASE_DIR), env=env)
            if term == "xfce4-terminal":
                return subprocess.Popen([term, "--command", f"{sys.executable} {tui}"], cwd=str(BASE_DIR), env=env)
            return subprocess.Popen([term, "-e", sys.executable, tui], cwd=str(BASE_DIR), env=env)
    except Exception as exc:
        print(f"  Terminal UI could not be opened: {exc}")
    return None


def start_server_and_ui(port: int):
    url = f"http://{DISPLAY_HOST}:{port}"
    import uvicorn
    from server import app

    def open_one_launcher():
        time.sleep(0.8)
        if not launch_native_desktop(url):
            if not open_local_url(url):
                print(f"  HCR UI could not open automatically. Open: {url}")
    import threading
    threading.Thread(target=open_one_launcher, daemon=True).start()
    uvicorn.run(app, host=HOST, port=port, log_level="warning")


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

    vm = optional_system_stats()
    if vm is not None:
        boot_line("RAM", f"{vm.total / (1024**3):.1f} GB total, {vm.percent}% used")
    else:
        boot_line("RAM", "optional telemetry unavailable (platform-safe fallback)")

    boot_line("GPU", detect_gpu())
    boot_line("Network", "Online" if check_internet() else "Offline")
    boot_line("AI runtimes", ", ".join(detect_ai_runtimes()))
    boot_line("GUI capability", "Browser UI + Termux TUI (Termux-safe)")

    print()

    if not py_ok:
        print(f"  ERROR: Python >= {'.'.join(map(str, MIN_PYTHON))} required. Exiting.")
        sys.exit(1)

    requirements_file = dependency_profile()
    missing = check_deps()
    if missing:
        print(f"  Missing required packages: {', '.join(missing)}")
        answer = input("  Install them now with pip? [y/N]: ").strip().lower()
        if answer == "y":
            if is_android_termux():
                print("  Termux mode: installing the Pydantic v1/FastAPI compatibility profile (no pydantic-core Rust build).")
            pip_cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "-r", str(requirements_file)]
            result = subprocess.run(pip_cmd)
            if result.returncode != 0:
                print("  ERROR: dependency installation failed; application startup cancelled.")
                sys.exit(result.returncode or 1)
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

    start_server_and_ui(port)


if __name__ == "__main__":
    main()
