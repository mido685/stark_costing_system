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
                logo_url     VARCHAR(500),                    -- ← add this
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
                UNIQUE(company_id, name)
            )
        """)

        # ── 10. Suppliers ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS suppliers (
                id         SERIAL PRIMARY KEY,
                company_id INTEGER NOT NULL REFERENCES companies(id),
                name       VARCHAR(120) NOT NULL,
                contact    VARCHAR(120),
                phone      VARCHAR(40),
                category   VARCHAR(80),
                notes      TEXT,
                is_active  BOOLEAN NOT NULL DEFAULT TRUE,
                UNIQUE(company_id, name)
            )
        """)

        # ── 11. Ingredients ───────────────────────────────────────────────────
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
                UNIQUE(company_id, name)
            )
        """)

        # ── 12. Expense Categories ────────────────────────────────────────────
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

        # ── 13. Stock Counts ──────────────────────────────────────────────────
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

        # ── 14. Production Costs ──────────────────────────────────────────────
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
                notes         TEXT
            )
        """)

        # ── 15. Revenues ──────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS revenues (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                product_id INTEGER REFERENCES products(id),
                entry_date DATE    NOT NULL,
                quantity   NUMERIC(12,3) NOT NULL DEFAULT 0,
                amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes      TEXT
            )
        """)

        # ── 16. Expenses ──────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                entry_date    DATE    NOT NULL,
                category      VARCHAR(100),
                category_id   INTEGER REFERENCES expense_categories(id),
                expense_group VARCHAR(50)  NOT NULL DEFAULT 'operating',
                subtype       VARCHAR(100) NOT NULL DEFAULT 'admin',
                amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
                reference_id  INTEGER,
                notes         TEXT
            )
        """)

        # ── 17. Assets ────────────────────────────────────────────────────────
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

        # ── 18. Supplier Price History ────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS supplier_price_history (
                id            SERIAL PRIMARY KEY,
                supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                price         NUMERIC(12,4) NOT NULL,
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                notes         TEXT
            )
        """)

        # ── 19. Recipes ───────────────────────────────────────────────────────
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

        # ── 20. Recipe Ingredients ────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS recipe_ingredients (
                id            SERIAL PRIMARY KEY,
                recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                qty_required  NUMERIC(12,4) NOT NULL,
                UNIQUE(recipe_id, ingredient_id)
            )
        """)

        # ── 21. Waste Log ─────────────────────────────────────────────────────
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
                notes         TEXT
            )
        """)

        # ── 22. Damage Log ────────────────────────────────────────────────────
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
                notes         TEXT
            )
        """)

        # ── 23. Stock Issues ──────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS stock_issues (
                id            SERIAL PRIMARY KEY,
                branch_id     INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
                entry_date    DATE    NOT NULL DEFAULT CURRENT_DATE,
                qty_issued    NUMERIC(12,3) NOT NULL,
                issued_to     VARCHAR(120),
                notes         TEXT
            )
        """)

        # ── 24. Inventory Movements ───────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS inventory_movements (
                id             SERIAL PRIMARY KEY,
                branch_id      INTEGER NOT NULL REFERENCES branches(id),
                ingredient_id  INTEGER NOT NULL REFERENCES ingredients(id),
                movement_type  VARCHAR(30) NOT NULL
                    CHECK (movement_type IN (
                        'opening_stock','purchase','purchase_return','transfer_in',
                        'transfer_out','issue','waste','damage','adjustment',
                        'count','customer_return'
                    )),
                entry_date     DATE    NOT NULL,
                quantity_delta NUMERIC(12,3) NOT NULL,
                unit_cost      NUMERIC(12,4) NOT NULL DEFAULT 0,
                reference_table VARCHAR(80),
                reference_id   INTEGER,
                notes          TEXT
            )
        """)

        # ── 25. Finished Goods Movements ──────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS finished_goods_movements (
                id             SERIAL PRIMARY KEY,
                branch_id      INTEGER NOT NULL REFERENCES branches(id),
                product_id     INTEGER NOT NULL REFERENCES products(id),
                movement_type  VARCHAR(30) NOT NULL
                    CHECK (movement_type IN (
                        'production','sale','customer_return','waste','damage',
                        'transfer_in','transfer_out','adjustment'
                    )),
                entry_date     DATE    NOT NULL,
                quantity_delta NUMERIC(12,3) NOT NULL,
                unit_cost      NUMERIC(12,4) NOT NULL DEFAULT 0,
                reference_table VARCHAR(80),
                reference_id   INTEGER,
                notes          TEXT
            )
        """)
        cur.execute("""
            ALTER TABLE finished_goods_movements
            DROP CONSTRAINT IF EXISTS finished_goods_movements_movement_type_check
        """)
        cur.execute("""
            ALTER TABLE finished_goods_movements
            ADD CONSTRAINT finished_goods_movements_movement_type_check
            CHECK (movement_type IN (
                'production','sale','customer_return','waste','damage',
                'transfer_in','transfer_out','adjustment'
            ))
        """)

        # ── 26. Purchases ─────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchases (
                id             SERIAL PRIMARY KEY,
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
                created_by     INTEGER REFERENCES app_users(id)
            )
        """)

        # ── 27. Purchase Returns ──────────────────────────────────────────────
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
                created_by    INTEGER REFERENCES app_users(id)
            )
        """)

        # ── 28. Sales ─────────────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sales (
                id               SERIAL PRIMARY KEY,
                branch_id        INTEGER NOT NULL REFERENCES branches(id),
                product_id       INTEGER NOT NULL REFERENCES products(id),
                entry_date       DATE    NOT NULL,
                quantity         NUMERIC(12,3) NOT NULL,
                unit_price       NUMERIC(12,2) NOT NULL,
                gross_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
                promotion_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
                net_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
                payment_method   VARCHAR(20) NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','credit')),
                receivable_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes            TEXT,
                status           VARCHAR(20) NOT NULL DEFAULT 'approved'
                    CHECK (status IN ('pending','approved','rejected')),
                created_by       INTEGER REFERENCES app_users(id)
            )
        """)

        # ── 29. Customer Returns ──────────────────────────────────────────────
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
                created_by    INTEGER REFERENCES app_users(id)
            )
        """)

        # ── 30. Transfers ─────────────────────────────────────────────────────
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
                created_by     INTEGER REFERENCES app_users(id)
            )
        """)

        # ── 31. Payroll Entries ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS payroll_entries (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                entry_date      DATE    NOT NULL,
                employee_group  VARCHAR(120) NOT NULL,
                base_salary     NUMERIC(12,2) NOT NULL DEFAULT 0,
                employer_burden NUMERIC(12,2) NOT NULL DEFAULT 0,
                total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes           TEXT
            )
        """)

        # ── 32. Depreciation Entries ──────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS depreciation_entries (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                entry_date DATE    NOT NULL,
                asset_name VARCHAR(120) NOT NULL,
                amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes      TEXT
            )
        """)

        # ── 33. Accrual Entries ───────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS accrual_entries (
                id         SERIAL PRIMARY KEY,
                branch_id  INTEGER NOT NULL REFERENCES branches(id),
                entry_date DATE    NOT NULL,
                category   VARCHAR(100) NOT NULL,
                amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes      TEXT
            )
        """)

        # ── 34. Prepayment Entries ────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS prepayment_entries (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                entry_date      DATE    NOT NULL,
                category        VARCHAR(100) NOT NULL,
                amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
                months          INTEGER NOT NULL DEFAULT 1,
                monthly_expense NUMERIC(12,2) NOT NULL DEFAULT 0,
                notes           TEXT
            )
        """)

        # ── 35. Budgets ───────────────────────────────────────────────────────
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

        # ── 36. KPI Snapshots ─────────────────────────────────────────────────
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

        # ── 37. Approval Requests ─────────────────────────────────────────────
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

        # ── 38. Governance Action Log ─────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS governance_action_log (
                id               SERIAL PRIMARY KEY,
                item_id          VARCHAR(80)  NOT NULL,
                entity_type      VARCHAR(80)  NOT NULL,
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

        # ── 39. Cash Purchases ────────────────────────────────────────────────
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

        # ── 40. Petty Cash Ledger ─────────────────────────────────────────────
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

        # ── 41. Purchase Invoices ─────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS purchase_invoices (
                id           SERIAL PRIMARY KEY,
                company_id   INTEGER NOT NULL REFERENCES companies(id),
                ref_table    VARCHAR(50)  NOT NULL,
                ref_id       INTEGER      NOT NULL,
                file_name    VARCHAR(255) NOT NULL,
                file_path    VARCHAR(500) NOT NULL,
                mime_type    VARCHAR(100) NOT NULL,
                file_size_kb INTEGER,
                notes        TEXT DEFAULT '',
                uploaded_by  INTEGER REFERENCES app_users(id),
                uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                supplier_id   INTEGER REFERENCES suppliers(id),
                invoice_number  VARCHAR(100),
                invoice_date   DATE,
                amount         NUMERIC(12,2),
                branch_id       INTEGER REFERENCES branches(id)
            )
        """)

        # ── 42. Period Snapshots ──────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS period_snapshots (
                id              SERIAL PRIMARY KEY,
                branch_id       INTEGER NOT NULL REFERENCES branches(id),
                period_label    VARCHAR(80) NOT NULL,
                entry_date      DATE    NOT NULL DEFAULT CURRENT_DATE,
                notes           TEXT,
                locked_by       VARCHAR(120) NOT NULL DEFAULT '',
                opening_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
                closing_value   NUMERIC(14,2) NOT NULL DEFAULT 0,
                purchases_value NUMERIC(14,2) NOT NULL DEFAULT 0,
                cogs            NUMERIC(14,2) NOT NULL DEFAULT 0,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # ── 43. Period Closures ───────────────────────────────────────────────
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

        # ── 44. Company Period Statuses ───────────────────────────────────────
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

        # ── 45. Period Backups ────────────────────────────────────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS period_backups (
                id           SERIAL PRIMARY KEY,
                company_id   INTEGER NOT NULL REFERENCES companies(id),
                branch_id    INTEGER NOT NULL REFERENCES branches(id),
                period       VARCHAR(7) NOT NULL,
                period_start DATE NOT NULL,
                period_end   DATE NOT NULL,
                backup_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
                locked_by    VARCHAR(120) NOT NULL DEFAULT '',
                notes        TEXT,
                created_by   INTEGER REFERENCES app_users(id),
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(company_id, branch_id, period)
            )
        """)

        # ── 46. Audit Log ─────────────────────────────────────────────────────
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

        # ── Indexes ───────────────────────────────────────────────────────────
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cash_purchases_branch   ON cash_purchases(branch_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_cash_purchases_company  ON cash_purchases(company_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_invoices_ref            ON purchase_invoices(ref_table, ref_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_petty_cash_branch       ON petty_cash_ledger(branch_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_company       ON audit_log(company_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_table_record  ON audit_log(table_name, record_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch ON inventory_movements(branch_id, entry_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sales_branch            ON sales(branch_id, entry_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_purchases_branch        ON purchases(branch_id, entry_date)")

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
