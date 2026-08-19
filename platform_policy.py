"""Platform policy for the single HCR launcher entry point."""
import os, platform, sys

def is_termux():
    exe=str(sys.executable).lower(); plat=platform.platform().lower()
    return sys.platform=="android" or "com.termux" in exe or "linux-android" in plat

def profile():
    if is_termux(): return "android"
    if platform.system()=="Windows": return "windows"
    if platform.system()=="Darwin": return "macos"
    if platform.system()=="Linux": return "linux"
    return "generic"

def native_shell_preferred():
    return profile() in {"windows","linux","macos"}
