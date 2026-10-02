"""Add cancellation fields and cancelled status to purchases.

Revision ID: 006_purchase_cancellation

Revises: 005_cash_purchase_number
"""

from alembic import op


revision = "006_purchase_cancellation"

down_revision = "005_cash_purchase_number"

branch_labels = None

depends_on = None


def upgrade() -> None:

    # ---------------------------------------------------------
    # 1. Add cancellation reason
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE purchases
        ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
    """)

    # ---------------------------------------------------------
    # 2. Record who cancelled the PO
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE purchases
        ADD COLUMN IF NOT EXISTS cancelled_by INTEGER
            REFERENCES app_users(id);
    """)

    # ---------------------------------------------------------
    # 3. Record when the PO was cancelled
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE purchases
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    """)

    # ---------------------------------------------------------
    # 4. Allow 'cancelled' as a valid purchase status
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE purchases
        DROP CONSTRAINT IF EXISTS purchases_status_check;
    """)

    op.execute("""
        ALTER TABLE purchases
        ADD CONSTRAINT purchases_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
    """)


def downgrade() -> None:

    # ---------------------------------------------------------
    # 1. Restore original status constraint
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE purchases
        DROP CONSTRAINT IF EXISTS purchases_status_check;
    """)

    op.execute("""
        ALTER TABLE purchases
        ADD CONSTRAINT purchases_status_check
        CHECK (status IN ('pending', 'approved', 'rejected'));
    """)

    # ---------------------------------------------------------
    # 2. Remove cancellation fields
    # ---------------------------------------------------------
    op.execute("""
        ALTER TABLE purchases
        DROP COLUMN IF EXISTS cancelled_at;
    """)

    op.execute("""
        ALTER TABLE purchases
        DROP COLUMN IF EXISTS cancelled_by;
    """)

    op.execute("""
        ALTER TABLE purchases
        DROP COLUMN IF EXISTS cancellation_reason;
    """)