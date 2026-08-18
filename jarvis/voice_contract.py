from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class VoiceState:
    state: str
    text: str = ""
    error: str = ""

STATES = ("IDLE", "LISTENING", "PROCESSING", "TRANSCRIBING", "SENDING", "SPEAKING", "COMPLETE", "ERROR")

def transition(state: str, next_state: str) -> VoiceState:
    if next_state not in STATES:
        raise ValueError("Unsupported voice state")
    return VoiceState(next_state)
