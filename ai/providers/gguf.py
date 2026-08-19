"""
DeveloperHCR v0.3.1 - ai/providers/gguf.py

Real GGUF chat via llama-cpp-python, when installed. If the runtime is
missing, this reports that honestly (RuntimeMissing) rather than
pretending a .gguf file is directly executable.

llama-cpp-python's streaming API is a synchronous generator, so
generation runs in a background thread; chunks are bridged to the async
world through a plain queue.Queue (thread-safe) that the async side
polls via asyncio.to_thread. A threading.Event (options["stop_event"])
lets the caller cooperatively cancel generation early - without it,
Stop would only stop the browser from *displaying* further output while
the background thread kept computing.
"""

import asyncio
import importlib.util
import queue
import threading
import time

from ai.errors import ModelNotFound, RuntimeMissing
from ai.providers.base import AIProvider
from backend.ai_models import detect_gguf

# Cache loaded Llama instances by model path so we don't reload per message.
_LOADED_MODELS = {}
_SENTINEL = object()


def _llama_cpp_available():
    return importlib.util.find_spec("llama_cpp") is not None


class GGUFProvider(AIProvider):
    name = "gguf"

    async def status(self) -> dict:
        files = detect_gguf()
        runtime_ok = _llama_cpp_available()
        return {
            "installed": runtime_ok,
            "running": runtime_ok,
            "models": [
                {
                    "name": f["name"],
                    "path": f["path"],
                    "size_gb": f["size_gb"],
                    "provider": "gguf",
                    "status": "AVAILABLE" if runtime_ok else "UNAVAILABLE",
                }
                for f in files
            ],
            "error": None if runtime_ok else (
                "GGUF model(s) detected, but no compatible runtime (llama-cpp-python) is installed. "
                "Install it with: pip install llama-cpp-python"
            ),
        }

    def _load_sync(self, path: str, context_length: int):
        from llama_cpp import Llama
        if path not in _LOADED_MODELS:
            _LOADED_MODELS[path] = Llama(model_path=path, n_ctx=context_length or 2048, verbose=False)
        return _LOADED_MODELS[path]

    def _stream_worker(self, llm, messages, temperature, q: "queue.Queue", stop_event):
        try:
            start = time.monotonic()
            stream = llm.create_chat_completion(
                messages=messages,
                temperature=temperature if temperature is not None else 0.7,
                stream=True,
            )
            chunk_count = 0
            for piece in stream:
                if stop_event is not None and stop_event.is_set():
                    # Cooperative cancellation - stop pulling from the
                    # generator. llama.cpp has no hard interrupt, but this
                    # stops further work as soon as possible.
                    q.put(("stopped", None))
                    return
                delta = piece.get("choices", [{}])[0].get("delta", {}).get("content", "")
                if delta:
                    chunk_count += 1
                    q.put(("chunk", delta))
            elapsed = time.monotonic() - start
            # llama-cpp-python's streaming mode does not return an exact
            # token count/usage block - chunk_count approximates it
            # (each streamed piece here is one token in practice, but this
            # is not guaranteed by the API, so it's reported as approximate).
            q.put(("done", {"elapsed_sec": elapsed, "approx_tokens": chunk_count}))
        except Exception as e:
            q.put(("error", str(e)))
        finally:
            q.put((_SENTINEL, None))

    async def stream_chat(self, model: str, messages: list, options: dict):
        if not _llama_cpp_available():
            raise RuntimeMissing()
        files = detect_gguf()
        match = next((f for f in files if f["name"] == model or f["path"] == model), None)
        if not match:
            raise ModelNotFound(f"GGUF model '{model}' not found in scanned directories.")

        llm = await asyncio.to_thread(self._load_sync, match["path"], options.get("context_length"))

        q: "queue.Queue" = queue.Queue()
        stop_event = options.get("stop_event")
        thread = threading.Thread(
            target=self._stream_worker,
            args=(llm, messages, options.get("temperature"), q, stop_event),
            daemon=True,
        )
        thread.start()

        while True:
            kind, payload = await asyncio.to_thread(q.get)
            if kind is _SENTINEL:
                return
            if kind == "chunk":
                yield {"type": "chunk", "text": payload}
            elif kind == "stopped":
                return
            elif kind == "done":
                elapsed = payload["elapsed_sec"]
                tokens = payload["approx_tokens"]
                tps = round(tokens / elapsed, 2) if elapsed > 0 and tokens else None
                yield {
                    "type": "done",
                    "elapsed_sec": round(elapsed, 2),
                    "eval_count": tokens,
                    "tokens_per_sec": tps,
                    "tokens_approximate": True,
                }
            elif kind == "error":
                from ai.errors import AIError
                err = AIError(payload)
                err.user_message = f"GGUF generation failed: {payload}"
                raise err
