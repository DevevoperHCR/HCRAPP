"""DeveloperHCR configuration helpers (v0.4, additive)."""
import json
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("HCR_DATA_DIR", str(Path.home() / ".developerhcr" / "data"))).expanduser()
SETTINGS_FILE = DATA_DIR / "settings.json"
DEFAULT_SETTINGS = {
    "theme": "dark",
    "language": "en",
    "ai_default_provider": "ollama",
    "ai_default_model": "",
    "ai_temperature": 0.7,
    "ai_context_length": 2048,
    "ai_max_history_messages": 20,
    "ai_generation_timeout": 120,
    "ai_streaming": True,
    "ai_system_prompt": "You are DeveloperHCR AI Agent, a helpful local assistant. Be concise and honest.",
    "ai_model_dirs": [],
    "ai_gguf_directories": [],
    "assistant_name": "HCR AI Agent",
    "desktop_orientation": "landscape",
    "force_landscape_rotate": True,
    "show_desktop_icons": True,
    "sound_enabled": True,
    "sound_volume": 0.45,
    "jarvis_auto_run_safe_voice": True,
    "jarvis_persistent_action_log": True,
    "jarvis_screen_recording": False,
    "jarvis_training_capture_local_only": True,
    "jarvis_animation": True,
    "jarvis_show_ai_runtimes": True,
    "jarvis_one_time_safe_authorization": True,
    "friends_only_enabled": True,
    "subscription_enabled": True,
    "subscription_whatsapp_confirmation": True,
    "friends_subscription_mode": "friends_or_subscription",
    "exe_support_enabled": True,
    "store_enabled": True,
    "store_index_url": "",
    "devapps_repository_url": "https://github.com/DevevoperHCR/Devapps",
    "devapps_repository_api": "https://api.github.com/repos/DevevoperHCR/Devapps/contents",
    "ultra_max_enabled": True,
    "performance_mode": "balanced",
    "update_enabled": True,
    "update_repo_owner": "DevevoperHCR",
    "update_repo_name": "HCRAPP",
    "update_channel": "beta",
    "update_auto_check": True,
    "startup_file_checkup_enabled": False,
    "startup_file_checkup_timeout_seconds": 20,
    "admin_sync_enabled": True,
    "admin_sync_endpoint": "",
    "admin_sync_include_diagnostics": True,
    "whatsapp_channel": "",
    "whatsapp_group": "",
    "support_email": "developerhcr@gmail.com",
    "support_instagram": "https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw",
    "subscription_plans": [
        {"id":"FREE","price_inr":0,"label":"Free","features":["notes","calculator","games","basic_ai"]},
        {"id":"RUPEE_1","price_inr":1,"label":"₹1","features":["notes","calculator","games","browser","basic_ai","store"]},
        {"id":"RUPEE_10","price_inr":10,"label":"₹10","features":["all_basic","browser","ai_models","store","feedback","support"]},
        {"id":"RUPEE_100","price_inr":100,"label":"₹100","features":["all"]}
    ],
    "future_subscription_prices_inr": [500,1000,5000],
}


def load_settings():
    DATA_DIR.mkdir(exist_ok=True)
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    merged = dict(DEFAULT_SETTINGS)
    merged.update(data)
    # v2.0 support policy: no WhatsApp support. Clear legacy/default WhatsApp destinations.
    merged["whatsapp_channel"] = ""
    merged["whatsapp_group"] = ""
    merged["support_email"] = "developerhcr@gmail.com"
    merged["support_instagram"] = "https://www.instagram.com/developerhcr?igsh=MW8wZ2M2MHk0MDAw"
    return merged


def save_settings(data):
    DATA_DIR.mkdir(exist_ok=True)
    merged = dict(DEFAULT_SETTINGS)
    merged.update(data if isinstance(data, dict) else {})
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SETTINGS_FILE)
    return merged
