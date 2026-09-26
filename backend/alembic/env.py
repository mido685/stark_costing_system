"""Alembic environment configured from the same DB_* variables as the app."""

from logging.config import fileConfig
import os
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import URL


config = context.config

if config.config_file_name:
    fileConfig(config.config_file_name)

backend_dir = Path(__file__).resolve().parents[1]
load_dotenv(backend_dir / "app" / ".env")

database_url = os.getenv("DATABASE_URL")
if database_url:
    # Support older PostgreSQL URL formats.
    if database_url.startswith("postgres://"):
        database_url = database_url.replace(
            "postgres://",
            "postgresql://",
            1,
        )
else:
    database_url = URL.create(
        "postgresql+psycopg2",
        username=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", ""),
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "stark_ai_costing"),
    ).render_as_string(hide_password=False)

config.set_main_option(
    "sqlalchemy.url",
    database_url.replace("%", "%%"),
)

# The application currently uses hand-written psycopg2 SQL rather than ORM models.
# Revisions are therefore authored explicitly, not generated from model metadata.
target_metadata = None


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
