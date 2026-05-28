"""
Entry point — import the app factory and expose `application` for uvicorn.

Run with:
    uvicorn main:app --reload --port 8085
"""

from app.application import create_app

app = create_app()