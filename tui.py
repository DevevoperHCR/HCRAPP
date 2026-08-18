"""DeveloperHCR standalone terminal UI (v0.4).

This is a real OS-level TUI/CLI entry point. It uses the same local FastAPI
backend and SQLite database as the browser UI, so it does not create a second
state store. It intentionally stays dependency-light and works over SSH,
headless Linux, Kali and Termux where Python + the project dependencies exist.
"""
import getpass
import json
import sys
import urllib.error
import urllib.request
from backend.ai_models import full_report

BASE = "http://127.0.0.1:8000"


def request(path, method="GET", data=None, opener=None):
    payload = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, data=payload, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with (opener or urllib.request.build_opener()).open(req, timeout=5) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode() or "{}")
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def menu():
    print("\nDeveloperHCR:AI Agent — BETA v0.4")
    print("=" * 40)
    print("[1] System status")
    print("[2] AI model status")
    print("[3] Notes")
    print("[4] Server health")
    print("[5] Diagnostics")
    print("[q] Exit")
    return input("Select: ").strip().lower()


def main():
    print("DeveloperHCR standalone TUI")
    print("Connecting to local server at", BASE)
    status, info = request("/api/system")
    if status == 0:
        print("Server is not reachable. Start `python launcher.py` first.")
        return 1
    while True:
        choice = menu()
        if choice == "1":
            _, data = request("/api/system")
            print(json.dumps(data, indent=2, ensure_ascii=False))
        elif choice == "2":
            print(json.dumps(full_report(), indent=2, ensure_ascii=False))
        elif choice == "3":
            _, data = request("/api/notes")
            print("\nNotes:\n" + data.get("notes", ""))
        elif choice == "4":
            _, data = request("/api/health")
            print(json.dumps(data, indent=2))
        elif choice == "5":
            _, data = request("/api/diagnostics")
            print(json.dumps(data, indent=2, ensure_ascii=False))
        elif choice in ("q", "quit", "exit"):
            return 0
        else:
            print("Unknown option.")


if __name__ == "__main__":
    raise SystemExit(main())
