"""DeveloperHCR v0.3 - ai/providers/base.py - provider abstraction."""

from abc import ABC, abstractmethod


class AIProvider(ABC):
    name = "base"

    @abstractmethod
    async def status(self) -> dict:
        """Returns {installed, running, models: [...], error}. Never fabricated."""
        raise NotImplementedError

    @abstractmethod
    async def stream_chat(self, model: str, messages: list, options: dict):
        """Async generator yielding dicts: {type: 'chunk'|'done'|'error', ...}"""
        raise NotImplementedError
        yield  # pragma: no cover - makes this a generator function
