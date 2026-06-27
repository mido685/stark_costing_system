from .connection import get_connection, dict_cursor


def init_db() -> None:
    conn = None
    cur = None
    try:
        conn = get_connection()
        cur = dict_cursor(conn)

        # ── 1. Companies ──────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS companies (
                id           SERIAL PRIMARY KEY,
                name         VARCHAR(120) UNIQUE NOT NULL,
                slug         VARCHAR(80)  UNIQUE NOT NULL,
                logo_url     VARCHAR(500),
                plan         VARCHAR(20)  NOT NULL DEFAULT 'starter'
                    CHECK (plan IN ('starter','professional','enterprise')),
                is_active    BOOLEAN NOT NULL DEFAULT TRUE,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                max_branches INTEGER NOT NULL DEFAULT 5,
                max_users    INTEGER NOT NULL DEFAULT 10
            )
        """)

        # ── 2. Roles ──────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS roles (
                id          SERIAL PRIMARY KEY,
                company_id  INTEGER NOT NULL REFERENCES companies(id),
                name        VARCHAR(50) NOT NULL,
                description TEXT,
                is_active   BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, name)
            )
        """)

        # ── 3. Permissions ────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS permissions (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(100) NOT NULL UNIQUE,
                description TEXT
            )
        """)

        # ── 4. Role-Permissions ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS role_permissions (
                id            SERIAL PRIMARY KEY,
                role_id       INTEGER NOT NULL REFERENCES roles(id),
                permission_id INTEGER NOT NULL REFERENCES permissions(id),
                UNIQUE(role_id, permission_id)
            )
        """)

        # ── 5. Users ──────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS app_users (
                id            SERIAL PRIMARY KEY,
                company_id    INTEGER NOT NULL REFERENCES companies(id),
                username      VARCHAR(80) NOT NULL,
                display_name  VARCHAR(120) NOT NULL,
                role_id       INTEGER NOT NULL REFERENCES roles(id),
                password_hash TEXT    NOT NULL,
                is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, username)
            )
        """)

        # ── 6. User-Permissions ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_permissions (
                id            SERIAL PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES app_users(id),
                permission_id INTEGER NOT NULL REFERENCES permissions(id),
                is_allowed    BOOLEAN NOT NULL DEFAULT TRUE,
                UNIQUE(user_id, permission_id)
            )
        """)

        # ── 7. Branches ───────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS branches (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                name       VARCHAR(120) NOT NULL,
                location   VARCHAR(120),
                manager    VARCHAR(120),
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, name)
            )
        """)

        # ── 8. User-Branches ──────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_branches (
                id        SERIAL PRIMARY KEY,
                user_id   INTEGER NOT NULL REFERENCES app_users(id),
                branch_id INTEGER NOT NULL REFERENCES branches(id),
                UNIQUE(user_id, branch_id)
            )
        """)

        # ── 9. Products ───────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                name       VARCHAR(120) NOT NULL,
                unit       VARCHAR(40),
                sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                sku        VARCHAR(80),
                image_url  TEXT
            )
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS products_active_name_unique
                ON products (company_id, LOWER(name))
                WHERE is_active = TRUE
        """)

        # ── 10. SKU Prefixes ──────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sku_prefixes (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                label      VARCHAR(50) NOT NULL,
                prefix     VARCHAR(20) NOT NULL,
                item_type  VARCHAR(20) NOT NULL
                    CHECK (item_type IN ('raw_material','finished_good','both')),
                UNIQUE(company_id, prefix)
            )
        """)

        # ── 11. Suppliers ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suppliers (
                id                    SERIAL PRIMARY KEY,
                company_id            INTEGER NOT NULL REFERENCES companies(id),
                name                  VARCHAR(120) NOT NULL,
                contact               VARCHAR(120),
                phone                 VARCHAR(40),
                email                 VARCHAR(120),
                address               VARCHAR(200),
                website               VARCHAR(200),
                commercial_reg_number VARCHAR(100),
                agent_name            VARCHAR(120),
                agent_phone           VARCHAR(40),
                category              VARCHAR(80),
                notes                 TEXT,
                is_active             BOOLEAN NOT NULL DEFAULT TRUE,
                UNIQUE(company_id, name)
            )
        """)

        # ── 12. Ingredients ───────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ingredients (
                id            SERIAL PRIMARY KEY,
                company_id    INTEGER NOT NULL REFERENCES companies(id),
                name          VARCHAR(120) NOT NULL,
                unit          VARCHAR(40)  NOT NULL,
                cost_per_unit NUMERIC(12,4) NOT NULL DEFAULT 0,
                stock_qty     NUMERIC(12,3) NOT NULL DEFAULT 0,
                reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0,
                supplier_id   INTEGER REFERENCES suppliers(id),
                is_active     BOOLEAN NOT NULL DEFAULT TRUE,
                sku           VARCHAR(80),
                image_url     TEXT
            )
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS ingredients_active_name_unique
                ON ingredients (company_id, LOWER(name))
                WHERE is_active = TRUE
        """)

        # ── 13. Expense Categories ────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS expense_categories (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                name       VARCHAR(100) NOT NULL,
                type       VARCHAR(20)  NOT NULL
                    CHECK (type IN ('inventory','expense','asset','service')),
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, name)
            )
        """)

        # ── 14. Supplier Price History ────────────────────────────────────────
        # price_type controls whether a quote updates standard cost (initial_cost only).
        # All other types (market_price, contract_price, spot_price) are informational.
    
        # company_id is denormalized here for fast tenant-scoped queries.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS supplier_price_history (
                id            SERIAL PRIMARY KEY,
                company_id    INTEGER NOT NULL REFERENCES companies(id),
                supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                price         NUMERIC(12,4) NOT NULL CHECK (price > 0),
                price_type    VARCHAR(20) NOT NULL DEFAULT 'market_price'
                    CHECK (price_type IN ('initial_cost','market_price','contract_price','spot_price')),
                purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
                status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
                approved_by   INTEGER REFERENCES app_users(id),
                approved_at   TIMESTAMP,
                notes         TEXT
            )
        """)

        # ── 14b. Standard Cost History ────────────────────────────────────────
        # Immutable audit trail for every formal change to ingredients.cost_per_unit.
        # Written only via update_standard_cost() or initial_cost price entries.
        # Never written directly by market/contract/spot price recording.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS standard_cost_history (
                id             SERIAL PRIMARY KEY,
                company_id     INTEGER NOT NULL REFERENCES companies(id),
                ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
                old_cost       NUMERIC(12,4) NOT NULL,
                new_cost       NUMERIC(12,4) NOT NULL,
                effective_date DATE NOT NULL,
                approved_by    INTEGER REFERENCES app_users(id),
                notes          TEXT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 15. Recipes ───────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS recipes (
                id           SERIAL PRIMARY KEY,
                product_id   INTEGER NOT NULL UNIQUE REFERENCES products(id),
                yield_pct    NUMERIC(5,2)  NOT NULL DEFAULT 100,
                portion_size NUMERIC(10,3) NOT NULL DEFAULT 1,
                portion_unit VARCHAR(40)   NOT NULL DEFAULT 'plate',
                notes        TEXT
            )
        """)

        # ── 16. Recipe Ingredients ────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS recipe_ingredients (
                id            SERIAL PRIMARY KEY,
                recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                qty_required  NUMERIC(12,4) NOT NULL,
                UNIQUE(recipe_id, ingredient_id)
            )
        """)

        # ── 17. Purchases (PO) ────────────────────────────────────────────────
        # PO approval does NOT affect stock. Stock increases only via GRN (table 18).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchases (
                id             SERIAL PRIMARY KEY,
                company_id     INTEGER NOT NULL REFERENCES companies(id),
                branch_id      INTEGER NOT NULL REFERENCES branches(id),
                supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
                ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date     DATE    NOT NULL,
                quantity       NUMERIC(12,3) NOT NULL,
                unit_cost      NUMERIC(12,4) NOT NULL,
                gross_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
                tax_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                payable_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes          TEXT,
                status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
                created_by     INTEGER REFERENCES app_users(id),
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                po_number      INTEGER
            )
        """)

        # ── 17b. Per-company PO sequence tracker ─────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS company_po_sequences (
                company_id  INTEGER PRIMARY KEY REFERENCES companies(id),
                last_number INTEGER NOT NULL DEFAULT 0
            )
        """)

        # ── 17c. Purchase History (modification audit trail) ──────────────────
        # One row per edit on a PO — captures what changed, who changed it, and why.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_history (
                id            SERIAL PRIMARY KEY,
                purchase_id   INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
                company_id    INTEGER NOT NULL REFERENCES companies(id),
                changed_by    INTEGER NOT NULL REFERENCES app_users(id),
                changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                old_quantity  NUMERIC(12,3),
                new_quantity  NUMERIC(12,3),
                old_unit_cost NUMERIC(12,4),
                new_unit_cost NUMERIC(12,4),
                old_gross     NUMERIC(12,2),
                new_gross     NUMERIC(12,2),
                old_notes     TEXT,
                new_notes     TEXT,
                change_reason TEXT
            )
        """)

        # ── 18. Goods Receipts (GRN) ──────────────────────────────────────────
        # THIS is when stock physically arrives and inventory increases.
        # received_qty may differ from PO quantity (partial deliveries allowed).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS goods_receipts (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                purchase_id   INTEGER NOT NULL REFERENCES purchases(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                received_qty  NUMERIC(12,3) NOT NULL,
                unit_cost     NUMERIC(12,4) NOT NULL,
                notes         TEXT,
                created_by    INTEGER REFERENCES app_users(id),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 19. Purchase Returns ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_returns (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date    DATE    NOT NULL,
                quantity      NUMERIC(12,3) NOT NULL,
                unit_cost     NUMERIC(12,4) NOT NULL,
                refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes         TEXT,
                status        VARCHAR(20) NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('pending','approved','rejected')),
                created_by    INTEGER REFERENCES app_users(id),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 20. Stock Issues ──────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_issues (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                qty_issued    NUMERIC(12,3) NOT NULL,
                issued_to     VARCHAR(120),
                notes         TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 21. Stock Counts ──────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_counts (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                system_qty    NUMERIC(12,3) NOT NULL,
                counted_qty   NUMERIC(12,3) NOT NULL,
                delta         NUMERIC(12,3) NOT NULL,
                notes         TEXT,
                created_by    INTEGER REFERENCES app_users(id),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 22. Stock Adjustments ─────────────────────────────────────────────
        # Pending until approved. Inventory movement inserted only on approval.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_adjustments (
                id             SERIAL PRIMARY KEY,
                branch_id      INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date     DATE    NOT NULL DEFAULT CURRENT_DATE,
                quantity_delta NUMERIC(12,3) NOT NULL,
                notes          TEXT,
                status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
                approval_notes TEXT,
                created_by     INTEGER REFERENCES app_users(id),
                approved_by    INTEGER REFERENCES app_users(id),
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 23. Inventory Movements (ledger) ──────────────────────────────────
        # Append-only ledger. Stock balance = SUM(quantity_delta) per ingredient/branch.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventory_movements (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id   INTEGER NOT NULL REFERENCES ingredients(id),
                movement_type   VARCHAR(30) NOT NULL
                    CHECK (movement_type IN (
                        'opening_stock',
                        'grn',
                        'purchase_return',
                        'transfer_in',
                        'transfer_out',
                        'issue',
                        'waste',
                        'damage',
                        'adjustment',
                        'stock_count',
                        'customer_return'
                    )),
                entry_date      DATE    NOT NULL,
                quantity_delta  NUMERIC(12,3) NOT NULL,
                unit_cost       NUMERIC(12,4) NOT NULL DEFAULT 0,
                reference_table VARCHAR(80),
                reference_id    INTEGER,
                notes           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 24. Finished Goods Movements ──────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS finished_goods_movements (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                product_id      INTEGER NOT NULL REFERENCES products(id),
                movement_type   VARCHAR(30) NOT NULL
                    CHECK (movement_type IN (
                        'production','sale','customer_return','waste','damage',
                        'transfer_in','transfer_out','adjustment'
                    )),
                entry_date      DATE    NOT NULL,
                quantity_delta  NUMERIC(12,3) NOT NULL,
                unit_cost       NUMERIC(12,4) NOT NULL DEFAULT 0,
                reference_table VARCHAR(80),
                reference_id    INTEGER,
                notes           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 25. Transfers ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS transfers (
                id             SERIAL PRIMARY KEY,
                from_branch_id INTEGER NOT NULL REFERENCES branches(id),
                to_branch_id   INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date     DATE    NOT NULL,
                quantity       NUMERIC(12,3) NOT NULL,
                notes          TEXT,
                status         VARCHAR(20) NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('pending','approved','rejected')),
                created_by     INTEGER REFERENCES app_users(id),
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 26. Sales ─────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sales (
                id                SERIAL PRIMARY KEY,
                branch_id         INTEGER NOT NULL REFERENCES branches(id),
                product_id        INTEGER NOT NULL REFERENCES products(id),
                entry_date        DATE    NOT NULL,
                quantity          NUMERIC(12,3) NOT NULL,
                unit_price        NUMERIC(12,2) NOT NULL,
                gross_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
                discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
                promotion_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
                tax_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
                net_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
                payment_method    VARCHAR(20) NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','credit')),
                receivable_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes             TEXT,
                status            VARCHAR(20) NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('pending','approved','rejected')),
                created_by        INTEGER REFERENCES app_users(id),
                created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 27. Customer Returns ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS customer_returns (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                product_id    INTEGER NOT NULL REFERENCES products(id),
                entry_date    DATE    NOT NULL,
                quantity      NUMERIC(12,3) NOT NULL,
                refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes         TEXT,
                status        VARCHAR(20) NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('pending','approved','rejected')),
                created_by    INTEGER REFERENCES app_users(id),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 28. Waste Log ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS waste_log (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id INTEGER REFERENCES ingredients(id),
                product_id    INTEGER REFERENCES products(id),
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                quantity      NUMERIC(12,3) NOT NULL,
                reason        VARCHAR(60)   NOT NULL
                    CHECK (reason IN ('kitchen','expiry','overproduction',
                                      'customer_return','damage','other')),
                cost_value    NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes         TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 29. Damage Log ────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS damage_log (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id INTEGER REFERENCES ingredients(id),
                product_id    INTEGER REFERENCES products(id),
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                quantity      NUMERIC(12,3) NOT NULL,
                reason        VARCHAR(80)   NOT NULL DEFAULT 'damage',
                cost_value    NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes         TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 30. Revenues ──────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS revenues (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                product_id INTEGER REFERENCES products(id),
                entry_date DATE    NOT NULL,
                quantity   NUMERIC(12,3) NOT NULL DEFAULT 0,
                amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes      TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 31. Production Costs ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS production_costs (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                product_id    INTEGER NOT NULL REFERENCES products(id),
                entry_date    DATE    NOT NULL,
                quantity      NUMERIC(12,3) NOT NULL DEFAULT 0,
                material_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
                labor_cost    NUMERIC(12,2) NOT NULL DEFAULT 0,
                overhead_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes         TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 32. Expenses ──────────────────────────────────────────────────────
        # NOTE: `category` (text) is a legacy denormalized field kept for backward
        # compatibility. All new code should use `category_id` (FK) instead.
        # Do not write to `category` in new features.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                entry_date    DATE    NOT NULL,
                category_id   INTEGER REFERENCES expense_categories(id),
                category      VARCHAR(100),
                expense_group VARCHAR(50)  NOT NULL DEFAULT 'operating',
                subtype       VARCHAR(100) NOT NULL DEFAULT 'admin',
                amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
                reference_id  INTEGER,
                notes         TEXT,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 33. Payroll Entries ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS payroll_entries (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                entry_date      DATE    NOT NULL,
                employee_group  VARCHAR(120) NOT NULL,
                base_salary     NUMERIC(12,2) NOT NULL DEFAULT 0,
                employer_burden NUMERIC(12,2) NOT NULL DEFAULT 0,
                total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 34. Depreciation Entries ──────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS depreciation_entries (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                entry_date DATE    NOT NULL,
                asset_name VARCHAR(120) NOT NULL,
                amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes      TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 35. Accrual Entries ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS accrual_entries (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                entry_date DATE    NOT NULL,
                category   VARCHAR(100) NOT NULL,
                amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes      TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 36. Prepayment Entries ────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS prepayment_entries (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                entry_date      DATE    NOT NULL,
                category        VARCHAR(100) NOT NULL,
                amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
                months          INTEGER NOT NULL DEFAULT 1,
                monthly_expense NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes           TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 37. Assets ────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS assets (
                id           SERIAL PRIMARY KEY,
                branch_id    INTEGER NOT NULL REFERENCES branches(id),
                category_id  INTEGER REFERENCES expense_categories(id),
                entry_date   DATE    NOT NULL DEFAULT CURRENT_DATE,
                cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
                reference_id INTEGER,
                notes        TEXT,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 38. Cash Purchases ────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS cash_purchases (
                id              SERIAL PRIMARY KEY,
                company_id      INTEGER NOT NULL REFERENCES companies(id),
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                supplier_id     INTEGER REFERENCES suppliers(id),
                ingredient_id   INTEGER REFERENCES ingredients(id),
                category_id     INTEGER REFERENCES expense_categories(id),
                purchase_type   VARCHAR(20) NOT NULL DEFAULT 'branch_cash'
                    CHECK (purchase_type IN ('branch_cash','emergency')),
                entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
                quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
                unit_cost       NUMERIC(12,4) NOT NULL DEFAULT 0,
                gross_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
                tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
                payable_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
                petty_cash_used BOOLEAN NOT NULL DEFAULT FALSE,
                status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
                approved_by     INTEGER REFERENCES app_users(id),
                approved_at     TIMESTAMPTZ,
                notes           TEXT DEFAULT '',
                created_by      INTEGER REFERENCES app_users(id),
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 39. Petty Cash Ledger ─────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS petty_cash_ledger (
                id            SERIAL PRIMARY KEY,
                company_id    INTEGER NOT NULL REFERENCES companies(id),
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                entry_date    DATE NOT NULL DEFAULT CURRENT_DATE,
                txn_type      VARCHAR(20) NOT NULL
                    CHECK (txn_type IN ('top_up','spend','adjustment')),
                amount        NUMERIC(12,2) NOT NULL,
                balance_after NUMERIC(12,2),
                ref_table     VARCHAR(50),
                ref_id        INTEGER,
                notes         TEXT DEFAULT '',
                created_by    INTEGER REFERENCES app_users(id),
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 40. Purchase Invoices ─────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_invoices (
                id             SERIAL PRIMARY KEY,
                company_id     INTEGER NOT NULL REFERENCES companies(id),
                branch_id      INTEGER REFERENCES branches(id),
                supplier_id    INTEGER REFERENCES suppliers(id),
                ref_table      VARCHAR(50)  NOT NULL,
                ref_id         INTEGER      NOT NULL,
                invoice_number VARCHAR(100),
                invoice_date   DATE,
                amount         NUMERIC(12,2),
                file_name      VARCHAR(255) NOT NULL,
                file_path      VARCHAR(500) NOT NULL,
                mime_type      VARCHAR(100) NOT NULL,
                file_size_kb   INTEGER,
                notes          TEXT DEFAULT '',
                uploaded_by    INTEGER REFERENCES app_users(id),
                uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 41. Budgets ───────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS budgets (
                id        SERIAL PRIMARY KEY,
                branch_id INTEGER NOT NULL REFERENCES branches(id),
                period    VARCHAR(7) NOT NULL,
                category  VARCHAR(80) NOT NULL
                    CHECK (category IN ('food_cost','labor','rent',
                                        'utilities','marketing','other')),
                amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
                UNIQUE(branch_id, period, category)
            )
        """)

        # ── 42. KPI Snapshots ─────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS kpi_snapshots (
                id             SERIAL PRIMARY KEY,
                branch_id      INTEGER NOT NULL REFERENCES branches(id),
                period         VARCHAR(7) NOT NULL,
                revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
                food_cost      NUMERIC(14,2) NOT NULL DEFAULT 0,
                labor_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
                food_cost_pct  NUMERIC(6,2)  NOT NULL DEFAULT 0,
                labor_cost_pct NUMERIC(6,2)  NOT NULL DEFAULT 0,
                waste_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
                gross_profit   NUMERIC(14,2) NOT NULL DEFAULT 0,
                net_profit     NUMERIC(14,2) NOT NULL DEFAULT 0,
                computed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
                UNIQUE(branch_id, period)
            )
        """)

        # ── 43. Company Period Statuses ───────────────────────────────────────
        # Single source of truth for period state. Controls all write access
        # across every module system-wide for a given company + month.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS company_period_statuses (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                period     VARCHAR(7) NOT NULL,
                status     VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed','locked')),
                notes      TEXT,
                updated_by INTEGER REFERENCES app_users(id),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, period)
            )
        """)

        # ── 44. Company Period Status History ─────────────────────────────────
        # Immutable audit trail. One row per transition — never updated, only appended.
        # Answers: who changed what, from which state, to which state, and why.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS company_period_status_history (
                id          SERIAL PRIMARY KEY,
                company_id  INTEGER NOT NULL REFERENCES companies(id),
                period      VARCHAR(7)  NOT NULL,
                from_status VARCHAR(20) NOT NULL,
                to_status   VARCHAR(20) NOT NULL,
                changed_by  INTEGER NOT NULL REFERENCES app_users(id),
                note        TEXT,
                changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 45. Period Snapshots ──────────────────────────────────────────────
        # Frozen financial summary captured automatically at hard-lock time.
        # Company-scoped (not branch) because the period status is company-wide.
        # Used for stable past-period review — unaffected by future adjusting entries.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS period_snapshots (
                id              SERIAL PRIMARY KEY,
                company_id      INTEGER NOT NULL REFERENCES companies(id),
                period          VARCHAR(7) NOT NULL,
                total_sales     NUMERIC(18,2) NOT NULL DEFAULT 0,
                total_expenses  NUMERIC(18,2) NOT NULL DEFAULT 0,
                total_purchases NUMERIC(18,2) NOT NULL DEFAULT 0,
                cogs            NUMERIC(18,2) NOT NULL DEFAULT 0,
                gross_profit    NUMERIC(18,2) NOT NULL DEFAULT 0,
                inventory_value NUMERIC(18,2) NOT NULL DEFAULT 0,
                snapped_at      TIMESTAMPTZ   NOT NULL,
                UNIQUE(company_id, period)
            )
        """)

        # ── 46. Period Closures ───────────────────────────────────────────────
        # Kept for backward compatibility with existing branch-level close records.
        # New code should use company_period_statuses (table 43) instead.
        # Do not write new rows here — read-only going forward.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS period_closures (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                closed_to  DATE    NOT NULL,
                notes      TEXT,
                closed_by  INTEGER REFERENCES app_users(id),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(branch_id, closed_to)
            )
        """)

        # ── 47. Adjusting Entries ─────────────────────────────────────────────
        # Corrections posted in the current open period that reference a past
        # locked period. The locked period's snapshot is never touched.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS adjusting_entries (
                id                SERIAL PRIMARY KEY,
                company_id        INTEGER NOT NULL REFERENCES companies(id),
                branch_id         INTEGER NOT NULL REFERENCES branches(id),
                entry_date        DATE    NOT NULL DEFAULT CURRENT_DATE,
                amount            NUMERIC(12,2) NOT NULL,
                description       TEXT    NOT NULL,
                references_period VARCHAR(7) NOT NULL,
                created_by        INTEGER REFERENCES app_users(id),
                created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 48. Approval Requests ─────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS approval_requests (
                id           SERIAL PRIMARY KEY,
                entity_type  VARCHAR(80) NOT NULL,
                entity_id    INTEGER     NOT NULL,
                branch_id    INTEGER REFERENCES branches(id),
                requested_by INTEGER REFERENCES app_users(id),
                status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
                approved_by  INTEGER REFERENCES app_users(id),
                requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                approved_at  TIMESTAMPTZ
            )
        """)

        # ── 49. Period Backups ────────────────────────────────────────────────
        # Legacy table — kept for backward compatibility. Do not write new rows.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS period_backups (
                id           SERIAL PRIMARY KEY,
                company_id   INTEGER NOT NULL REFERENCES companies(id),
                branch_id    INTEGER NOT NULL REFERENCES branches(id),
                period       VARCHAR(7) NOT NULL,
                period_start DATE NOT NULL,
                period_end   DATE NOT NULL,
                backup_data  JSONB NOT NULL DEFAULT '{}',
                locked_by    VARCHAR(255) NOT NULL DEFAULT '',
                notes        TEXT NOT NULL DEFAULT '',
                created_by   INTEGER REFERENCES app_users(id),
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, branch_id, period)
            )
        """)

        # ── 50. Governance Action Log ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS governance_action_log (
                id               SERIAL PRIMARY KEY,
                item_id          VARCHAR(80)  NOT NULL,
                entity_type      VARCHAR(80)  NOT NULL,
                company_id       INTEGER NOT NULL REFERENCES companies(id),
                description      TEXT,
                submitted_by     VARCHAR(120),
                original_date    DATE,
                action           VARCHAR(20)  NOT NULL
                    CHECK (action IN ('approve','reject')),
                action_date      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                amount           NUMERIC(14,2),
                currency         VARCHAR(10),
                from_procurement BOOLEAN      NOT NULL DEFAULT FALSE,
                actor_id         INTEGER REFERENCES app_users(id),
                branch_id        INTEGER REFERENCES branches(id)
            )
        """)

        # ── 51. Audit Log ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                user_id    INTEGER REFERENCES app_users(id),
                branch_id  INTEGER REFERENCES branches(id),
                action     VARCHAR(50) NOT NULL,
                table_name VARCHAR(80) NOT NULL,
                record_id  INTEGER,
                old_data   JSONB,
                new_data   JSONB,
                ip_address VARCHAR(45),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 52. Employee Groups ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS employee_groups (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                name       VARCHAR(120) NOT NULL,
                burden_pct NUMERIC(5,2) NOT NULL DEFAULT 26.00,
                headcount  INTEGER NOT NULL DEFAULT 1,
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, name)
            )
        """)
        # ── 53. System Logs ───────────────────────────────────────────────────────
        # Structured operational log for background jobs, scheduled tasks, API errors,
        # and system-level events that don't map to a specific user action.
        # For user-action tracing, prefer audit_log (table 51).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS system_logs (
                id          SERIAL PRIMARY KEY,
                company_id  INTEGER NOT NULL REFERENCES companies(id),
                branch_id   INTEGER REFERENCES branches(id),
                user_id     INTEGER REFERENCES app_users(id),
                level       VARCHAR(10) NOT NULL DEFAULT 'info'
                    CHECK (level IN ('debug','info','warning','error','critical')),
                category    VARCHAR(50) NOT NULL DEFAULT 'system'
                    CHECK (category IN ('auth','data','system','billing','api','security')),
                action      VARCHAR(80) NOT NULL,
                entity_type VARCHAR(80),
                entity_id   INTEGER,
                payload     JSONB,
                ip_address  VARCHAR(45),
                session_id  VARCHAR(120),
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ─────────────────────────────────────────────────────────────────────
        # INDEXES
        # ─────────────────────────────────────────────────────────────────────

        # Inventory
        
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch     ON inventory_movements(branch_id, entry_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_movements_type       ON inventory_movements(movement_type)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_movements_ingredient ON inventory_movements(ingredient_id)")

        # Ingredients
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ingredients_company_active     ON ingredients(company_id, is_active, name)")

        # Supplier price history
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_history_ingredient       ON supplier_price_history(ingredient_id, purchase_date DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_price_history_company          ON supplier_price_history(company_id, ingredient_id)")

        # Standard cost history
        cur.execute("CREATE INDEX IF NOT EXISTS idx_std_cost_history_ingredient    ON standard_cost_history(ingredient_id, effective_date DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_std_cost_history_company       ON standard_cost_history(company_id)")

        # GRN / Purchases
        cur.execute("CREATE INDEX IF NOT EXISTS idx_goods_receipts_branch          ON goods_receipts(branch_id, entry_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_goods_receipts_purchase        ON goods_receipts(purchase_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchases_branch               ON purchases(branch_id, entry_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_history_purchase      ON purchase_history(purchase_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_history_company       ON purchase_history(company_id, changed_at)")

        # Stock
        cur.execute("CREATE INDEX IF NOT EXISTS idx_stock_adjustments_branch       ON stock_adjustments(branch_id, status)")

        # Sales / Cash / Petty Cash
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sales_branch                   ON sales(branch_id, entry_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cash_purchases_branch          ON cash_purchases(branch_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cash_purchases_company         ON cash_purchases(company_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_petty_cash_branch              ON petty_cash_ledger(branch_id)")

        # Invoices / Audit
        cur.execute("CREATE INDEX IF NOT EXISTS idx_invoices_ref                   ON purchase_invoices(ref_table, ref_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_company              ON audit_log(company_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_table_record         ON audit_log(table_name, record_id)")

        # Period system — critical for dashboard filtering performance
        cur.execute("CREATE INDEX IF NOT EXISTS idx_period_statuses_company        ON company_period_statuses(company_id, period)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_period_history_company_period  ON company_period_status_history(company_id, period)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_period_snapshots_company       ON period_snapshots(company_id, period)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_adjusting_entries_company      ON adjusting_entries(company_id, references_period)")
        # System logs                                                              ← add here
        cur.execute("CREATE INDEX IF NOT EXISTS idx_system_logs_company_time ON system_logs(company_id, created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_system_logs_level        ON system_logs(company_id, level)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_system_logs_entity       ON system_logs(company_id, entity_type, entity_id)")

        conn.commit()
        print("✅ Database initialized successfully.")

    except Exception as e:
        if conn:
            conn.rollback()
        print("❌ Error initializing database:", e)
        raise

    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()