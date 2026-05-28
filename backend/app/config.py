from dotenv import load_dotenv
import os

load_dotenv()

APP_NAME = os.getenv("APP_NAME", "My App")
APP_VERSION = os.getenv("APP_VERSION", "0.0.1")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")