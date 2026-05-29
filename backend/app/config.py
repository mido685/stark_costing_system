from dotenv import load_dotenv
import os
import json

load_dotenv()

# Read version from package.json (auto-updated by semantic-release)
def get_version():
    try:
        package_json_path = os.path.join(os.path.dirname(__file__), "../../package.json")
        with open(package_json_path, "r") as f:
            package = json.load(f)
            return package.get("version", "0.0.1")
    except Exception:
        return os.getenv("APP_VERSION", "0.0.1")

APP_NAME = os.getenv("APP_NAME", "My App")
APP_VERSION = get_version()
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")