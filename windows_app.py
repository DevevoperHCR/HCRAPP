"""DeveloperHCR Stable v1.0 native desktop shell.

Starts the local FastAPI service and, when pywebview is available, displays the
HCR interface in its own native application window instead of opening a normal
browser tab. Browser fallback is retained for systems without a native WebView.
"""
from __future__ import annotations
import os, socket, sys, threading, time, webbrowser
from pathlib import Path

BASE_DIR=Path(__file__).resolve().parent
HOST="127.0.0.1"
PORT=8000

def find_free_port(start=PORT):
    for port in range(start,start+50):
        with socket.socket() as sock:
            if sock.connect_ex((HOST,port))!=0:return port
    raise RuntimeError("No free local port is available.")

def start_server(port):
    import uvicorn
    from server import app
    uvicorn.run(app,host=HOST,port=port,log_level="warning")

def main():
    if sys.version_info<(3,9):
        print("Python 3.9+ is required."); return 1
    os.chdir(BASE_DIR)
    port=find_free_port(); url=f"http://{HOST}:{port}"
    thread=threading.Thread(target=start_server,args=(port,),daemon=True); thread.start()
    # Give ASGI a moment to bind without adding a visible loading screen.
    for _ in range(60):
        with socket.socket() as sock:
            if sock.connect_ex((HOST,port))==0: break
        time.sleep(.05)
    try:
        import webview
        webview.create_window(
            "DeveloperHCR — Stable v1.0",
            url,
            width=1440,height=900,
            min_size=(900,600),
            resizable=True,
            text_select=True,
            confirm_close=True,
        )
        webview.start(debug=False)
    except ImportError:
        print("Native WebView package is not installed; opening browser fallback.")
        webbrowser.open(url)
        while thread.is_alive(): time.sleep(.5)
    return 0

if __name__=="__main__": raise SystemExit(main())
