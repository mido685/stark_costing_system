"""Add waste records table.

Revision ID: 002_add_waste_records
Revises: 001_initial_schema
"""

from alembic import op


revision = "002_add_waste_records"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS waste_records (
            id SERIAL PRIMARY KEY,

            branch_id INTEGER NOT NULL
                REFERENCES branches(id),

            ingredient_id INTEGER NOT NULL
                REFERENCES ingredients(id),

            entry_date DATE NOT NULL,

            quantity NUMERIC(14,3) NOT NULL
                CHECK (quantity > 0),

            unit_cost NUMERIC(14,4) NOT NULL
                DEFAULT 0
                CHECK (unit_cost >= 0),

            waste_reason VARCHAR(100) NOT NULL,

            notes TEXT,

            created_by INTEGER
                REFERENCES app_users(id),

            created_at TIMESTAMPTZ NOT NULL
                DEFAULT NOW()
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS waste_records;
    """)