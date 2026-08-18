"""DeveloperHCR v0.3 - ai/errors.py - typed AI errors for clear messages."""


class AIError(Exception):
    """Base class. `user_message` is what's safe to show non-developers."""
    user_message = "An AI error occurred."


class ProviderNotInstalled(AIError):
    user_message = "This AI provider was not detected on this device."


class ProviderNotRunning(AIError):
    user_message = "The provider is installed but its local server is unavailable."


class ModelNotFound(AIError):
    user_message = "The selected model is no longer available."


class RuntimeMissing(AIError):
    user_message = "A compatible runtime is required for this model but was not found."


class ConnectionFailed(AIError):
    user_message = "Local AI connection failed."


class GenerationTimeout(AIError):
    user_message = "The AI did not respond in time and generation was stopped."


class InputTooLarge(AIError):
    user_message = "The message is too large to send."
