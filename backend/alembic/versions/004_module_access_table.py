"""Add modules and company_module_access tables.

Revision ID: 004_company_module_access
Revises: 003_inv_period_snapshots
"""

from alembic import op


revision = "004_company_module_access"
down_revision = "003_inv_period_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Central catalog of available modules
    op.execute("""
        CREATE TABLE IF NOT EXISTS modules (
            id              SERIAL PRIMARY KEY,
            module_key      VARCHAR(50) NOT NULL UNIQUE,
            display_name    VARCHAR(100) NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    op.execute("""
        INSERT INTO modules (module_key, display_name) VALUES
            ('inventory', 'Inventory'),
            ('procurement', 'Procurement'),
            ('costing', 'Costing'),
            ('finance', 'Finance'),
            ('governance', 'Governance'),
            ('masters', 'Masters'),
            ('reports', 'Reports'),
            ('system_logs', 'System Logs')
        ON CONFLICT (module_key) DO NOTHING;
    """)

    # Per-company entitlements, FK'd to modules instead of free text
    op.execute("""
        CREATE TABLE IF NOT EXISTS company_module_access (
            id              SERIAL PRIMARY KEY,
            company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            module_id       INTEGER NOT NULL REFERENCES modules(id) ON DELETE RESTRICT,
            is_enabled      BOOLEAN NOT NULL DEFAULT true,
            enabled_by      INTEGER REFERENCES app_users(id),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (company_id, module_id)
        );
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_company_module_access_company ON company_module_access(company_id);")

    # Trigger to auto-update updated_at on any row change
    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_company_module_access_updated_at
        BEFORE UPDATE ON company_module_access
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_company_module_access_updated_at ON company_module_access;")
    op.execute("DROP TABLE IF EXISTS company_module_access;")
    op.execute("DROP TABLE IF EXISTS modules;")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at();")