import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", 5432),
        dbname=os.getenv("DB_NAME", "stark_ai_costing"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD",""),
    )

def dict_cursor(conn):
    return conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    )
