"""
DeveloperHCR v0.3 - ai/providers/ollama.py

Real integration with a locally running Ollama server. Nothing here is
simulated: if Ollama isn't installed/running, that is reported honestly
via ai/errors.py exceptions, never a fake model list or fake response.
"""

import shutil
import time

import httpx

from ai.errors import ConnectionFailed, ModelNotFound, ProviderNotInstalled, ProviderNotRunning
from ai.providers.base import AIProvider

OLLAMA_HOST = "http://127.0.0.1:11434"


class OllamaProvider(AIProvider):
    name = "ollama"

    async def status(self) -> dict:
        installed = shutil.which("ollama") is not None
        result = {"installed": installed, "running": False, "models": [], "error": None}
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{OLLAMA_HOST}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                result["running"] = True
                result["models"] = [
                    {
                        "name": m.get("name"),
                        "size_gb": round(m.get("size", 0) / (1024**3), 2) if m.get("size") else None,
                        "modified": m.get("modified_at"),
                        "provider": "ollama",
                        "status": "AVAILABLE",
                    }
                    for m in data.get("models", [])
                ]
        except httpx.ConnectError:
            result["error"] = (
                "Ollama was not detected on this device." if not installed
                else "Ollama is installed but its local server is unavailable."
            )
        except httpx.HTTPError as e:
            result["error"] = f"Local AI connection failed: {e}"
        return result

    async def _ensure_model(self, model: str):
        st = await self.status()
        if not st["installed"]:
            raise ProviderNotInstalled()
        if not st["running"]:
            raise ProviderNotRunning()
        names = [m["name"] for m in st["models"]]
        if model not in names:
            raise ModelNotFound(f"'{model}' not in installed Ollama models: {names}")

    async def stream_chat(self, model: str, messages: list, options: dict):
        await self._ensure_model(model)
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {
                k: v for k, v in {
                    "temperature": options.get("temperature"),
                    "num_ctx": options.get("context_length"),
                }.items() if v is not None
            },
        }
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(options.get("timeout", 120), connect=5.0)) as client:
                async with client.stream("POST", f"{OLLAMA_HOST}/api/chat", json=payload) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        raise ConnectionFailed(f"Ollama returned HTTP {resp.status_code}: {body[:300]}")
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        import json as _json
                        try:
                            obj = _json.loads(line)
                        except ValueError:
                            continue
                        if obj.get("done"):
                            elapsed = time.monotonic() - start
                            eval_count = obj.get("eval_count")
                            eval_duration_ns = obj.get("eval_duration")
                            tokens_per_sec = None
                            if eval_count and eval_duration_ns:
                                tokens_per_sec = round(eval_count / (eval_duration_ns / 1e9), 2)
                            yield {
                                "type": "done",
                                "elapsed_sec": round(elapsed, 2),
                                "eval_count": eval_count,
                                "tokens_per_sec": tokens_per_sec,
                            }
                            return
                        msg = obj.get("message", {})
                        content = msg.get("content", "")
                        if content:
                            yield {"type": "chunk", "text": content}
        except httpx.ConnectError:
            raise ConnectionFailed("Local AI connection failed (Ollama server unreachable).")
        except httpx.ReadTimeout:
            from ai.errors import GenerationTimeout
            raise GenerationTimeout()
