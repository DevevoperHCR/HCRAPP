"""Jarvis core: offline-first voice I/O, screen capture, safe controls.

Design rule: no unrestricted shell. Commands are classified; dangerous/unknown
shell-like requests are previewed/blocked rather than executed.
"""
import io, os, platform, re, shutil, subprocess, sys, tempfile, time, webbrowser
from pathlib import Path

BASE_DIR=Path(__file__).resolve().parent.parent
DATA_DIR=BASE_DIR/'data'/'jarvis'
SCREEN_DIR=DATA_DIR/'screens'
SCREEN_DIR.mkdir(parents=True, exist_ok=True)

DANGEROUS_RE=re.compile(r"\b(rm|del|erase|format|mkfs|shutdown|reboot|poweroff|diskpart|reg\s+delete|iptables|netsh\s+firewall|chmod\s+777|chown|dd\s+if=|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|sudo|su\s|passwd|useradd|userdel)\b", re.I)
SHELL_META_RE=re.compile(r"[;&|`$<>]|\$\(|\\x00")

SAFE_ACTIONS={
    'volume_up','volume_down','volume_mute','brightness_up','brightness_down',
    'lock_screen','open_calculator','open_terminal','open_browser','open_url'
}

def command_preview(text:str)->dict:
    text=(text or '').strip()
    if not text: return {'class':'EMPTY','allowed':False,'reason':'empty command'}
    if DANGEROUS_RE.search(text) or SHELL_META_RE.search(text):
        return {'class':'DANGEROUS','allowed':False,'reason':'Potentially destructive or shell-injection command. Preview only; never executed by Jarvis.', 'input':text}
    if text.lower().startswith('jarvis:'):
        text=text.split(':',1)[1].strip()
    action=text.lower().replace(' ','_')
    if action in SAFE_ACTIONS:
        return {'class':'SAFE_ACTION','allowed':True,'action':action,'input':text}
    return {'class':'UNKNOWN','allowed':False,'reason':'Not in Jarvis safe action allowlist. No shell execution is performed.', 'input':text}

def _launch(cmd):
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False

def perform_action(action, value=None):
    action=(action or '').lower()
    if action not in SAFE_ACTIONS:
        return {'ok':False,'executed':False,'error':'Action not allowlisted'}
    system=platform.system()
    try:
        if action=='open_browser':
            webbrowser.open('about:blank' if system=='Windows' else 'https://example.com')
        elif action=='open_url':
            url=str(value or '').strip()
            if not re.match(r'^https?://',url,re.I): return {'ok':False,'executed':False,'error':'Only http(s) URLs are allowed'}
            webbrowser.open(url)
        elif action=='open_calculator':
            if system=='Windows': _launch(['calc.exe'])
            elif system=='Darwin': _launch(['open','-a','Calculator'])
            else: _launch(['gnome-calculator']) or _launch(['kcalc'])
        elif action=='open_terminal':
            if system=='Windows': _launch(['cmd.exe'])
            elif system=='Darwin': _launch(['open','-a','Terminal'])
            else: _launch(['x-terminal-emulator']) or _launch(['gnome-terminal'])
        elif action=='lock_screen':
            if system=='Windows': _launch(['rundll32.exe','user32.dll,LockWorkStation'])
            elif system=='Darwin': _launch(['/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession','-suspend'])
            else: _launch(['loginctl','lock-session']) or _launch(['xdg-screensaver','lock'])
        elif action.startswith('volume_'):
            # Prefer OS-native utilities; no shell strings.
            if system=='Windows':
                return {'ok':False,'executed':False,'error':'Windows volume control requires optional audio backend; use browser/system controls.'}
            if shutil.which('pactl'):
                if action=='volume_mute': _launch(['pactl','set-sink-mute','@DEFAULT_SINK@','toggle'])
                else: _launch(['pactl','set-sink-volume','@DEFAULT_SINK@','+5%' if action=='volume_up' else '-5%'])
            else: return {'ok':False,'executed':False,'error':'pactl not available'}
        elif action.startswith('brightness_'):
            try:
                import screen_brightness_control as sbc
                cur=sbc.get_brightness(display=0)[0]
                delta=10 if action=='brightness_up' else -10
                sbc.set_brightness(max(0,min(100,cur+delta)), display=0)
            except ImportError: return {'ok':False,'executed':False,'error':'Install optional screen-brightness-control for brightness control.'}
        return {'ok':True,'executed':True,'action':action}
    except Exception as e:
        return {'ok':False,'executed':False,'error':str(e),'action':action}

def capture_screen():
    path=SCREEN_DIR/f'screen_{int(time.time()*1000)}.png'
    try:
        from mss import mss
        from PIL import Image
        with mss() as sct:
            shot=sct.grab(sct.monitors[0])
            Image.frombytes('RGB', shot.size, shot.rgb).save(path)
        return path
    except ImportError:
        try:
            import pyautogui
            pyautogui.screenshot().save(path)
            return path
        except ImportError as e: raise RuntimeError('Install optional mss + pillow (or pyautogui) for screen capture.') from e

def record_offline(duration=5, samplerate=16000):
    try:
        import sounddevice as sd
        import numpy as np
    except ImportError as e: raise RuntimeError('Offline microphone requires optional sounddevice + numpy.') from e
    duration=max(1,min(10,int(duration)))
    audio=sd.rec(int(duration*samplerate), samplerate=samplerate, channels=1, dtype='int16')
    sd.wait()
    return audio.tobytes(), samplerate

def transcribe_offline(audio_bytes, samplerate=16000):
    try:
        from vosk import Model, KaldiRecognizer
    except ImportError as e: raise RuntimeError('Offline STT requires optional vosk and a local Vosk model.') from e
    model_path=os.environ.get('JARVIS_VOSK_MODEL') or str(DATA_DIR/'vosk-model')
    if not Path(model_path).exists():
        raise RuntimeError(f'Vosk model not found at {model_path}. Set JARVIS_VOSK_MODEL or place a model there.')
    rec=KaldiRecognizer(Model(model_path), samplerate)
    rec.AcceptWaveform(audio_bytes)
    import json
    result=json.loads(rec.FinalResult())
    return (result.get('text') or '').strip()

def speak(text):
    text=(text or '').strip()
    if not text: return {'ok':False,'error':'empty text'}
    try:
        import pyttsx3
        engine=pyttsx3.init()
        engine.say(text)
        engine.runAndWait()
        engine.stop()
        return {'ok':True,'spoken':True,'engine':'pyttsx3'}
    except ImportError:
        return {'ok':False,'spoken':False,'error':'Install optional pyttsx3 for offline TTS.'}
    except Exception as e:
        return {'ok':False,'spoken':False,'error':str(e)}

def system_snapshot(psutil=None):
    out={'platform':platform.platform(),'os':platform.system(),'release':platform.release(),'arch':platform.machine(),'python':platform.python_version(),'hostname':platform.node()}
    if psutil:
        out['cpu']={'percent':psutil.cpu_percent(interval=0.05),'cores':psutil.cpu_count(logical=True),'frequency_mhz':getattr(psutil.cpu_freq(),'current',None)}
        vm=psutil.virtual_memory(); out['memory']={'total_gb':round(vm.total/2**30,2),'available_gb':round(vm.available/2**30,2),'used_percent':vm.percent}
        out['boot_time']=psutil.boot_time()
        out['battery']=None
        try:
            b=psutil.sensors_battery()
            if b: out['battery']={'percent':b.percent,'plugged':b.power_plugged}
        except Exception: pass
        disks=[]
        for p in psutil.disk_partitions(all=False):
            try:
                u=psutil.disk_usage(p.mountpoint); disks.append({'mount':p.mountpoint,'total_gb':round(u.total/2**30,2),'free_gb':round(u.free/2**30,2),'used_percent':u.percent})
            except Exception: pass
        out['disks']=disks
        out['network_interfaces']=list(psutil.net_if_addrs().keys())
        out['process_count']=len(list(psutil.process_iter(['pid'])))
    return out


# v0.8 Level 8: persistent full-screen training capture (explicit user toggle).
RECORD_DIR=DATA_DIR/'recordings'
RECORD_DIR.mkdir(parents=True, exist_ok=True)
_RECORD_STATE={"running":False,"path":None,"started_at":None,"thread":None,"stop":None}

def recording_status():
    return {k:v for k,v in _RECORD_STATE.items() if k not in ("thread","stop")}

def start_screen_recording(fps=4, quality="medium", size="full"):
    if _RECORD_STATE.get("running"):
        return {"ok":True,"running":True,"path":_RECORD_STATE.get("path"),"already_running":True}
    try:
        from mss import mss
        from PIL import Image
    except ImportError as e:
        raise RuntimeError("Screen recording requires optional mss + pillow.") from e
    import threading, time as _time
    quality = quality if quality in ("low","medium","high") else "medium"
    size = size if size in ("full","1080p","720p","window") else "full"
    jpeg_quality = {"low":55,"medium":75,"high":90}[quality]
    out=RECORD_DIR/f"training_{int(_time.time())}"
    out.mkdir(parents=True, exist_ok=True)
    stop=threading.Event()
    _RECORD_STATE.update({"running":True,"path":str(out),"started_at":_time.time(),"stop":stop,"quality":quality,"size":size,"fps":fps})
    def worker():
        i=0
        interval=1/max(1,min(15,int(fps)))
        try:
            with mss() as sct:
                while not stop.is_set():
                    shot=sct.grab(sct.monitors[0])
                    image=Image.frombytes("RGB", shot.size, shot.rgb)
                    if size == "1080p": image.thumbnail((1920,1080))
                    elif size == "720p": image.thumbnail((1280,720))
                    image.save(out/f"frame_{i:06d}.jpg", quality=jpeg_quality, optimize=True)
                    i+=1
                    stop.wait(interval)
        finally:
            _RECORD_STATE["running"]=False
            _RECORD_STATE["stop"]=None
    t=threading.Thread(target=worker, daemon=True, name="DeveloperHCR-ScreenRecorder")
    _RECORD_STATE["thread"]=t; t.start()
    return {"ok":True,"running":True,"path":str(out),"started_at":_RECORD_STATE["started_at"],"frames_format":"JPEG sequence","quality":quality,"size":size,"fps":fps,"local_only":True}

def stop_screen_recording():
    if not _RECORD_STATE.get("running"):
        return {"ok":True,"running":False,"path":_RECORD_STATE.get("path"),"already_stopped":True}
    _RECORD_STATE["stop"].set()
    t=_RECORD_STATE.get("thread")
    if t: t.join(timeout=2)
    return {"ok":True,"running":False,"path":_RECORD_STATE.get("path"),"local_only":True}
