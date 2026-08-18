from __future__ import annotations
import re
BLOCKED = [r"\brm\s+-rf\b", r"\bformat\b", r"\bmkfs\b", r"\bshutdown\b", r"\breboot\b", r"\bpoweroff\b", r"\bdel\s+/[fq]\b", r"\breg\s+delete\b", r"\bdd\s+if=", r"\bsudo\b", r"\bsu\s+-?\b"]
SHELL_META = ["&&", "||", ";", "|", "`", "$(", ">", "<"]
def classify(command):
    c = command.strip(); low = c.lower()
    if not c: return "EMPTY"
    if any(re.search(p, low) for p in BLOCKED): return "BLOCKED"
    if any(x in c for x in SHELL_META): return "REQUIRES_CONFIRMATION"
    return "SAFE_OR_UNSUPPORTED"
def can_execute(command): return classify(command) == "SAFE_OR_UNSUPPORTED"
