from __future__ import annotations
import argparse

def main():
    parser = argparse.ArgumentParser(description="DeveloperHCR JARVIS v0.9 local service")
    parser.add_argument("--scan", action="store_true", help="scan local AI runtimes/models")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    from .runtime_registry import RuntimeRegistry
    if args.scan:
        import json
        print(json.dumps(RuntimeRegistry().scan(), indent=2, ensure_ascii=False))
        return

    try:
        import uvicorn
        from .v09_api import app
        if app is None:
            raise RuntimeError("FastAPI is not installed")
        uvicorn.run(app, host=args.host, port=args.port)
    except ImportError as e:
        raise SystemExit(f"Optional API dependencies missing: {e}")

if __name__ == "__main__":
    main()
