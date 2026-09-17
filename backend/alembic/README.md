# Database migrations

Alembic is the authoritative record of database schema changes. The application
continues to use `psycopg2` for queries; SQLAlchemy is used here only by Alembic.

Run commands from `backend/`. Use the project wrapper rather than
`python -m alembic`: the local `alembic/` folder would shadow that Python module.

```powershell
python -m app.migrate current
python -m app.migrate upgrade head
```

Create a new revision with the installed `alembic` command-line program:

```powershell
alembic revision -m "describe the schema change"
```

Write `upgrade()` and, when it is safe, `downgrade()` in every new revision under
`alembic/versions/`. Do not edit a revision after it has been deployed.

## Writing new migrations

`001_initial_schema` is a baseline for the schema that existed before Alembic was
introduced. Leave it unchanged. Starting with revision `002`, use explicit Alembic
operations for each database change:

```python
from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column(
        "suppliers",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
    )


def downgrade() -> None:
    op.drop_column("suppliers", "status")
```

Use `op.create_table()`, `op.add_column()`, `op.create_index()`, and related
operations for normal schema changes. Use `op.execute()` only for PostgreSQL-
specific SQL or data backfills that cannot be expressed with those helpers.

Each migration should cover one focused, reviewable change. Do not add new schema
changes to `app/database/schema.py` or `initial_schema_snapshot.py`.

`001_initial_schema` is a frozen snapshot of the schema that existed when Alembic
was introduced. For an existing database already at that schema, register the
baseline without executing it:

```powershell
python -m app.migrate stamp 001_initial_schema
```

When using Docker Compose, `DB_HOST=db` is only resolvable from inside the
Compose network. Start PostgreSQL, then run the command inside a temporary
backend container instead of from the host shell:

```bash
docker compose up -d db
docker compose run --build --rm backend python -m app.migrate stamp 001_initial_schema
```

For a host-shell command, set `DB_HOST` to a reachable PostgreSQL hostname and
ensure its port is published by Docker or otherwise reachable from that host.

Back up the database before applying a migration in production. A fresh database
uses `python -m app.migrate upgrade head`, which creates the complete initial schema.
