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