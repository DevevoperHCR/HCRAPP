from __future__ import annotations
import os, shutil, subprocess, time
from dataclasses import dataclass, asdict

@dataclass
class RuntimeInfo:
    name: str
    kind: str
    available: bool
    executable: str | None = None
    models: list[str] | None = None
    status: str = "unknown"

class RuntimeRegistry:
    """Best-effort registry of locally detected AI runtimes and models."""
    def scan(self):
        out = []
        # Ollama
        ollama = shutil.which("ollama")
        info = RuntimeInfo("Ollama", "local_runtime", bool(ollama), ollama, [], "available" if ollama else "not_found")
        if ollama:
            try:
                p = subprocess.run([ollama, "list"], capture_output=True, text=True, timeout=3)
                if p.returncode == 0:
                    lines = p.stdout.splitlines()[1:]
                    info.models = [x.split()[0] for x in lines if x.strip()]
                    info.status = "running_or_reachable"
            except Exception:
                info.status = "detected_not_queryable"
        out.append(info)

        # llama.cpp / llama-cpp-python
        llama = shutil.which("llama-cli") or shutil.which("llama")
        try:
            import llama_cpp  # noqa: F401
            py = True
        except Exception:
            py = False
        out.append(RuntimeInfo("llama.cpp", "local_runtime", bool(llama or py),
                                llama, [], "available" if (llama or py) else "not_found"))

        # Hugging Face cache
        hf = os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface")
        out.append(RuntimeInfo("HuggingFace Cache", "model_store", os.path.isdir(hf),
                                hf if os.path.isdir(hf) else None, [], "available" if os.path.isdir(hf) else "not_found"))

        # GGUF search in conventional local directories (shallow to remain lightweight)
        models = []
        candidates = [
            os.path.expanduser("~/DeveloperHCR/AI/Models"),
            os.path.expanduser("~/models"),
            os.path.expanduser("~/.cache"),
        ]
        for base in candidates:
            if os.path.isdir(base):
                try:
                    for dp, dns, fns in os.walk(base):
                        dns[:] = [d for d in dns if not d.startswith(".")][:20]
                        for fn in fns:
                            if fn.lower().endswith(".gguf"):
                                models.append(os.path.join(dp, fn))
                                if len(models) >= 100:
                                    break
                        if len(models) >= 100:
                            break
                except Exception:
                    pass
            if len(models) >= 100:
                break
        out.append(RuntimeInfo("GGUF Models", "model_store", bool(models), None, models, "models_found" if models else "none_found"))
        return [asdict(x) for x in out]
