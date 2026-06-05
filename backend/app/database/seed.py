import psycopg2
from .connection import get_connection, dict_cursor
from app.security.auth import hash_password


def seed():
    conn = get_connection()
    cur = dict_cursor(conn)

    try:
        # ── 1. Companies ──────────────────────────────────────────────────────
        cur.execute("""
            INSERT INTO companies (name, slug) VALUES
            ('Acme Corp',  'acme-corp'),
            ('Globex Inc', 'globex-inc')
            ON CONFLICT (slug) DO NOTHING
        """)
        cur.execute("SELECT id, name FROM companies")
        companies = cur.fetchall()

        # ── 2. Roles ──────────────────────────────────────────────────────────
        for company in companies:
            cur.execute("""
                INSERT INTO roles (company_id, name, description) VALUES
                (%s, 'admin',      'Full access'),
                (%s, 'manager',    'Branch manager'),
                (%s, 'accountant', 'Accounting only'),
                (%s, 'clerk',      'Data entry')
                ON CONFLICT (company_id, name) DO NOTHING
            """, (company["id"],) * 4)

        # ── 3. Permissions ────────────────────────────────────────────────────
        cur.execute("""
            INSERT INTO permissions (name, description) VALUES
            ('branches.create', 'Can create branches'),
            ('branches.delete', 'Can delete branches'),
            ('branches.edit',   'Can edit branches'),
            ('users.manage',    'Can manage users')
            ON CONFLICT (name) DO NOTHING
        """)
        cur.execute("SELECT id FROM permissions")
        permissions = cur.fetchall()

        # ── 4. Branches ───────────────────────────────────────────────────────
        for company in companies:
            cur.execute("""
                INSERT INTO branches (company_id, name, location, manager) VALUES
                (%s, 'Main Branch',  'Cairo',      'Ahmed'),
                (%s, 'North Branch', 'Alexandria', 'Sara')
                ON CONFLICT (company_id, name) DO NOTHING
            """, (company["id"], company["id"]))

        # ── 5. Users ──────────────────────────────────────────────────────────
        for company in companies:
            cur.execute(
                "SELECT id FROM roles WHERE company_id = %s AND name = 'admin'",
                (company["id"],)
            )
            admin_role = cur.fetchone()

            cur.execute("""
                INSERT INTO app_users
                    (company_id, username, display_name, role_id, password_hash)
                VALUES (%s, 'admin', 'Admin User', %s, %s)
                ON CONFLICT (company_id, username) DO NOTHING
            """, (company["id"], admin_role["id"], hash_password("admin123")))

        # ── 6. Role-Permissions (admin gets all permissions) ──────────────────
        for company in companies:
            cur.execute(
                "SELECT id FROM roles WHERE company_id = %s AND name = 'admin'",
                (company["id"],)
            )
            admin_role = cur.fetchone()

            for permission in permissions:
                cur.execute("""
                    INSERT INTO role_permissions (role_id, permission_id)
                    VALUES (%s, %s)
                    ON CONFLICT (role_id, permission_id) DO NOTHING
                """, (admin_role["id"], permission["id"]))

        # ── 7. SKU Prefixes ───────────────────────────────────────────────────
        for company in companies:
            prefixes = [
                # Raw Materials
                ("General Ingredient", "ING",   "raw_material"),
                ("Dairy",              "DAIRY", "raw_material"),
                ("Meat & Poultry",     "MEAT",  "raw_material"),
                ("Produce",            "PRD",   "raw_material"),
                ("Dry Goods",          "DRY",   "raw_material"),
                ("Frozen Items",       "FRZ",   "raw_material"),
                ("Beverages Supply",   "BEVS",  "raw_material"),
                ("Seafood",            "SEA",   "raw_material"),
                ("Oils & Fats",        "OIL",   "raw_material"),
                ("Spices & Herbs",     "SPICE", "raw_material"),
                ("Bakery Supply",      "BAKS",  "raw_material"),
                ("Packaging",          "PKG",   "raw_material"),
                # Finished Goods
                ("Main Dish",          "DISH",  "finished_good"),
                ("Appetizer",          "APP",   "finished_good"),
                ("Dessert",            "DES",   "finished_good"),
                ("Beverage",           "BEV",   "finished_good"),
                ("Breakfast",          "BRK",   "finished_good"),
                ("Sandwich",           "SAND",  "finished_good"),
                ("Cake & Pastry",      "CAKE",  "finished_good"),
                ("Salad",              "SAL",   "finished_good"),
                ("Soup",               "SOUP",  "finished_good"),
                ("Pizza",              "PIZ",   "finished_good"),
                ("Grill",              "GRL",   "finished_good"),
                ("Kids Meal",          "KIDS",  "finished_good"),
            ]
            for label, prefix, item_type in prefixes:
                cur.execute("""
                    INSERT INTO sku_prefixes (company_id, label, prefix, item_type)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (company_id, prefix) DO NOTHING
                """, (company["id"], label, prefix, item_type))

        conn.commit()
        print("✅ Seeded successfully")

    except Exception as e:
        conn.rollback()
        print(f"❌ Seed failed: {e}")
        raise

    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    seed()