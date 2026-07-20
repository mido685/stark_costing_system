# Branch Costing App

An enterprise-style local web app for:

- branch, supplier, item, and user master data
- opening stock, stock adjustments, and physical stock counts
- purchases and purchase returns
- recipe version history
- production batches and branch transfers
- sales with discounts, promotions, VAT/tax, and payment split
- customer returns
- waste and damaged goods tracking
- branch expenses, utilities split, payroll burden, depreciation
- accruals and prepayments
- accounts receivable and payable visibility sadflkjjajljfa ajljlkadjda jkaljaljd 
- period closing
- role-based approval flow
- audit trail
- negative stock and reorder alerts
- standard cost vs actual cost comparison
- CSV and PDF report export
- login-based access for local users
- food cost %, labor cost %, sales mix, menu engineering, top losses
- kitchen issue tracking, recipe yield, and portion costing

## Run

```powershell
cd C:\Users\HP\OneDrive\Desktop\Chatbot\branch_costing_app
pip install -r requirements.txt
python app.py
```

Then open:

```text
http://127.0.0.1:8080
```

If you run the app from WSL and want the browser on Windows to reach it reliably, use:

```bash
cd /mnt/c/Users/HP/OneDrive/Desktop/Chatbot/branch_costing_app
HOST=0.0.0.0 PORT=8080 python app.py
```

Default login accounts:

```text
admin / admin123
manager / manager123
accountant / accountant123
```

## Main calculation logic

- Opening stock, purchases, returns, adjustments, counts, transfers, sales, waste, and damage all affect branch inventory
- Recipes are versioned and used to calculate actual material consumption in production
- Actual production cost = material cost + direct labor + overhead
- Sales support discounts, promotions, tax, cash/bank/credit split, and receivables
- Gross profit = revenue - COGS - waste - damage
- Net profit = gross profit - expenses - payroll - depreciation - accruals - prepaid monthly expense
- Period closing prevents back-dated changes after month-end
- Non-admin/non-accountant entries stay pending until approved

## Notes

- Data is stored in PostgreSQL
- The app reads database settings from `.env`
- Required env keys:
  - `DB_HOST`
  - `DB_PORT`
  - `DB_NAME`
  - `DB_USER`
  - `DB_PASSWORD`
- Optional app env keys:
  - `HOST`
  - `PORT`
- Exports are written to `exports/`
- The app creates or extends the needed Postgres tables on first run
- The Python environment needs `psycopg2-binary` and `python-dotenv`
