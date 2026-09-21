"""Add inventory period snapshots table.

Revision ID: 003_inv_period_snapshots
Revises: 002_add_waste_records
"""

from alembic import op


"""Add inventory period snapshots table.

Revision ID: 003_inv_period_snapshots
Revises: 002_add_waste_records
"""

from alembic import op


revision = "003_inv_period_snapshots"   # 24 chars, under the 32 limit
down_revision = "002_add_waste_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS inventory_period_snapshots (
            id              SERIAL PRIMARY KEY,
            company_id      INTEGER NOT NULL REFERENCES companies(id),
            branch_id       INTEGER NOT NULL REFERENCES branches(id),
            period_label    VARCHAR(50) NOT NULL,
            entry_date      DATE NOT NULL,
            opening_value   NUMERIC(18,2) NOT NULL DEFAULT 0,
            purchases_value NUMERIC(18,2) NOT NULL DEFAULT 0,
            closing_value   NUMERIC(18,2) NOT NULL DEFAULT 0,
            cogs            NUMERIC(18,2) NOT NULL DEFAULT 0,
            locked_by       VARCHAR(100) DEFAULT '',
            notes           TEXT DEFAULT '',
            created_by      INTEGER REFERENCES app_users(id),
            locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (company_id, branch_id, period_label)
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS inventory_period_snapshots;
    """)