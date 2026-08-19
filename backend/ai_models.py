"""DeveloperHCR local AI model detection (v0.4).

Detection is best-effort and honest: no model is fabricated and no download is
performed automatically. Custom GGUF directories can be configured in the
normal Settings file while the original common locations remain supported.
"""
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path
from urllib import request as urlrequest
from urllib.error import URLError

from config import load_settings

OLLAMA_API = "http://127.0.0.1:11434/api/tags"
GGUF_SEARCH_DIRS = [
    Path.home() / "models",
    Path.home() / ".ollama" / "models",
    Path.home() / ".cache" / "huggingface",
    Path.home() / "AI" / "models",
    Path.home() / "Documents" / "models",
]


def gguf_search_dirs():
    result = list(GGUF_SEARCH_DIRS)
    settings = load_settings()
    custom = settings.get("ai_gguf_directories", []) + settings.get("ai_model_dirs", [])
    for raw in custom:
        try:
            p = Path(raw).expanduser().resolve()
            if p not in result:
                result.append(p)
        except (TypeError, ValueError, OSError):
            continue
    return result


def detect_ollama():
    result = {"installed": bool(shutil.which("ollama")), "running": False, "models": [], "error": None}
    try:
        with urlrequest.urlopen(OLLAMA_API, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            result["running"] = True
            result["models"] = [
                {"name": m.get("name"), "size_gb": round(m.get("size", 0) / (1024**3), 2)}
                for m in data.get("models", [])
            ]
    except URLError:
        result["error"] = "Ollama service not reachable on 127.0.0.1:11434 (is it running?)"
    except Exception as e:
        result["error"] = str(e)
    return result


def detect_gguf():
    found, seen = [], set()
    for base in gguf_search_dirs():
        if not base.exists() or not base.is_dir():
            continue
        try:
            for f in base.rglob("*.gguf"):
                try:
                    resolved = str(f.resolve())
                    if resolved in seen:
                        continue
                    stat = f.stat()
                    seen.add(resolved)
                    found.append({"name": f.name, "path": resolved,
                                  "size_gb": round(stat.st_size / (1024**3), 2)})
                except OSError:
                    continue
                if len(found) >= 100:
                    return found
        except (PermissionError, OSError):
            continue
    return found


def detect_llama_cpp():
    return importlib.util.find_spec("llama_cpp") is not None


def full_report():
    return {
        "ollama": detect_ollama(),
        "gguf_models": detect_gguf(),
        "gguf_search_dirs": [str(p) for p in gguf_search_dirs()],
        "llama_cpp_python_installed": detect_llama_cpp(),
        "note": "Detection only; no model download is performed automatically.",
    }
