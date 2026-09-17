"""Create the initial Stark Costing schema.

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-09-17
"""

import importlib.util
from pathlib import Path


revision = "001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def _load_schema_snapshot():
    """Load the immutable SQL snapshot kept beside this revision."""
    snapshot_path = Path(__file__).resolve().parents[1] / "initial_schema_snapshot.py"
    spec = importlib.util.spec_from_file_location("initial_schema_snapshot", snapshot_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the initial schema snapshot")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def upgrade() -> None:
    _load_schema_snapshot().init_db()


def downgrade() -> None:
    raise NotImplementedError(
        "The initial schema migration cannot be safely downgraded automatically. "
        "Restore a database backup instead."
    )
