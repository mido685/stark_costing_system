/**
 * API Service Layer
 * Handles all communication with the STARK AI backend
 */

const PRODUCT_OFFSET = 1_000_000;

export function encodeFinishedGoodId(itemId: number): number {
  return itemId >= PRODUCT_OFFSET ? itemId : itemId + PRODUCT_OFFSET;
}

// Empty string = same origin, Vite proxy forwards /api/* to localhost:8085
const API_BASE = import.meta.env.VITE_API_URL || "";

const UNWRAP_KEYS = new Set([
  "accrual",
  "accruals",
  "adjustment",
  "adjustments",
  "approval",
  "approvals",
  "backup",
  "backups",
  "branches",
  "budget",
  "cash_purchase",
  "cash_purchases",
  "categories",
  "closure",
  "cost",
  "damage",
  "dashboard",
  "depreciation",
  "expense",
  "expenses",
  "finished_goods",
  "history",
  "ingredient",
  "ingredients",
  "invoice",
  "invoices",
  "item",
  "items",
  "kpi",
  "ledger",
  "opening_stock",
  "payroll",
  "prepayment",
  "prepayments",
  "product",
  "products",
  "production",
  "purchase",
  "purchase_return",
  "purchases",
  "roles",
  "rows",
  "sale",
  "sales",
  "snapshot",
  "snapshots",
  "stock",
  "stock_count",
  "stock_counts",
  "stock_issue",
  "stock_issues",
  "summary",
  "suppliers",
  "transfer",
  "transfers",
  "users",
  "waste",
  "inventory_movements",
]);
export async function apiUpload<T>(endpoint: string, formData: FormData): Promise<T> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      // NO Content-Type here — browser sets it automatically with the correct multipart boundary
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });
  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      const body = await response.json();
      errorMessage = body?.detail?.error ?? body?.error ?? errorMessage;
    } catch { /* ignore */ }
    const err: any = new Error(errorMessage);
    err.status = response.status;
    throw err;
  }
  return normalizeApiResponse(await response.json());
}

function normalizeApiResponse(body: any) {
  if (!body || typeof body !== "object" || body.success !== true) return body;
  const payloadKeys = Object.keys(body).filter((key) => key !== "success" && key !== "message");
  if (payloadKeys.length === 1 && UNWRAP_KEYS.has(payloadKeys[0])) {
    return body[payloadKeys[0]];
  }
  return body;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Branch {
  id: number;
  name: string;
}

export interface StockBalance {
  ingredient_id: number;
  name: string;
  unit: string;
  balance_qty: number;
  inventory_value: number;
  stock_value?: number;
  negative_alert: boolean;
  reorder_alert: boolean;
  reorder_level: number;
}

export interface StockIssueRow {
  id: number;
  branch_id: number;
  ingredient_id: number;
  entry_date: string;
  quantity: number;
  station: string;
  notes: string;
}

export interface SaleRow {
  id: number;
  branch_id: number;
  item_id: number;
  entry_date: string;
  quantity: number;
  gross_amount: number;
  discount_amount: number;
  tax_amount: number;
  net_amount: number;
  payment_method: string;
  status: string;
}

export interface ExpenseRow {
  id: number;
  branch_id: number;
  branch_name: string;
  entry_date: string;
  category: string;
  expense_group: string;
  subtype: string;
  amount: number;
  notes: string;
}

export interface PayrollEntryRow {
  id: number;
  branch_id: number;
  branch_name: string;
  entry_date: string;
  employee_group: string;
  base_salary: number;
  employer_burden: number;
  total_amount: number;
  notes: string;
}

export interface DepreciationEntryRow {
  id: number;
  branch_id: number;
  branch_name: string;
  entry_date: string;
  asset_name: string;
  amount: number;
  notes: string;
}

export interface AccrualEntryRow {
  id: number;
  branch_id: number;
  branch_name: string;
  entry_date: string;
  category: string;
  amount: number;
  notes: string;
}

export interface PrepaymentEntryRow {
  id: number;
  branch_id: number;
  branch_name: string;
  entry_date: string;
  category: string;
  amount: number;
  months: number;
  monthly_expense: number;
  notes: string;
}

export interface BudgetVsActualRow {
  category: string;
  budget_amount: number;
  actual_amount: number;
  variance: number;
  pct_used: number;
}

export interface FinanceKpiRow {
  branch_id: number;
  period: string;
  revenue: number;
  food_cost: number;
  food_cost_pct: number;
  labor_cost: number;
  labor_cost_pct: number;
  waste_cost: number;
  gross_profit: number;
  net_profit: number;
}

export interface PeriodBackupRow {
  id: number;
  company_id: number;
  branch_id: number;
  branch_name: string;
  period: string;
  period_start: string;
  period_end: string;
  backup_data: {
    summary?: FinanceKpiRow & {
      opening_value?: number;
      closing_value?: number;
      purchases_value?: number;
      inventory_cogs?: number;
    };
    expenses?: any[];
    payroll?: any[];
    sales?: any[];
    purchases?: any[];
    [key: string]: any;
  };
  locked_by: string;
  notes: string | null;
  created_by: number | null;
  created_at: string;
}

export type PeriodStatusValue = "open" | "closed" | "locked";

export interface PeriodStatusRow {
  company_id: number;
  period: string;
  status: PeriodStatusValue;
  notes: string;
  updated_by: number | null;
  updated_at: string | null;
  updated_by_name: string | null;
  is_closed: boolean;
  is_locked: boolean;
}

export interface ApprovalRow {
  id: number;
  entity_type: string;
  entity_id: number;
  branch_id: number | null;
  branch_name: string | null;
  requested_by: number | null;
  requested_by_name: string | null;
  status: string;
  approved_by: number | null;
  requested_at: string;
  approved_at: string | null;
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

export interface ItemRow {
  id: number;
  name: string;
  sku: string;
  category: string;
  unit: string;
  sale_price: number;
  reorder_level: number;
  standard_cost: number;
  image_url?: string | null;
}

export interface SupplierRow {
  id: number;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  commercial_reg_number?: string;
  agent_name?: string;
  agent_phone?: string;
  category?: string;
  notes?: string;
  is_active: boolean;
}

export interface CompanyRow {
  id: number;
  name: string;
  slug: string;
}

interface User {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

interface Item {
  id: number;
  name: string;
  sku: string;
  category: string;
  unit: string;
}

interface Supplier {
  id: number;
  name: string;
  phone: string;
  notes: string;
}

// api.ts
export interface Transaction {
  id: number;
  date: string;
  description: string;
  amount: number;
  status: string;
  type: "sale" | "purchase" | "expense" | "adjustment" | string; // keeps broad compat
}

export interface SalesTrendPoint {
  date: string;
  sales: number;
}

export interface BranchSalesPoint {
  name: string;
  sales: number;
}

export interface DashboardMetrics {
  total_sales: number;
  inventory_value: number;
  pending_approvals: number;
  branch_count: number;
  sales_change: number;
  recent_transactions: Transaction[];
  sales_trend?: SalesTrendPoint[];
  branch_sales?: BranchSalesPoint[];
  food_cost_pct?: number;
  food_cost_target?: number;
}

// ─── Core Helper ──────────────────────────────────────────────────────────────

export async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      const body = await response.json();
      errorMessage = body?.detail?.error ?? body?.error ?? errorMessage;
    } catch { /* ignore */ }
    const err: any = new Error(errorMessage);
    err.status = response.status;
    throw err;
  }
  return normalizeApiResponse(await response.json());
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(
  companySlug: string,
  username: string,
  password: string
): Promise<{ user: User; token: string } | null> {
  try {
    return await apiCall<{ user: User; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        company_slug: companySlug.trim().toLowerCase(),
        username:     username.trim(),
        password,
      }),
    });
  } catch {
    return null;
  }
}

export async function registerCompany(data: {
  company_name: string;
  company_slug: string;
  owner_username: string;
  owner_display_name: string;
  owner_password: string;
}): Promise<boolean> {
  try {
    await apiCall("/api/auth/register", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

// ─── Companies ────────────────────────────────────────────────────────────────

export async function getCompanies(): Promise<CompanyRow[]> {
  try {
    return await apiCall<CompanyRow[]>("/api/auth/companies");
  } catch {
    return [];
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  return apiCall<DashboardMetrics>("/api/dashboard");
}

export async function getDashboardMetricsFiltered(
  branchId: string,
  dateFrom: string,
  dateTo: string
): Promise<DashboardMetrics> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", branchId);
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo)   params.set("date_to", dateTo);
  return apiCall<DashboardMetrics>(`/api/dashboard?${params}`);
}

// ─── Branches ─────────────────────────────────────────────────────────────────

export async function getBranches(): Promise<Branch[]> {
  try {
    const res = await apiCall<any>("/api/branches");
    return Array.isArray(res) ? res : (res.branches ?? res.data ?? []);
  } catch {
    return [];
  }
}

export async function addBranch(data: {
  name: string;
  location: string;
  manager: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/branches", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function deleteBranch(branchId: number): Promise<boolean> {
  try {
    await apiCall(`/api/branches/${branchId}`, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function getItems(category?: string): Promise<Item[]> {
  try {
    const query = category ? `?category=${category}` : "";
    return await apiCall<Item[]>(`/api/products/items${query}`);
  } catch {
    return [];
  }
}

export async function addItem(data: {
  name: string;
  sku: string;
  category: string;
  unit: string;
  sale_price: number;
  reorder_level: number;
  standard_cost: number;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/products/items", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function deleteItem(itemId: number): Promise<boolean> {
  try {
    await apiCall(`/api/products/${itemId}`, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}

// ─── Suppliers ────────────────────────────────────────────────────────────────

export async function getSuppliers(): Promise<Supplier[]> {
  try {
    return await apiCall<Supplier[]>("/api/suppliers");
  } catch {
    return [];
  }
}
export async function addSupplier(data: {
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  commercial_reg_number?: string;
  agent_name?: string;
  agent_phone?: string;
  category?: string;
  notes?: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/suppliers", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function deleteSupplier(supplierId: number): Promise<boolean> {
  try {
    await apiCall(`/api/suppliers/${supplierId}`, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}

// ─── Recipes ──────────────────────────────────────────────────────────────────

export async function removeRecipeIngredient(
  recipeId: number,
  ingredientId: number
): Promise<boolean> {
  try {
    await apiCall(`/api/recipes/${recipeId}/ingredients/${ingredientId}`, {
      method: "DELETE",
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<UserRow[]> {
  try {
    return await apiCall<UserRow[]>("/api/users");
  } catch {
    return [];
  }
}

export async function addUser(data: {
  username: string;
  display_name: string;
  role: string;
  password: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/users", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

// ─── Purchases ────────────────────────────────────────────────────────────────

export async function addPurchase(data: {
  branch_id: number;
  supplier_id: number;
  item_id: number;
  entry_date: string;
  quantity: number;
  unit_cost: number;
  tax_amount: number;
  payable_amount: number;
  notes: string;
  user_id: number;
}): Promise<{ id: number; [key: string]: any } | null> {
  try {
    return await apiCall<{ id: number; [key: string]: any }>(
      "/api/purchases",
      {
        method: "POST",
        body: JSON.stringify({
          ...data,
          ingredient_id: data.item_id,
        }),
      }
    );
  } catch {
    return null;
  }
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export async function addSale(data: {
  branch_id: number;
  item_id: number;
  entry_date: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  promotion_amount: number;
  tax_amount: number;
  payment_method: string;
  receivable: number;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  await apiCall("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      ...data,
      product_id: data.item_id,
      receivable_amount: data.receivable,
    }),
  });
  return true;
}

export async function getSalesByBranch(branchId: number, period?: string): Promise<SaleRow[]> {
  const params = new URLSearchParams({ branch_id: String(branchId) });
  if (period) params.set("period", period);
  return apiCall<SaleRow[]>(`/api/sales?${params.toString()}`);
}

export async function getAllSales(period?: string): Promise<SaleRow[]> {
  const query = period ? `?period=${encodeURIComponent(period)}` : "";
  return apiCall<SaleRow[]>(`/api/sales${query}`);
}

// ─── Production ───────────────────────────────────────────────────────────────

export async function addProduction(data: {
  branch_id: number;
  finished_item_id: number;
  entry_date: string;
  quantity: number;
  direct_labor: number;
  overhead: number;
  legacy_material_cost: number;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/production", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        product_id: data.finished_item_id,
        labor_cost: data.direct_labor,
        overhead_cost: data.overhead,
        material_cost: data.legacy_material_cost,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export async function getStockBalances(branchId: number): Promise<StockBalance[]> {
  const rows = await apiCall<any[]>(`/api/stock/${branchId}`);
  return rows.map((row) => ({
    ingredient_id:   Number(row.ingredient_id),
    name:            row.ingredient_name ?? row.name ?? "",
    unit:            row.unit ?? "",
    balance_qty:     Number(row.balance_qty ?? 0),
    inventory_value: Number(row.movement_value ?? row.inventory_value ?? 0),
    negative_alert:  Boolean(row.negative_alert),
    reorder_alert:   Boolean(row.reorder_alert),
    reorder_level:   Number(row.reorder_level ?? 0),
  }));
}

export async function getFinishedGoodsBalances(branchId: number): Promise<StockBalance[]> {
  const rows = await apiCall<any[]>(`/api/stock/finished-goods/${branchId}`);
  return rows.map((row) => ({
    ingredient_id:   Number(row.product_id) + PRODUCT_OFFSET,
    name:            row.product_name ?? row.name ?? "",
    unit:            row.unit ?? "",
    balance_qty:     Number(row.balance_qty ?? 0),
    inventory_value: Number(row.stock_value ?? row.inventory_value ?? 0),
    stock_value:     Number(row.stock_value ?? 0),
    negative_alert:  Boolean(row.negative_alert),
    reorder_alert:   Boolean(row.reorder_alert ?? false),
    reorder_level:   Number(row.reorder_level ?? 0),
  }));
}

export async function getStockIssues(branchId?: number): Promise<any[]> {
  const q = branchId ? `?branch_id=${branchId}` : "";
  return apiCall<any[]>(`/api/stock-issues${q}`);
}

export async function addStockCount(data: {
  branch_id: number;
  ingredient_id: number;
  entry_date: string;
  counted_quantity: number;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    const balances  = await getStockBalances(data.branch_id);
    const current   = balances.find(b => b.ingredient_id === data.ingredient_id);
    const systemQty = current?.balance_qty ?? 0;
    await apiCall("/api/stock-counts", {
      method: "POST",
      body: JSON.stringify({
        branch_id:     data.branch_id,
        ingredient_id: data.ingredient_id,
        entry_date:    data.entry_date,
        system_qty:    systemQty,
        counted_qty:   data.counted_quantity,
        notes:         data.notes,
        user_id:       data.user_id,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function addStockAdjustment(data: {
  branch_id: number;
  ingredient_id: number;
  entry_date: string;
  counted_quantity?: number;
  quantity_delta?: number;
  reason?: string;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/inventory/adjustment", {
      method: "POST",
      body: JSON.stringify({
        branch_id:        data.branch_id,
        ingredient_id:    data.ingredient_id,
        entry_date:       data.entry_date,
        counted_quantity: data.counted_quantity ?? 0,
        quantity_delta:   data.quantity_delta ?? data.counted_quantity ?? 0,
        reason:           data.reason ?? "",
        notes:            data.notes,
        user_id:          data.user_id,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function addTransfer(data: {
  from_branch_id: number;
  to_branch_id: number;
  ingredient_id: number;
  entry_date: string;
  quantity: number;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/transfers", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function addOpeningStock(data: {
  branch_id: number;
  ingredient_id: number;
  entry_date: string;
  qty_issued: number;
  issued_to: string;
  notes: string;
}): Promise<boolean> {
  try {
    await apiCall("/api/stock-issues", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

// ─── Waste & Damage ───────────────────────────────────────────────────────────

export async function addWaste(data: {
  branch_id: number;
  product_id?: number;
  ingredient_id?: number;
  item_id?: number;
  entry_date: string;
  quantity: number;
  reason: string;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/waste", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function addDamage(data: {
  branch_id: number;
  product_id?: number;
  ingredient_id?: number;
  item_id?: number;
  entry_date: string;
  quantity: number;
  reason: string;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/damage", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export async function addExpense(data: {
  branch_id: number;
  entry_date: string;
  category: string;
  amount: number;
  expense_group: string;
  subtype: string;
  notes: string;
  user_id: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/expenses", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function getExpenses(
  branchId?: number,
  period?: string,
  limit = 100
): Promise<ExpenseRow[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", String(branchId));
  if (period)   params.set("period", period);
  params.set("limit", String(limit));
  try {
    return await apiCall<ExpenseRow[]>(`/api/expenses?${params.toString()}`);
  } catch {
    return [];
  }
}

export async function addPayroll(data: {
  branch_id: number;
  entry_date: string;
  employee_group: string;
  base_salary: number;
  employer_burden: number;
  notes: string;
}): Promise<boolean> {
  try {
    await apiCall("/api/payroll", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function getPayrollEntries(
  branchId?: number,
  period?: string,
  limit = 100
): Promise<PayrollEntryRow[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", String(branchId));
  if (period)   params.set("period", period);
  params.set("limit", String(limit));
  try {
    return await apiCall<PayrollEntryRow[]>(`/api/payroll?${params.toString()}`);
  } catch {
    return [];
  }
}

export async function addDepreciation(data: {
  branch_id: number;
  entry_date: string;
  asset_name: string;
  amount: number;
  notes: string;
}): Promise<boolean> {
  try {
    await apiCall("/api/depreciation", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function getDepreciationEntries(
  branchId?: number,
  period?: string,
  limit = 100
): Promise<DepreciationEntryRow[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", String(branchId));
  if (period)   params.set("period", period);
  params.set("limit", String(limit));
  try {
    return await apiCall<DepreciationEntryRow[]>(`/api/depreciation?${params.toString()}`);
  } catch {
    return [];
  }
}

export async function addAccrual(data: {
  branch_id: number;
  entry_date: string;
  category: string;
  amount: number;
  notes: string;
}): Promise<boolean> {
  try {
    await apiCall("/api/accruals", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function getAccrualEntries(
  branchId?: number,
  period?: string,
  limit = 100
): Promise<AccrualEntryRow[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", String(branchId));
  if (period)   params.set("period", period);
  params.set("limit", String(limit));
  try {
    return await apiCall<AccrualEntryRow[]>(`/api/accruals?${params.toString()}`);
  } catch {
    return [];
  }
}

export async function addPrepayment(data: {
  branch_id: number;
  entry_date: string;
  category: string;
  amount: number;
  months: number;
  notes: string;
}): Promise<boolean> {
  try {
    await apiCall("/api/prepayments", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function getPrepaymentEntries(
  branchId?: number,
  period?: string,
  limit = 100
): Promise<PrepaymentEntryRow[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", String(branchId));
  if (period)   params.set("period", period);
  params.set("limit", String(limit));
  try {
    return await apiCall<PrepaymentEntryRow[]>(`/api/prepayments?${params.toString()}`);
  } catch {
    return [];
  }
}

export async function setBudget(data: {
  branch_id: number;
  period: string;
  category: string;
  amount: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/budgets", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function getBudgetVsActual(
  branchId: number,
  period: string
): Promise<BudgetVsActualRow[]> {
  try {
    return await apiCall<BudgetVsActualRow[]>(`/api/budgets/${branchId}/${period}`);
  } catch {
    return [];
  }
}

export async function getFinanceKpi(
  branchId: number,
  period: string
): Promise<FinanceKpiRow> {
  return apiCall<FinanceKpiRow>(`/api/kpi/${branchId}/${period}`);
}

export async function closePeriod(data: {
  branch_id: number;
  closed_to: string;
  notes: string;
  user_id?: number;
}): Promise<boolean> {
  try {
    await apiCall("/api/period/close", { method: "POST", body: JSON.stringify(data) });
    return true;
  } catch {
    return false;
  }
}

export async function isPeriodClosed(
  branchId: number,
  entryDate: string
): Promise<{ is_closed: boolean; is_locked?: boolean; status?: PeriodStatusValue }> {
  return apiCall<{ is_closed: boolean; is_locked?: boolean; status?: PeriodStatusValue }>(
    `/api/period/is-closed?branch_id=${branchId}&entry_date=${encodeURIComponent(entryDate)}`
  );
}

export async function getPeriodStatus(period: string): Promise<PeriodStatusRow> {
  return apiCall<PeriodStatusRow>(`/api/period/status?period=${encodeURIComponent(period)}`);
}

export async function setPeriodStatus(data: {
  period: string;
  status: PeriodStatusValue;
  notes?: string;
}): Promise<PeriodStatusRow> {
  return apiCall<PeriodStatusRow>("/api/period/status", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Period Backups ───────────────────────────────────────────────────────────

export async function generatePeriodBackups(data: {
  months?: number;
  locked_by?: string;
  notes?: string;
} = {}): Promise<{ message: string; count: number; rows: PeriodBackupRow[] }> {
  return apiCall<{ message: string; count: number; rows: PeriodBackupRow[] }>(
    "/api/period-backups/generate",
    { method: "POST", body: JSON.stringify({ months: 4, ...data }) }
  );
}

export async function getPeriodBackups(options: {
  branchId?: number;
  months?: number;
  dateFrom?: string;
  dateTo?: string;
  refresh?: boolean;
} = {}): Promise<PeriodBackupRow[]> {
  const params = new URLSearchParams();
  params.set("months", String(options.months ?? 4));
  if (options.branchId) params.set("branch_id", String(options.branchId));
  if (options.dateFrom) params.set("date_from", options.dateFrom);
  if (options.dateTo)   params.set("date_to", options.dateTo);
  if (options.refresh)  params.set("refresh", "true");
  return apiCall<PeriodBackupRow[]>(`/api/period-backups?${params.toString()}`);
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export async function getPendingApprovals(): Promise<ApprovalRow[]> {
  return apiCall<ApprovalRow[]>("/api/approvals/pending");
}

export async function approveRequest(
  requestId: number,
  approvedBy?: number
): Promise<void> {
  await apiCall(`/api/approvals/${requestId}/approve`, {
    method: "POST",
    body: JSON.stringify({ approved_by: approvedBy ?? null }),
  });
}

export async function rejectRequest(
  requestId: number,
  rejectedBy?: number
): Promise<void> {
  await apiCall(`/api/approvals/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ rejected_by: rejectedBy ?? null }),
  });
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function generateReport(reportType: string, format = "json"): Promise<any> {
  try {
    return await apiCall(`/api/reports/${reportType}?format=${format}`);
  } catch {
    return null;
  }
}

export async function exportReport(
  branchId: number,
  dateFrom: string,
  dateTo: string,
  format: "pdf" | "csv" = "csv"
): Promise<void> {
  const params = new URLSearchParams({
    branch_id: String(branchId),
    date_from: dateFrom,
    date_to:   dateTo,
    format,
  });
  const base  = import.meta.env.VITE_API_URL || "http://localhost:8085";
  const token = localStorage.getItem("token");
  const response = await fetch(`${base}/api/export?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Export failed");
  const blob = await response.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `sales_report_${branchId}_${dateFrom || "all"}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}
