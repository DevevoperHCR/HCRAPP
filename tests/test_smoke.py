import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def test_config_defaults():
    from config import load_settings
    data = load_settings()
    assert data["ai_default_provider"] == "ollama"
    assert isinstance(data["ai_model_dirs"], list)

def test_model_detection_is_honest():
    from backend.ai_models import detect_gguf
    result = detect_gguf()
    assert isinstance(result, list)
    for item in result:
        assert item["name"].lower().endswith(".gguf")
        assert Path(item["path"]).exists()

def test_server_import_and_routes():
    import server
    routes = {getattr(r, "path", "") for r in server.app.routes}
    assert "/api/health" in routes
    assert "/api/diagnostics" in routes
    assert "/api/ai/chat/stream" in routes

def test_jarvis_command_safety():
    from jarvis.core import command_preview
    assert command_preview('open calculator')['allowed'] is True
    assert command_preview('rm -rf /')['allowed'] is False
    assert command_preview('sudo reboot')['class'] == 'DANGEROUS'
    assert command_preview('echo hello')['class'] == 'UNKNOWN'

def test_jarvis_routes_exist():
    import server
    routes = {getattr(r, 'path', '') for r in server.app.routes}
    for path in ('/api/jarvis/status','/api/jarvis/system','/api/jarvis/command/preview','/api/jarvis/action','/api/jarvis/screen','/api/jarvis/listen','/api/jarvis/speak','/api/jarvis/ask'):
        assert path in routes
