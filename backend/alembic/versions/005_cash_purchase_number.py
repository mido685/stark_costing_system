"""Add business number and sequence for cash purchases.

Revision ID: 005_cash_purchase_number
Revises: 004_company_module_access
"""

from alembic import op


revision = "005_cash_purchase_number"
down_revision = "004_company_module_access"

branch_labels = None
depends_on = None


def upgrade() -> None:

    # ---------------------------------------------------------
    # 1. Add company-local business number to cash purchases
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE cash_purchases
        ADD COLUMN IF NOT EXISTS cash_purchase_number INTEGER;
    """)

    # ---------------------------------------------------------
    # 2. Backfill existing cash purchases
    #    Each company starts from 1.
    # ---------------------------------------------------------
    op.execute("""
        WITH numbered AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY company_id
                    ORDER BY created_at, id
                ) AS number
            FROM cash_purchases
        )
        UPDATE cash_purchases cp
        SET cash_purchase_number = numbered.number
        FROM numbered
        WHERE cp.id = numbered.id
          AND cp.cash_purchase_number IS NULL;
    """)

    # ---------------------------------------------------------
    # 3. Business number is required
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE cash_purchases
        ALTER COLUMN cash_purchase_number SET NOT NULL;
    """)

    # ---------------------------------------------------------
    # 4. Each company must have unique cash purchase numbers
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE cash_purchases
        ADD CONSTRAINT uq_cash_purchases_company_number
        UNIQUE (company_id, cash_purchase_number);
    """)

    # ---------------------------------------------------------
    # 5. Sequence table
    #    Keeps the next number safe under concurrent requests.
    # ---------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS company_cash_purchase_sequences (
            company_id  INTEGER PRIMARY KEY
                REFERENCES companies(id) ON DELETE CASCADE,

            last_number INTEGER NOT NULL DEFAULT 0
        );
    """)

    # ---------------------------------------------------------
    # 6. Initialize sequence from existing data
    # ---------------------------------------------------------
    op.execute("""
        INSERT INTO company_cash_purchase_sequences (
            company_id,
            last_number
        )
        SELECT
            company_id,
            MAX(cash_purchase_number)
        FROM cash_purchases
        GROUP BY company_id
        ON CONFLICT (company_id) DO UPDATE
        SET last_number =
            GREATEST(
                company_cash_purchase_sequences.last_number,
                EXCLUDED.last_number
            );
    """)


def downgrade() -> None:

    # Remove sequence table
    op.execute("""
        DROP TABLE IF EXISTS company_cash_purchase_sequences;
    """)

    # Remove unique constraint
    op.execute("""
        ALTER TABLE cash_purchases
        DROP CONSTRAINT IF EXISTS uq_cash_purchases_company_number;
    """)

    # Remove business number
    op.execute("""
        ALTER TABLE cash_purchases
        DROP COLUMN IF EXISTS cash_purchase_number;
    """)