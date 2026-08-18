"""DeveloperHCR v0.3 - ai/manager.py - single entry point over all providers."""

from ai.providers.gguf import GGUFProvider
from ai.providers.ollama import OllamaProvider

PROVIDERS = {
    "ollama": OllamaProvider(),
    "gguf": GGUFProvider(),
}


async def full_status():
    result = {}
    for name, provider in PROVIDERS.items():
        result[name] = await provider.status()
    return result


def get_provider(name: str):
    provider = PROVIDERS.get(name)
    if not provider:
        raise ValueError(f"Unknown provider: {name}")
    return provider
