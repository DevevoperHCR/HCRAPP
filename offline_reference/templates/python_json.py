import json
from pathlib import Path
data={"app":"DeveloperHCR","version":"2.0-beta"}
Path("data.json").write_text(json.dumps(data,indent=2),encoding="utf-8")
print(data)
