  import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
  import { Card } from "@/components/ui/card";
  import { Button } from "@/components/ui/button";
import {
  AlertTriangle, X, Loader2, AlertCircle, RefreshCw, Search,
  ChevronUp, ChevronDown, ChevronsUpDown, Package, Layers, Filter,
  Printer, Download, ClipboardList, History, TrendingDown, TrendingUp,
  CheckCircle, Clock, XCircle, ShoppingCart, Lock, BarChart2,
  Calendar, ChevronRight, Eye, Percent, Shield, Zap, FileText,
  ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, Plus,
  Pencil, ArrowRight,
} from "lucide-react";
  import { useApi } from "@/hooks/useApi";
  import {
    getBranches, getStockBalances, getFinishedGoodsBalances, getSuppliers,
    addStockAdjustment, addStockCount, addTransfer, addOpeningStock, addPurchase, apiCall,
    isPeriodClosed, getPeriodStatus, setPeriodStatus,
  } from "@/lib/api";
  import type { StockBalance, Branch, PeriodStatusValue, PeriodStatusRow } from "@/lib/api";
  import { useLanguage } from "@/contexts/LanguageContext";
  import {
    formatCurrency as formatCurrencyValue,
    formatDate,
    formatDateTime,
    getCurrencyLabel,
  } from "@/lib/localization";
  import { useWorkingPeriod } from "@/contexts/Workingperiodcontext";
  import { PROCUREMENT_PO_EVENT } from "./Governance";

  // ─── Types ────────────────────────────────────────────────────────────────────

  // Added "periodStatus" to ModalType
  type ModalType = "count" | "adjustment" | "waste" | "transfer" | "opening" | "periodClose" | "poGenerate" | "periodStatus" | null;
  type StatusFilter = "all" | "negative" | "low" | "ok";
  type SortField = "name" | "balance_qty" | "reorder_level" | "inventory_value";
  type SortDir = "asc" | "desc";
  type GroupBy = "none" | "status" | "unit";
  type MainTab = "dashboard" | "rawMaterials" | "finishedGoods" | "transactions" | "transfers" | "variance" | "auditLog" | "cogs";

  interface PeriodSnapshot {
    id: number;
    period_label: string;
    branch_id: number;
    entry_date: string;
    locked_at: string;
    locked_by: string;
    opening_value: number;
    closing_value: number;
    purchases_value: number;
    cogs: number;
  }

  interface AdjustmentRecord {
    id: number;
    ingredient_id: number;
    ingredient_name: string;
    quantity_delta: number;
    unit: string;
    reason: string;
    notes: string;
    entry_date: string;
    user_name: string;
    status: "pending" | "approved" | "rejected";
    approved_by?: string;
  }

  interface WasteRecord {
    id: number;
    branch_id: number;
    branch_name?: string;
    ingredient_id: number;
    ingredient_name: string;
    entry_date: string;
    quantity: number;
    unit_cost: number;
    waste_reason: string;
    notes?: string;
    wasted_by?: string;
  }

  interface VarianceRow {
    ingredient_id: number;
    kind?: "ingredient" | "fg";
    name: string;
    unit: string;
    theoretical_usage: number;
    actual_usage: number;
    variance: number;
    variance_pct: number;
    variance_value: number;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const inputClass =
    "w-full px-3 py-2 rounded-lg border border-input bg-background text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground transition-colors";
  const labelClass = "block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide";

  function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
    return (
      <div>
        <label className={labelClass}>{label}</label>
        {children}
        {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      </div>
    );
  }

  // Waste above this share of on-hand stock (or more than is on hand) is sent for
  // manager approval as an adjustment. Set to Infinity to keep all waste immediate.
  // Infinity = all waste is recorded immediately through /api/waste (the backend
  // writes it once, as a 'waste' movement). Finite = large waste goes to approval.
  const WASTE_APPROVAL_PCT = Infinity;

  function wasteNeedsApproval(bal: StockBalance | undefined, qty: number): boolean {
    if (!Number.isFinite(WASTE_APPROVAL_PCT)) return false;
    if (!bal || qty <= 0) return false;
    if (qty > bal.balance_qty) return true;
    return (qty / bal.balance_qty) * 100 > WASTE_APPROVAL_PCT;
  }

  function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
  function currentPeriod() { return today().slice(0, 7); }

  function fmtEGP(n: number) {
    return formatCurrencyValue(Math.abs(n), { maximumFractionDigits: 2 });
  }
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));

  function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }

  // fmtEGP applies Math.abs, so negatives need an explicit sign
  function fmtSignedEGP(v: number) { return `${v < 0 ? "−" : ""}${fmtEGP(v)}`; }

  // Signed row value: the sign follows the quantity, so it is right whether the API sends signed or absolute values
  function stockValue(b: StockBalance): number {
    const raw = Number(b.inventory_value ?? b.stock_value ?? 0) || 0;
    return b.balance_qty < 0 ? -Math.abs(raw) : Math.abs(raw);
  }
  // Value counted toward totals and closing inventory: negative stock counts as 0
  function assetValue(b: StockBalance): number {
    return Math.max(0, stockValue(b));
  }

  function getStatus(b: StockBalance): Exclude<StatusFilter, "all"> {
    if (b.negative_alert) return "negative";
    if (b.reorder_alert) return "low";
    return "ok";
  }

  // ─── CSV Export ───────────────────────────────────────────────────────────────

  function exportCSV(
    rows: StockBalance[], title: string, branchName: string, isFinished: boolean,
    countMap: Record<number, any>,
    purchaseMap: Record<number, { totalQty: number; totalValue: number; count: number }>,
    transferMap: Record<number, { in: number; out: number }>,
    openingMap: Record<number, number>,
    adjustmentMap: Record<number, { total: number; waste: number }>,
  ) {
    const currencyLabel = getCurrencyLabel();
    const headers = [
      "Name", "Unit", "Balance Qty", "Reorder Level", `Inventory Value (${currencyLabel})`,
      "Last Count Qty", "Count Diff", "Total Purchased", "Transfer In",
      "Transfer Out", "Opening Qty", "Net Adjustment", "Status",
    ];

    // Quote every text cell and neutralise spreadsheet formula injection
    const text = (v: unknown) =>
      `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    // Blank when there is no data, so "0" always means a real zero
    const num = (v: number | null | undefined, d = 3) =>
      v === null || v === undefined || Number.isNaN(v) ? "" : v.toFixed(d);

    const csvRows = rows.map(r => {
      // Movement maps are keyed by ingredient_id, so finished goods must not read them
      const rid = Number((r as any).ingredient_id ?? (r as any).product_id);
      const countData = isFinished ? undefined : countMap[rid];
      const purchase  = isFinished ? undefined : purchaseMap[rid];
      const transfer  = isFinished ? undefined : transferMap[rid];
      const opening   = isFinished ? undefined : openingMap[rid];
      const adjust    = isFinished ? undefined : adjustmentMap[rid];

      return [
        text(r.name),
        text(r.unit),
        num(r.balance_qty),
        num(r.reorder_level ?? 0),
        num(stockValue(r), 2),
        num(countData ? Number(countData.counted_qty ?? 0) : null),
        num(countData ? Number(countData.delta ?? 0) : null),
        num(purchase?.totalQty),
        num(transfer?.in),
        num(transfer?.out),
        num(opening),
        num(adjust?.total),
        getStatus(r),
      ].join(",");
    });

    // BOM so Excel opens UTF-8 (e.g. Arabic item names) correctly
    const csv = "\uFEFF" + [headers.join(","), ...csvRows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_")}_${branchName}_${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ─── PDF Export ───────────────────────────────────────────────────────────────

  function exportStockPDF(
    rows: StockBalance[], title: string, branchName: string, isFinished: boolean,
    countMap: Record<number, any>,
    purchaseMap: Record<number, { totalQty: number; totalValue: number; count: number }>,
    transferMap: Record<number, { in: number; out: number }>,
    openingMap: Record<number, number>,
    adjustmentMap: Record<number, { total: number; waste: number }>,
  ) {
    const now = formatDateTime(new Date());
    const currencyLabel = getCurrencyLabel();
    const totalValue = rows.reduce((s, r) => s + assetValue(r), 0);
    const negative = rows.filter(r => r.negative_alert).length;
    const low = rows.filter(r => r.reorder_alert && !r.negative_alert).length;

    const tableRows = rows.map(r => {
      const val = stockValue(r);
      const status = getStatus(r);
      const statusColor = status === "negative" ? "#dc2626" : status === "low" ? "#d97706" : "#16a34a";
      const statusLabel = status === "negative" ? "Negative" : status === "low" ? "Low" : "OK";
      // Movement maps are keyed by ingredient_id, so finished goods must not read them
      const rid = Number((r as any).ingredient_id ?? (r as any).product_id);
      const countData = isFinished ? undefined : countMap[rid];
      const countedQty = countData ? Number(countData.counted_qty ?? 0) : null;
      const countDiff = countData ? Number(countData.delta ?? 0) : null;
      const purchaseData = isFinished ? undefined : purchaseMap[rid];
      const totalPurchased = purchaseData?.totalQty ?? null;
      const transfer = isFinished ? undefined : transferMap[rid];
      const openingQty = isFinished ? null : (openingMap[rid] ?? null);
      const adjustment = isFinished ? undefined : adjustmentMap[rid];
      const expectedUsage = (openingQty ?? 0) + (purchaseData?.totalQty ?? 0) + (transfer?.in ?? 0) - (transfer?.out ?? 0) - r.balance_qty;
      const actualAdj = adjustment?.total ?? 0;
      const variancePct = !isFinished && expectedUsage > 0 ? ((actualAdj / expectedUsage) * 100).toFixed(1) : "—";

      return `<tr>
        <td>${esc(r.name)}</td>
        <td class="num" style="${r.negative_alert ? "color:#dc2626;font-weight:700" : ""}">${r.balance_qty.toFixed(3)} ${esc(r.unit)}</td>
        <td class="num">${(r.reorder_level ?? 0).toFixed(3)}</td>
        <td class="num" style="${val < 0 ? "color:#dc2626" : ""}">${fmtSignedEGP(val)}</td>
        <td class="num" style="background:#eff6ff">${countedQty !== null ? countedQty.toFixed(3) : "—"}</td>
        <td class="num" style="background:#eff6ff;color:${countDiff && countDiff < 0 ? "#dc2626" : "#16a34a"};font-weight:700">
          ${countDiff !== null ? (countDiff >= 0 ? "+" : "") + countDiff.toFixed(3) : "—"}
        </td>
        <td class="num" style="background:#faf5ff">${totalPurchased !== null ? totalPurchased.toFixed(3) : "—"}</td>
        <td class="num" style="background:#f0fdf4">${transfer ? "+" + transfer.in.toFixed(3) : "—"}</td>
        <td class="num" style="background:#f0fdf4">${transfer ? "-" + transfer.out.toFixed(3) : "—"}</td>
        <td class="num" style="background:#fefce8">${openingQty !== null ? openingQty.toFixed(3) : "—"}</td>
        <td class="num" style="background:#fff1f2;color:${actualAdj < 0 ? "#dc2626" : "#64748b"}">${adjustment ? actualAdj.toFixed(3) : "—"}</td>
        <td class="num" style="background:#f0f9ff">${variancePct !== "—" ? variancePct + "%" : "—"}</td>
        <td style="text-align:center">
          <span style="background:${status === "negative" ? "#fee2e2" : status === "low" ? "#fef3c7" : "#dcfce7"};color:${statusColor};padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600">${statusLabel}</span>
        </td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
  <title>${esc(title)} — ${esc(branchName)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;font-size:11px;color:#1e293b;padding:24px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #e2e8f0}
    .badge{display:inline-block;background:${isFinished ? "#ede9fe" : "#dbeafe"};color:${isFinished ? "#6d28d9" : "#1d4ed8"};font-size:9px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:5px;text-transform:uppercase;letter-spacing:.06em}
    .title{font-size:20px;font-weight:800;color:#0f172a;margin-bottom:2px}
    .sub{font-size:11px;color:#64748b}
    .meta{text-align:right;font-size:10px;color:#94a3b8}
    .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px}
    .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px}
    .kpi-label{font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
    .kpi-value{font-size:16px;font-weight:800;color:#0f172a}
    .kpi-value.red{color:#dc2626}.kpi-value.amber{color:#d97706}
    table{width:100%;border-collapse:collapse;font-size:9.5px}
    th{background:#1e293b;color:#f8fafc;padding:7px 8px;text-align:left;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
    .num{text-align:right} th.num{text-align:right} th:last-child{text-align:center}
    td{padding:6px 8px;border-bottom:1px solid #f1f5f9;color:#334155}
    tr:nth-child(even) td{filter:brightness(0.97)}
    .th-blue{background:#1e3a5f}.th-violet{background:#3b0764}.th-green{background:#14532d}.th-yellow{background:#713f12}.th-red{background:#7f1d1d}.th-sky{background:#0c4a6e}
    .footer{margin-top:16px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;text-align:center}
    @media print{body{padding:12px}@page{margin:8mm;size:A3 landscape}}
  </style></head><body>
  <div class="header">
    <div>
      <div class="badge">${isFinished ? "Finished Goods" : "Raw Materials"}</div>
      <div class="title">${esc(title)}</div>
      <div class="sub">Branch: ${esc(branchName)} · ${rows.length} items · Enterprise Costing Report</div>
    </div>
    <div class="meta">Generated: ${now}</div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Total Items</div><div class="kpi-value">${rows.length}</div></div>
    <div class="kpi"><div class="kpi-label">Total Value</div><div class="kpi-value">${fmtEGP(totalValue)}</div></div>
    <div class="kpi"><div class="kpi-label">Negative Stock</div><div class="kpi-value red">${negative}</div></div>
    <div class="kpi"><div class="kpi-label">Low Stock</div><div class="kpi-value amber">${low}</div></div>
    <div class="kpi"><div class="kpi-label">OK Items</div><div class="kpi-value" style="color:#16a34a">${rows.length - negative - low}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">${isFinished ? "Product" : "Ingredient"}</th>
        <th class="num" rowspan="2">Balance</th>
        <th class="num" rowspan="2">Reorder</th>
        <th class="num" rowspan="2">Value (${esc(currencyLabel)})</th>
        <th class="num th-blue" colspan="2">Count Audit</th>
        <th class="num th-violet" colspan="1">Purchases</th>
        <th class="num th-green" colspan="2">Transfers</th>
        <th class="num th-yellow" colspan="1">Opening</th>
        <th class="num th-red" colspan="1">Waste/Adj.</th>
        <th class="num th-sky" colspan="1">Variance %</th>
        <th rowspan="2" style="text-align:center">Status</th>
      </tr>
      <tr>
        <th class="num th-blue">Last Count</th><th class="num th-blue">Diff</th>
        <th class="num th-violet">Total Rcvd</th>
        <th class="num th-green">In</th><th class="num th-green">Out</th>
        <th class="num th-yellow">Opening Qty</th>
        <th class="num th-red">Net Adj.</th>
        <th class="num th-sky">Shrinkage</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="footer">STARK AI Costing System · Enterprise Inventory Report · ${now} · Confidential</div>
  <script>window.onload = () => window.print();</script>
  </body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ─── API helpers ──────────────────────────────────────────────────────────────

  // Postgres NUMERIC often arrives as a string; coerce once at the boundary
  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };

  const periodOf = (date?: string) => (date ?? "").slice(0, 7); // "YYYY-MM"

  function purchasesValueForPeriod(purchases: any[], period: string): number {
    return purchases
      .filter(p => periodOf(p.entry_date) === period)
      .reduce((s, p) => s + Number(p.payable_amount ?? p.gross_amount ?? 0), 0);
  }

  // Opening = closing value of the latest snapshot dated before this period starts
  function openingValueForPeriod(snapshots: PeriodSnapshot[], period: string): number {
    const start = `${period}-01`;
    const prior = snapshots
      .filter(s => (s.entry_date ?? "") < start)
      .sort((a, b) => (b.entry_date ?? "").localeCompare(a.entry_date ?? ""));
    return prior.length ? n(prior[0].closing_value) : 0;
  }

  // Is the period containing `date` open for this branch? Returns an error message, or null if OK.
  // Fails open on network errors: the server remains the real enforcement.
  async function checkDateOpen(branchId: number, date: string): Promise<string | null> {
    const period = periodOf(date);
    if (!period) return null;

    const company = await getPeriodStatus(period).catch(() => null);
    const branch = branchId
      ? await isPeriodClosed(branchId, date).catch(() => null)
      : null;

    const state = company?.status ?? branch?.status ?? "open";
    if (state === "locked" || branch?.is_locked) {
      return `${period} is locked. Entries dated in this period are not allowed. Pick a date in an open period.`;
    }
    if (state === "closed" || branch?.is_closed) {
      return `${period} is closed. Entries dated in this period are not allowed. Pick a date in an open period.`;
    }
    return null;
  }

  // Approved purchases for one month, filtered by the server. Throws on failure.
  async function fetchPurchasesForPeriod(branchId: number | undefined, period: string): Promise<any[]> {
    const [y, m] = period.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const p = new URLSearchParams({
      date_from: `${period}-01`,
      date_to: `${period}-${String(lastDay).padStart(2, "0")}`,
      status: "approved",
      limit: "1000",
    });
    if (branchId) p.set("branch_id", String(branchId));
    return asList(await apiCall<any[]>(`/api/purchases/by-branch?${p}`));
  }

  function normalizeBalance(b: any): StockBalance {
    return {
      ...b,
      balance_qty: n(b.balance_qty),
      reorder_level: n(b.reorder_level),
      // keep null/undefined so the `inventory_value ?? stock_value` fallbacks still work
      inventory_value: b.inventory_value == null ? b.inventory_value : n(b.inventory_value),
      stock_value: b.stock_value == null ? b.stock_value : n(b.stock_value),
    } as StockBalance;
  }

  async function fetchBalances(branchId: number): Promise<StockBalance[]> {
    const rows = await getStockBalances(branchId);
    return (Array.isArray(rows) ? rows : []).map(normalizeBalance);
  }
  async function fetchFGBalances(branchId: number): Promise<StockBalance[]> {
    const rows = await getFinishedGoodsBalances(branchId);
    return (Array.isArray(rows) ? rows : []).map(normalizeBalance);
  }

  const LOAD_ERROR_EVENT = "inventory:load-error";

  // Keeps the old "return a fallback" behaviour, but tells the page whether the load worked
  async function tracked<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      const result = await fn();
      window.dispatchEvent(new CustomEvent(LOAD_ERROR_EVENT, { detail: { label, ok: true } }));
      return result;
    } catch (e) {
      console.error(`[inventory] failed to load ${label}`, e);
      window.dispatchEvent(new CustomEvent(LOAD_ERROR_EVENT, { detail: { label, ok: false } }));
      return fallback;
    }
  }

  const asList = (r: unknown): any[] => (Array.isArray(r) ? r : []);

  function getStockCountsWithPurchases(branchId?: number): Promise<any[]> {
    return tracked("stock counts", async () =>
      asList(await apiCall<any[]>(`/api/stock-counts/with-purchases${branchId ? `?branch_id=${branchId}` : ""}`)), []);
  }
  function getPurchasesByBranch(branchId?: number, limit = 1000): Promise<any[]> {
    return tracked("purchases", async () => {
      const p = new URLSearchParams();
      if (branchId) p.set("branch_id", String(branchId));
      p.set("limit", String(limit));
      return asList(await apiCall<any[]>(`/api/purchases/by-branch?${p}`));
    }, []);
  }
  function getTransfersByBranch(branchId?: number): Promise<any[]> {
    return tracked("transfers", async () =>
      asList(await apiCall<any[]>(`/api/transfers/by-branch${branchId ? `?branch_id=${branchId}` : ""}`)), []);
  }
  function getOpeningStockByBranch(branchId?: number): Promise<any[]> {
    return tracked("opening stock", async () =>
      asList(await apiCall<any[]>(`/api/opening-stock/by-branch${branchId ? `?branch_id=${branchId}` : ""}`)), []);
  }
  function getAdjustmentsByBranch(branchId?: number): Promise<any[]> {
    return tracked("adjustments", async () =>
      asList(await apiCall<any[]>(`/api/stock-adjustments/by-branch${branchId ? `?branch_id=${branchId}` : ""}`)), []);
  }

  function getWasteByBranch(branchId?: number, limit = 2000): Promise<WasteRecord[]> {
    return tracked("waste", async () => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (branchId) p.set("branch_id", String(branchId));
      return asList(await apiCall<WasteRecord[]>(`/api/waste?${p}`)) as WasteRecord[];
    }, [] as WasteRecord[]);
  }
  function getPeriodSnapshots(branchId?: number): Promise<PeriodSnapshot[]> {
    return tracked("period snapshots", async () =>
      asList(await apiCall<PeriodSnapshot[]>(`/api/inventory-period-snapshots${branchId ? `?branch_id=${branchId}` : ""}`)) as PeriodSnapshot[], [] as PeriodSnapshot[]);  }
  async function createPeriodSnapshot(payload: any): Promise<boolean> {
    try { await apiCall("/api/inventory-period-snapshots", { method: "POST", body: JSON.stringify(payload) }); return true; } catch { return false; }
  }
  async function getVarianceMovementsReport(branchId?: number, dateFrom?: string, dateTo?: string): Promise<VarianceRow[]> {
    {
      const p = new URLSearchParams();
      if (branchId) p.set("branch_id", String(branchId));
      if (dateFrom) p.set("date_from", dateFrom);
      if (dateTo) p.set("date_to", dateTo);
      const raw = await apiCall<any[]>(`/api/reports/variance?${p}`);
      return (Array.isArray(raw) ? raw : []).map(r => ({
        ...r,
        theoretical_usage: n(r.theoretical_usage),
        actual_usage: n(r.actual_usage),
        variance: n(r.variance),
        variance_pct: n(r.variance_pct),
        variance_value: n(r.variance_value),
      })) as VarianceRow[];
    }
  }
  async function approveAdjustment(id: number, status: "approved" | "rejected", notes?: string): Promise<boolean> {
    await apiCall(`/api/stock-adjustments/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ status, notes }),
    });
    return true;
  }
  function getAuditLog(branchId?: number, limit = 100): Promise<any[]> {
    return tracked("audit log", async () => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (branchId) p.set("branch_id", String(branchId));
      return asList(await apiCall<any[]>(`/api/audit-log?${p}`));
    }, []);
  }
  // Add new API helper
  function getInventoryMovements(branchId?: number, movementType?: string): Promise<any[]> {
    return tracked(movementType ? "production movements" : "inventory movements", async () => {
      const p = new URLSearchParams();
      if (branchId) p.set("branch_id", String(branchId));
      if (movementType) p.set("movement_type", movementType);
      return asList(await apiCall<any[]>(`/api/inventory-movements/by-branch?${p}`));
    }, []);
  }
  // ─── Modal ────────────────────────────────────────────────────────────────────

  function Modal({ title, subtitle, onClose, onSave, saving, children, wide, cancelLabel, saveLabel }: {
    title: string; subtitle?: string; onClose: () => void; onSave: () => void;
    saving: boolean; children: React.ReactNode; wide?: boolean;
    cancelLabel?: string; saveLabel?: string;
  }) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className={`bg-background rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} border border-border overflow-hidden`}>
          <div className="px-6 py-4 border-b border-border bg-secondary/30">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
                {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">{children}</div>
          <div className="px-6 py-4 border-t border-border bg-secondary/20 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>{cancelLabel ?? "Cancel"}</Button>
            <Button onClick={onSave} disabled={saving} className="min-w-[90px]">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (saveLabel ?? "Save")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function IngredientSelect({ balances, value, onChange, placeholder }: {
    balances: StockBalance[]; value: number; onChange: (id: number) => void; placeholder?: string;
  }) {
    return (
      <select className={inputClass} value={value || ""} onChange={e => onChange(Number(e.target.value))}>
        <option value="">{placeholder ?? "Select ingredient..."}</option>
        {balances.map(b => (
          <option key={b.ingredient_id} value={b.ingredient_id}>
            {b.name} ({b.balance_qty.toFixed(2)} {b.unit})
          </option>
        ))}
      </select>
    );
  }
  function CountPreviewAlert({ balance, countedQty, t }: { 
    balance?: StockBalance; 
    countedQty: number; 
    t: (k: string) => string 
  }) {
    if (!balance) return null;

    const systemBalance = balance.balance_qty;
    const delta = countedQty - systemBalance;
    const deltaPercent = systemBalance !== 0 ? (delta / systemBalance) * 100 : 0;
    const absDeltaPct = Math.abs(deltaPercent);

    // Risk Level
    let riskLevel: "ok" | "warning" | "critical" = "ok";
    let riskColor = "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800";
    let riskBg = "bg-green-100 dark:bg-green-900/40";
    let riskText = "text-green-700 dark:text-green-300";
    let riskIcon = <CheckCircle className="w-4 h-4" />;
    let riskLabel = "Balanced";

    if (absDeltaPct > 20 || Math.abs(delta) > 50) {
      riskLevel = "critical";
      riskColor = "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
      riskBg = "bg-red-100 dark:bg-red-900/40";
      riskText = "text-red-700 dark:text-red-300";
      riskIcon = <AlertTriangle className="w-4 h-4" />;
      riskLabel = "Critical Variance";
    } else if (absDeltaPct > 5 || Math.abs(delta) > 10) {
      riskLevel = "warning";
      riskColor = "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800";
      riskBg = "bg-amber-100 dark:bg-amber-900/40";
      riskText = "text-amber-700 dark:text-amber-300";
      riskIcon = <AlertCircle className="w-4 h-4" />;
      riskLabel = "Warning: Variance Detected";
    }

    return (
      <div className={`border rounded-lg p-4 ${riskColor}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`${riskBg} ${riskText} p-1.5 rounded-lg`}>
            {riskIcon}
          </div>
          <span className={`font-semibold text-sm ${riskText}`}>{riskLabel}</span>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs mb-3">
          {/* System Balance */}
          <div className="bg-background rounded-lg px-3 py-2 border border-border">
            <p className="text-muted-foreground font-medium mb-0.5">System Balance</p>
            <p className="font-bold text-foreground text-sm">{systemBalance.toFixed(3)}</p>
            <p className="text-muted-foreground text-[10px] mt-0.5">{balance.unit}</p>
          </div>

          {/* Counted Qty */}
          <div className="bg-background rounded-lg px-3 py-2 border border-border">
            <p className="text-muted-foreground font-medium mb-0.5">Physical Count</p>
            <p className="font-bold text-foreground text-sm">{countedQty.toFixed(3)}</p>
            <p className="text-muted-foreground text-[10px] mt-0.5">{balance.unit}</p>
          </div>

          {/* Variance */}
          <div className={`rounded-lg px-3 py-2 border ${
            delta === 0 ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" :
            delta > 0 ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800" :
            "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
          }`}>
            <p className="text-muted-foreground font-medium mb-0.5">Variance</p>
            <p className={`font-bold text-sm ${
              delta === 0 ? "text-green-600" :
              delta > 0 ? "text-blue-600" : "text-red-600"
            }`}>
              {delta >= 0 ? "+" : ""}{delta.toFixed(3)}
            </p>
            <p className="text-[10px] mt-0.5 font-semibold">{fmtPct(deltaPercent)}</p>
          </div>
        </div>

        {/* Impact Analysis */}
        <div className={`text-xs px-3 py-2 rounded-lg ${riskBg} border ${riskColor}`}>
          {delta === 0 ? (
            <p className={riskText}>✓ Physical count matches system. No adjustment needed.</p>
          ) : delta > 0 ? (
            <p className={riskText}>
              📈 Surplus found: You have <strong>{Math.abs(delta).toFixed(3)} {balance.unit}</strong> more than recorded.
              {riskLevel === "critical" && " ⚠️ This is unusual—verify before confirming."}
            </p>
          ) : (
            <p className={riskText}>
              📉 Shortage detected: You have <strong>{Math.abs(delta).toFixed(3)} {balance.unit}</strong> less than recorded.
              {riskLevel === "critical" && " 🚨 This requires investigation!"}
            </p>
          )}
        </div>

        {riskLevel === "critical" && (
          <div className="mt-3 p-2 bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 rounded-lg">
            <p className="text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Large variance detected. Please <strong>double-check your count</strong> before confirming. If correct, add notes explaining the difference.
              </span>
            </p>
          </div>
        )}
      </div>
    );
  }
  // ─── Status Badge ─────────────────────────────────────────────────────────────

  function StatusBadge({ status, t }: { status: "pending" | "approved" | "rejected"; t: (k: string) => string }) {
    const map = {
      pending:  { cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300", icon: <Clock className="w-3 h-3" /> },
      approved: { cls: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300", icon: <CheckCircle className="w-3 h-3" /> },
      rejected: { cls: "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300",         icon: <XCircle className="w-3 h-3" /> },
    };
    const labelMap = {
      pending:  "approval.pending",
      approved: "common.approve",
      rejected: "common.reject",
    };
    const { cls, icon } = map[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
        {icon}{t(labelMap[status])}
      </span>
    );
  }

  // ─── Delta Badge ──────────────────────────────────────────────────────────────

  function DeltaBadge({ value, unit, showPct, pct }: { value: number; unit?: string; showPct?: boolean; pct?: number }) {
    if (value === 0) return <span className="text-green-600 font-mono text-xs">✓ 0.000</span>;
    const isPos = value > 0;
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className={`inline-flex items-center gap-0.5 font-mono text-xs font-bold ${isPos ? "text-green-600" : "text-red-600"}`}>
          {isPos ? "▲" : "▼"} {isPos ? "+" : ""}{value.toFixed(3)}
          {unit && <span className="font-normal text-muted-foreground ml-0.5">{unit}</span>}
        </span>
        {showPct && pct !== undefined && Math.abs(pct) > 0.1 && (
          <span className={`text-[10px] font-semibold ${Math.abs(pct) > 10 ? "text-red-600" : Math.abs(pct) > 5 ? "text-amber-600" : "text-muted-foreground"}`}>
            {fmtPct(pct)}
          </span>
        )}
      </div>
    );
  }


  // ─── KPI Card ─────────────────────────────────────────────────────────────────

  function KpiCard({ label, value, sub, color, icon, trend, trendLabel }: {
    label: string; value: string; sub?: string; color: string; icon: React.ReactNode; trend?: number; trendLabel?: string;
  }) {
    return (
      <Card className="p-4 relative overflow-hidden">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1.5 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color.replace("text-", "bg-").replace("-600", "-100").replace("-700", "-100")} dark:bg-white/10`}>
            {icon}
          </div>
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)}% {trendLabel ?? "vs last period"}
          </div>
        )}
      </Card>
    );
  }

  // ─── Approval Panel ───────────────────────────────────────────────────────────

  function ApprovalPanel({ adjustments, onApprove, onReject, loading, dismissedIds, t }: {
    adjustments: AdjustmentRecord[];
    onApprove: (id: number, notes: string) => Promise<void>;
    onReject: (id: number, notes: string) => Promise<void>;
    loading: boolean;
    dismissedIds: Set<number>;
    t: (k: string) => string;
  }) {
    const [processingId, setProcessingId] = useState<number | null>(null);
    const [approvalNote, setApprovalNote] = useState<Record<number, string>>({});
    const [errors, setErrors] = useState<Record<number, string>>({});

    const pending = adjustments.filter(a => a.status === "pending");
    const visible = pending.filter(a => !dismissedIds.has(a.id));

    async function handle(id: number, action: "approved" | "rejected") {
      setProcessingId(id);
      setErrors(prev => { const { [id]: _removed, ...rest } = prev; return rest; });
      try {
        if (action === "approved") await onApprove(id, approvalNote[id] ?? "");
        else await onReject(id, approvalNote[id] ?? "");
      } catch (e) {
        const detail = e instanceof Error && e.message ? ` (${e.message})` : "";
        setErrors(prev => ({
          ...prev,
          [id]: `Could not ${action === "approved" ? "approve" : "reject"} this adjustment${detail}. Check that the period is open and you have permission, then try again.`,
        }));
      } finally {
        setProcessingId(null);
      }
    }

    if (loading) return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-secondary/40 rounded-xl animate-pulse" />)}
      </div>
    );

    if (!visible.length) return (
      <div className="py-16 text-center">
        <CheckCircle className="w-12 h-12 text-green-500/30 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">{t("inv.approvals.empty")}</p>
        <p className="text-xs text-muted-foreground mt-1">{t("inv.approvals.emptySub")}</p>
      </div>
    );

    return (
      <div className="space-y-3">
        {visible.map(adj => (
          <div key={adj.id} className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
            <div className="mb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="font-semibold text-sm text-foreground truncate">{adj.ingredient_name}</span>
                  <StatusBadge status="pending" t={t} />
                </div>
                <div className={`text-sm font-bold font-mono flex-shrink-0 ${adj.quantity_delta < 0 ? "text-red-600" : "text-green-600"}`}>
                  {adj.quantity_delta >= 0 ? "+" : ""}{adj.quantity_delta.toFixed(3)} {adj.unit}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {adj.entry_date} · {t("inv.audit.by")} {adj.user_name}
              </p>
            </div>

            {adj.notes && (
              <p className="text-xs bg-white dark:bg-white/5 border border-amber-100 dark:border-amber-800 rounded-lg px-3 py-2 mb-3 text-foreground/70">
                {adj.notes}
              </p>
            )}

            <div className="space-y-2">
              <input
                type="text"
                placeholder={t("inv.approvals.notePlaceholder")}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-background focus:outline-none focus:ring-2 focus:ring-amber-300 dark:focus:ring-amber-700 text-foreground placeholder:text-muted-foreground"
                value={approvalNote[adj.id] ?? ""}
                onChange={e => setApprovalNote(n => ({ ...n, [adj.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  disabled={processingId !== null}
                  onClick={() => handle(adj.id, "approved")}
                >
                  {processingId === adj.id
                    ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                    : <CheckCircle className="w-3 h-3 mr-1" />}
                  {t("inv.approvals.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                  disabled={processingId !== null}
                  onClick={() => handle(adj.id, "rejected")}
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  {t("inv.approvals.reject")}
                </Button>
              </div>
              {errors[adj.id] && (
                <p role="alert" className="text-xs text-red-600 flex items-start gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  <span>{errors[adj.id]}</span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ─── Variance Report ──────────────────────────────────────────────────────────

  function VarianceReport({ branchId, balances, fgBalances, t }: {
    branchId: number;
    balances: StockBalance[];
    fgBalances: StockBalance[];
    t: (k: string) => string;
  }) {
    const [dateFrom, setDateFrom] = useState(() => `${today().slice(0, 8)}01`);
    const [dateTo, setDateTo] = useState(today);
    const [rows, setRows] = useState<VarianceRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [ran, setRan] = useState(false);
    const [error, setError] = useState("");

    async function runReport() {
      setLoading(true);
      setError("");
      try {
        const result = await getVarianceMovementsReport(branchId, dateFrom, dateTo);
        setRows(result);
        setRan(true);
      } catch (e) {
        console.error("[variance] load failed", e);
        setRows([]);
        setRan(false);
        setError("Could not load the variance report. Nothing was calculated, so this is not a 'no variance' result. Try again.");
      } finally {
        setLoading(false);
      }
    }

    // Finished goods: only negative stock is a variance signal. This is a snapshot as of
    // today and does not follow the date range (there is no FG movement history here).
    const fgVarianceRows = useMemo<VarianceRow[]>(() => {
      return fgBalances
        .filter(b => b.balance_qty < 0)
        .map(b => ({
          kind:              "fg" as const,
          ingredient_id:     Number((b as any).product_id ?? b.ingredient_id),
          name:              b.name,
          unit:              b.unit,
          theoretical_usage: 0,
          actual_usage:      b.balance_qty,
          variance:          b.balance_qty,
          variance_pct:      -100,
          variance_value:    Math.abs(stockValue(b)),
        }));
    }, [fgBalances]);

    const displayRows = useMemo(() => {
      if (!ran) return [];
      const ingredientRows = rows.map(r => ({ ...r, kind: "ingredient" as const }));
      return [...fgVarianceRows, ...ingredientRows].sort((a, b) => Math.abs(b.variance_pct) - Math.abs(a.variance_pct));
    }, [ran, rows, fgVarianceRows]);

    const totalShrinkageValue = displayRows.reduce((s, r) => s + (r.variance < 0 ? Math.abs(r.variance_value) : 0), 0);
    const highShrinkage = displayRows.filter(r => r.variance_pct < -10).length;
    const ingRows = displayRows.filter(r => r.kind !== "fg");
    const avgAbsPct = ingRows.length
      ? ingRows.reduce((s, r) => s + Math.abs(r.variance_pct), 0) / ingRows.length
      : 0;

    return (
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">{t("inv.variance.period")}</span>
              <input type="date" className={inputClass + " w-auto"} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-muted-foreground">→</span>
              <input type="date" className={inputClass + " w-auto"} value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <Button onClick={runReport} disabled={loading} className="ml-auto">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <BarChart2 className="w-4 h-4 mr-2" />}
              {t("inv.variance.run")}
            </Button>
          </div>
          {ran && (
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
              <span>{t("inv.variance.info")}</span>
              <span className="text-violet-600 dark:text-violet-400">
                Finished goods with negative stock are shown as of today and ignore the date range.
              </span>
            </div>
          )}
        </Card>

        {error && (
          <p role="alert" className="text-xs text-red-600 flex items-start gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />{error}
          </p>
        )}
        {ran && displayRows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={t("inv.variance.analyzed")}       value={String(displayRows.length)}      color="text-blue-600"   icon={<Package className="w-5 h-5 text-blue-600" />} />
            <KpiCard label={t("inv.variance.highShrinkage")}  value={String(highShrinkage)}            color="text-red-600"    icon={<TrendingDown className="w-5 h-5 text-red-600" />} sub={t("inv.variance.highShrinkageSub")} />
            <KpiCard label={t("inv.variance.totalValue")}     value={fmtEGP(totalShrinkageValue)}      color="text-red-600"    icon={<AlertTriangle className="w-5 h-5 text-red-600" />} />
            <KpiCard label={t("inv.variance.avg")}            value={`${avgAbsPct.toFixed(1)}%`} color="text-amber-600" icon={<Percent className="w-5 h-5 text-amber-600" />} />
          </div>
        )}

        {!ran ? (
          <div className="py-20 text-center">
            <BarChart2 className="w-14 h-14 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm font-medium text-muted-foreground">{t("inv.variance.empty")}</p>
          </div>
        ) : loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-secondary/40 rounded-xl animate-pulse" />)}</div>
        ) : displayRows.length === 0 ? (
          <div className="py-16 text-center">
            <CheckCircle className="w-12 h-12 text-green-500/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{t("inv.variance.noData")}</p>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/70 border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("inv.variance.col.item")}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("inv.variance.col.type")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.variance.col.theoretical")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.variance.col.actual")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.variance.col.variance")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.variance.col.variancePct")}</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.variance.col.valueAtRisk")}</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-foreground">{t("inv.variance.col.risk")}</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const absVPct = Math.abs(row.variance_pct);
                    const risk = absVPct > 20 ? "critical" : absVPct > 10 ? "high" : absVPct > 5 ? "medium" : "low";
                    const riskMap = {
                      critical: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
                      high:     "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
                      medium:   "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
                      low:      "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
                    };
                    const riskLabelKey: Record<string, string> = {
                      critical: "inv.variance.risk.critical",
                      high:     "inv.variance.risk.high",
                      medium:   "inv.variance.risk.medium",
                      low:      "inv.variance.risk.low",
                    };
                    const isFG = row.kind === "fg";
                    const displayName = row.name;

                    return (
                      <tr key={`${isFG ? "fg" : "ing"}-${row.ingredient_id}`} className={`border-b border-border hover:bg-secondary/30 ${isFG ? "bg-red-50/20 dark:bg-red-950/10" : ""}`}>
                        <td className="px-4 py-3 font-medium text-foreground">{displayName}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${isFG ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"}`}>
                            {isFG ? t("inv.variance.type.fg") : t("inv.variance.type.ingredient")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {row.theoretical_usage.toFixed(3)} <span className="text-muted-foreground text-xs">{row.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {row.actual_usage.toFixed(3)} <span className="text-muted-foreground text-xs">{row.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DeltaBadge value={row.variance} unit={row.unit} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-bold ${row.variance_pct < -10 ? "text-red-600" : row.variance_pct < -5 ? "text-amber-600" : "text-green-600"}`}>
                            {fmtPct(row.variance_pct)}
                          </span>
                          <div className="w-full max-w-16 h-1 bg-secondary rounded-full overflow-hidden mt-1 ml-auto">
                            <div className={`h-full rounded-full ${row.variance_pct < 0 ? "bg-red-500" : "bg-green-500"}`}
                              style={{ width: `${Math.min(100, absVPct * 3)}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold">
                          {row.variance < 0 ? fmtEGP(Math.abs(row.variance_value)) : "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${riskMap[risk]}`}>
                            {t(riskLabelKey[risk])}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ─── COGS Panel ───────────────────────────────────────────────────────────────

  function CogsPanel({ snapshots, balances, purchases, branchId, t }: {
    snapshots: PeriodSnapshot[];
    balances: StockBalance[];
    purchases: any[];
    branchId: number;
    t: (k: string) => string;
  }) {
    const [period, setPeriod] = useState(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    const [filteredPurchases, setFilteredPurchases] = useState<any[]>([]);
    const [purchState, setPurchState] = useState<"loading" | "ok" | "error">("loading");
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
      if (!period) { setFilteredPurchases([]); setPurchState("ok"); return; }
      let cancelled = false;
      setPurchState("loading");
      fetchPurchasesForPeriod(branchId || undefined, period)
        .then(rows => { if (!cancelled) { setFilteredPurchases(rows); setPurchState("ok"); } })
        .catch(e => { console.error("[cogs] purchases load failed", e); if (!cancelled) setPurchState("error"); });
      return () => { cancelled = true; };
    }, [branchId, period, reloadKey]);

    const totalCurrentValue   = balances.reduce((s, b) => s + assetValue(b), 0);
    const totalPurchasesValue = filteredPurchases.reduce((s, p) => s + Number(p.payable_amount ?? p.gross_amount ?? 0), 0);
    const openingValue  = openingValueForPeriod(snapshots, period);
    const estimatedCOGS = openingValue + totalPurchasesValue - totalCurrentValue;

    if (purchState === "error") {
      return (
        <Card className="p-10 text-center">
          <AlertCircle className="w-10 h-10 text-red-500/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Could not load purchases for {period}</p>
          <p className="text-xs text-muted-foreground mt-1">COGS would be wrong without them.</p>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => setReloadKey(k => k + 1)}>
            <RefreshCw className="w-3 h-3 mr-1" /> Retry
          </Button>
        </Card>
      );
    }

    if (!snapshots.length) {
      return (
        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">{t("inv.cogs.period")}</span>
              <input type="month" className={inputClass + " w-auto"} value={period} onChange={e => setPeriod(e.target.value)} />
              <span className="text-xs text-muted-foreground ml-2">{t("inv.cogs.showing").replace("{period}", period)}</span>
            </div>
          </Card>

          <Card className="p-5 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t("inv.cogs.noSnapshots")}</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t("inv.cogs.noSnapshotsSub")}</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t("inv.cogs.formula")}</p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label={t("inv.cogs.currentInv")}              value={fmtEGP(totalCurrentValue)}          color="text-blue-600"   icon={<Package className="w-5 h-5 text-blue-600" />} />
            <KpiCard label={t("inv.cogs.purchases").replace("{period}", period)} value={fmtEGP(totalPurchasesValue)}        color="text-violet-600" icon={<ShoppingCart className="w-5 h-5 text-violet-600" />} />
            <KpiCard label={t("inv.cogs.estimated")}               value={fmtEGP(Math.max(0, estimatedCOGS))} color="text-amber-600"  icon={<BarChart2 className="w-5 h-5 text-amber-600" />} sub={t("inv.cogs.estimatedSub")} />
          </div>

          <Card className="p-5">
            <h3 className="font-semibold text-sm text-foreground mb-4 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              {t("inv.cogs.calcTitle").replace("{period}", period)}
            </h3>
            <div className="space-y-3">
              {[
                { label: t("inv.cogs.opening"),      value: openingValue > 0 ? fmtEGP(openingValue) : "—",                                    note: openingValue > 0 ? t("inv.cogs.openingNote") : t("inv.cogs.openingNone"), color: "text-blue-600",   bold: false },
                { label: t("inv.cogs.plusPurchases"), value: fmtEGP(totalPurchasesValue),                                                       note: t("inv.cogs.purchasesNote").replace("{n}", String(filteredPurchases.length)).replace("{period}", period), color: "text-violet-600", bold: false },
                { label: t("inv.cogs.minusClosing"),  value: fmtEGP(totalCurrentValue),                                                         note: t("inv.cogs.closingNote"),                                                color: "text-green-600",  bold: false },
                { label: t("inv.cogs.result"),        value: openingValue > 0 ? fmtEGP(Math.max(0, estimatedCOGS)) : "—",                      note: openingValue > 0 ? t("inv.cogs.resultNote") : t("inv.cogs.resultNone"),  color: "text-amber-600",  bold: true  },
              ].map(item => (
                <div key={item.label} className={`flex items-center justify-between py-2.5 px-4 rounded-lg ${item.bold ? "bg-secondary/60 border border-border" : "bg-secondary/20"}`}>
                  <div>
                    <span className={`text-sm ${item.bold ? "font-bold" : "font-medium"} text-foreground`}>{item.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">{item.note}</span>
                  </div>
                  <span className={`text-sm font-bold font-mono ${item.color}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">{t("inv.cogs.period")}</span>
            <input type="month" className={inputClass + " w-auto"} value={period} onChange={e => setPeriod(e.target.value)} />
          </div>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard label={t("inv.cogs.currentInv2")}                                       value={fmtEGP(totalCurrentValue)}          color="text-blue-600"   icon={<Package className="w-5 h-5 text-blue-600" />} />
          <KpiCard label={t("inv.cogs.purchases").replace("{period}", period)}              value={fmtEGP(totalPurchasesValue)}        color="text-violet-600" icon={<ShoppingCart className="w-5 h-5 text-violet-600" />} />
          <KpiCard label={t("inv.cogs.estThisPeriod")}                                     value={openingValue > 0 ? fmtEGP(Math.max(0, estimatedCOGS)) : "—"} color="text-amber-600"  icon={<BarChart2 className="w-5 h-5 text-amber-600" />} sub={openingValue > 0 ? undefined : "No prior closing snapshot for this period"} />
          <KpiCard label={t("inv.cogs.lockedPeriods")}                                     value={String(snapshots.length)}           color="text-green-600"  icon={<Lock className="w-5 h-5 text-green-600" />} />
        </div>

        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-secondary/20">
            <h3 className="font-semibold text-sm text-foreground">{t("inv.cogs.history")}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  <th className="px-4 py-3 text-left  text-xs font-semibold text-foreground">{t("inv.cogs.col.period")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.cogs.col.openingInv")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.cogs.col.purchases")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.cogs.col.closingInv")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.cogs.col.cogs")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.cogs.col.lockedBy")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("inv.cogs.col.date")}</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(s => {
                  const available = n(s.opening_value) + n(s.purchases_value);
                  const cogsIsHigh = available > 0 && n(s.cogs) > available * 0.8;
                  return (
                    <tr key={s.id} className="border-b border-border hover:bg-secondary/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Lock className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium text-foreground">{s.period_label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{fmtEGP(s.opening_value)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-violet-600">+{fmtEGP(s.purchases_value)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-green-600">−{fmtEGP(s.closing_value)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${cogsIsHigh ? "text-red-600" : "text-foreground"}`}>
                        {fmtEGP(s.cogs)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{s.locked_by}</td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">{s.entry_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  // ─── Audit Log Panel ──────────────────────────────────────────────────────────

  function AuditLogPanel({ branchId, t }: { branchId: number; t: (k: string) => string }) {
    const { data: logs, loading } = useApi<any[]>(
      () => getAuditLog(branchId || undefined),
      { deps: [branchId] }
    );
    const [search, setSearch] = useState("");
    const [actionFilter, setActionFilter] = useState("all");

    const safeLog = logs ?? [];

    function getGroup(action: string): string {
      if (!action) return "other";
      if (action.includes("create") || action.includes("snapshot")) return "create";
      if (action.includes("approve")) return "approve";
      if (action.includes("reject"))  return "reject";
      if (action.includes("close"))   return "close";
      if (action.includes("adjustment")) return "adjustment";
      return "other";
    }

    function humanAction(action: string): string {
      const map: Record<string, string> = {
        create:                 t("inv.audit.human.create"),
        approve:                t("inv.audit.human.approve"),
        reject:                 t("inv.audit.human.reject"),
        close_period:           t("inv.audit.human.close_period"),
        adjustment:             t("inv.audit.human.adjustment"),
        adjustment_approved:    t("inv.audit.human.adjustment_approved"),
        adjustment_rejected:    t("inv.audit.human.adjustment_rejected"),
        create_period_snapshot: t("inv.audit.human.create_period_snapshot"),
        set_period_status:      "Set Period Status",
      };
      return map[action] ?? action?.replace(/_/g, " ") ?? "—";
    }
    function auditSummary(log: any): string[] {
      const fmt = (v: any) => (typeof v === "number" ? v.toLocaleString() : String(v));
      if (log.details) return [String(log.details)];
      let d = log.new_data ?? log.old_data;
      if (typeof d === "string") {
        try { d = JSON.parse(d); } catch { return []; }
      }
      if (!d || typeof d !== "object") return [];

      const n = log.names ?? {};
      const parts: string[] = [];

      const item =
        n.ingredient_id ?? d.name ?? d.item_name ?? d.supplier_name ??
        d.po_number ?? d.invoice_number ?? d.description;
      if (item) parts.push(String(item));

      const qty = d.quantity ?? d.qty_issued ?? d.qty;
      if (qty != null) parts.push(`Qty ${fmt(qty)}`);

      const amount = d.total_amount ?? d.total ?? d.amount;
      if (amount != null) parts.push(`Amount ${fmt(amount)}`);

      if (d.from_branch_id != null && d.to_branch_id != null) {
        parts.push(
          `${n.from_branch_id ?? `Branch ${d.from_branch_id}`} → ${n.to_branch_id ?? `Branch ${d.to_branch_id}`}`
        );
      } else if (n.branch_id) {
        parts.push(n.branch_id);
      }

      if (d.issued_to) parts.push(`Issued to ${String(d.issued_to).replace(/_/g, " ")}`);
      if (d.manager)   parts.push(`Manager ${d.manager}`);
      if (d.location)  parts.push(String(d.location));
      if (d.status)    parts.push(String(d.status));
      if (d.reason)    parts.push(String(d.reason));

      return parts.slice(0, 5);
    }
    function humanEntity(entityType: string, entityId?: number | string | null): string {
      const map: Record<string, string> = {
        // existing entries (singular + plural so both match)
        sale:                       t("inv.audit.entity.sale"),
        sales:                      t("inv.audit.entity.sale"),
        purchase:                   t("inv.audit.entity.purchase"),
        purchases:                  t("inv.audit.entity.purchase"),
        transfer:                   t("inv.audit.entity.transfer"),
        transfers:                  t("inv.audit.entity.transfer"),
        approval_request:           t("inv.audit.entity.approval_request"),
        approval_requests:          t("inv.audit.entity.approval_request"),
        inventory_movement:         t("inv.audit.entity.inventory_movement"),
        period_closure:             t("inv.audit.entity.period_closure"),
        period_closures:            t("inv.audit.entity.period_closure"),
        period_snapshot:            t("inv.audit.entity.period_snapshot"),
        period_snapshots:           t("inv.audit.entity.period_snapshot"),
        company_period_status:      "Period Status",
        company_period_statuses:    "Period Status",
        customer_return:            t("inv.audit.entity.customer_return"),
        purchase_return:            t("inv.audit.entity.purchase_return"),
        purchase_returns:           t("inv.audit.entity.purchase_return"),

        // procurement
        cash_purchases:             "Cash Purchase",
        purchase_invoices:          "Purchase Invoice",
        goods_receipts:             "Goods Receipt",
        petty_cash_ledger:          "Petty Cash Entry",
        supplier_price_history:     "Supplier Price",
        suppliers:                  "Supplier",

        // inventory
        ingredients:                "Ingredient",
        products:                   "Product",
        sku_prefixes:               "SKU Prefix",
        stock_adjustments:          "Stock Adjustment",
        stock_counts:               "Stock Count",
        stock_issues:               "Stock Issue",
        waste_log:                  "Waste Entry",
        waste_records:              "Waste Record",
        damage_log:                 "Damage Entry",
        inventory_period_snapshots: "Inventory Snapshot",

        // production
        recipes:                    "Recipe",
        recipe_ingredients:         "Recipe Ingredient",
        production_costs:           "Production Cost",

        // finance
        expenses:                   "Expense",
        expense_categories:         "Expense Category",
        revenues:                   "Revenue",
        budgets:                    "Budget",
        payroll_entries:            "Payroll Entry",
        prepayment_entries:         "Prepayment",

        // administration
        app_users:                  "User",
        roles:                      "Role",
        role_permissions:           "Role Permissions",
        user_permissions:           "User Permissions",
        user_branches:              "User Branches",
        branches:                   "Branch",
        companies:                  "Company",
      };
      const label =
        map[entityType] ??
        (entityType
          ? entityType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
          : t("inv.audit.entity.record"));
      const hasId = entityId !== null && entityId !== undefined && String(entityId).trim() !== "";
      return hasId ? `${label} #${entityId}` : label;
    }

    const ACTION_FILTERS = ["all", "create", "approve", "reject", "adjustment", "close"];
    const filterLabelMap: Record<string, string> = {
      all:        "inv.audit.action.all",
      create:     "inv.audit.action.create",
      approve:    "inv.audit.action.approve",
      reject:     "inv.audit.action.reject",
      adjustment: "inv.audit.action.adjustment",
      close:      "inv.audit.action.close",
    };

    const groupColorMap: Record<string, { badge: string; dot: string }> = {
      create:     { badge: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300",     dot: "bg-green-500"  },
      approve:    { badge: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300",         dot: "bg-blue-500"   },
      reject:     { badge: "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300",             dot: "bg-red-500"    },
      close:      { badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300",     dot: "bg-amber-500"  },
      adjustment: { badge: "bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-300", dot: "bg-violet-500" },
      other:      { badge: "bg-secondary text-muted-foreground",                                        dot: "bg-muted-foreground/40" },
    };
    

    const filtered = safeLog.filter(l => {
      const group = getGroup(l.action ?? "");
      const matchesAction = actionFilter === "all" || group === actionFilter || l.action === actionFilter;
      const matchesSearch = !search || JSON.stringify(l).toLowerCase().includes(search.toLowerCase());
      return matchesAction && matchesSearch;
    });

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder={t("inv.audit.searchPlaceholder")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {ACTION_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setActionFilter(f)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors capitalize ${
                  actionFilter === f
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:bg-secondary"
                }`}
              >
                {t(filterLabelMap[f])}
              </button>
            ))}
          </div>
        </div>

        {!loading && safeLog.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground px-1">
            <span>{t("inv.audit.total").replace("{n}", String(safeLog.length))}</span>
            <span>·</span>
            <span>{t("inv.audit.shown").replace("{n}", String(filtered.length))}</span>
            {safeLog[0]?.created_at && (
              <>
                <span>·</span>
                <span>{t("inv.audit.latest")} {formatDateTime(safeLog[0].created_at)}</span>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-secondary/40 rounded-xl animate-pulse" />)}
          </div>
        ) : !safeLog.length ? (
          <div className="py-20 text-center">
            <History className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">{t("inv.audit.empty")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("inv.audit.emptySub")}</p>
          </div>
        ) : !filtered.length ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("inv.audit.noMatch")}</p>
            <button className="text-xs text-primary hover:underline mt-2" onClick={() => { setSearch(""); setActionFilter("all"); }}>
              {t("inv.audit.clearFilters")}
            </button>
          </div>
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {filtered.slice(0, 100).map((log, i) => {
                const group = getGroup(log.action ?? "");
                const colors = groupColorMap[group] ?? groupColorMap.other;
                const dateStr = log.created_at ? formatDate(log.created_at, { day: "2-digit", month: "short", year: "numeric" }) : "—";
                const timeStr = log.created_at ? formatDateTime(log.created_at, { hour: "2-digit", minute: "2-digit" }) : "";
                const entityType = log.entity_type ?? log.table_name;
                const summary = auditSummary(log);

                return (
                  <div key={log.id ?? i} className="flex items-start gap-4 px-5 py-3.5 hover:bg-secondary/30 transition-colors">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${colors.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors.badge}`}>
                          {humanAction(log.action)}
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          {humanEntity(entityType, log.entity_id ?? log.record_id)}
                        </span>
                      </div>
                      {summary.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {summary.map((part, idx) => (
                            <span
                              key={idx}
                              dir="auto"
                              className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground capitalize"
                            >
                              {part}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        {log.user_name && (
                          <span className="text-xs text-muted-foreground">
                            {t("inv.audit.by")} <span className="font-medium text-foreground">{log.user_name}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-muted-foreground">{dateStr}</p>
                      <p className="text-xs text-muted-foreground/60">{timeStr}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {filtered.length > 100 && (
              <div className="px-5 py-3 border-t border-border bg-secondary/20 text-center">
                <p className="text-xs text-muted-foreground">{t("inv.audit.showing").replace("{n}", String(filtered.length))}</p>
              </div>
            )}
          </Card>
        )}
      </div>
    );
  }

    // ─── PO Generator Modal ───────────────────────────// Latest approved quote from this supplier for this ingredient.
  // Same lookup Procurement's "New Purchase" modal uses.
  async function resolveUnitCost(ingredientId: number, supplierId: number): Promise<number | null> {
    try {
      const prices = await apiCall<any[]>(`/api/suppliers/price-history/${ingredientId}`);
      const approved = (Array.isArray(prices) ? prices : []).find(
        p => Number(p.supplier_id) === supplierId && p.status === "approved"
      );
      const price = approved ? Number(approved.price) : 0;
      return price > 0 ? price : null;
    } catch {
      return null;
    }
  }

  function POGeneratorModal({
  balances, branches, onClose, t, branchId, onPurchasesCreated,
}: {
  balances: StockBalance[];
  branches: Branch[];
  onClose: () => void;
  t: (k: string) => string;
  branchId: number;
  onPurchasesCreated?: () => void;
}) {
  const alertItems = useMemo(
    () => balances
      .filter(b => b.negative_alert || b.reorder_alert)
      .sort((a, b) => Number(b.negative_alert) - Number(a.negative_alert)),
    [balances]
  );

  const suggestQty = (b: StockBalance) =>
    Number(Math.max(0, (b.reorder_level ?? 0) * 1.5 - b.balance_qty).toFixed(3));
  const noteFor = (b?: StockBalance) =>
    b ? `Auto-generated from low stock alert - Reorder level: ${(b.reorder_level ?? 0).toFixed(3)} ${b.unit}` : "";

  const first = alertItems[0];
  const [form, setForm] = useState({
    branch_id: branchId,
    supplier_id: 0,
    item_id: first?.ingredient_id ?? 0,
    entry_date: today(),
    quantity: first ? suggestQty(first) : 0,
    unit_cost: 0,
    tax_amount: 0,
    notes: noteFor(first),
  });
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [masterItems, setMasterItems] = useState<any[]>([]);
  const [costHint, setCostHint] = useState<"" | "quote" | "master" | "none">("");
  const [ordered, setOrdered] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    (async () => {
      try { setSuppliers(((await getSuppliers()) as any[]) ?? []); } catch { setSuppliers([]); }
      try { setMasterItems((await apiCall<any[]>("/api/ingredients")) ?? []); } catch { setMasterItems([]); }
    })();
  }, []);

  // Same pricing rule as Procurement: supplier's latest approved quote,
  // otherwise the item's master cost. The field stays editable.
  useEffect(() => {
    if (!form.item_id) return;
    let cancelled = false;
    (async () => {
      const master = Number(masterItems.find(i => Number(i.id) === form.item_id)?.cost_per_unit ?? 0);
      let cost = 0;
      let hint: "" | "quote" | "master" | "none" = form.supplier_id ? "none" : "";
      if (form.supplier_id) {
        const quote = await resolveUnitCost(form.item_id, form.supplier_id);
        if (quote) { cost = quote; hint = "quote"; }
      }
      if (!cost && master > 0) { cost = master; hint = "master"; }
      if (!cancelled) { setForm(f => ({ ...f, unit_cost: cost })); setCostHint(hint); }
    })();
    return () => { cancelled = true; };
  }, [form.item_id, form.supplier_id, masterItems]);

  function pickItem(id: number) {
    const b = balances.find(x => x.ingredient_id === id);
    const isAlert = !!b && (b.negative_alert || b.reorder_alert);
    setInfo("");
    setForm(f => ({
      ...f,
      item_id: id,
      quantity: isAlert ? suggestQty(b!) : f.quantity,
      notes: isAlert ? noteFor(b) : f.notes,
    }));
  }

  const gross = form.quantity * form.unit_cost;
  const payable = gross + form.tax_amount;
  const nameOf = (id: number) => balances.find(b => b.ingredient_id === id)?.name ?? `Item #${id}`;

  async function handleSave() {
    if (!form.branch_id)    { setFormError(t("inv.err.selectBranch")); return; }
    if (!form.supplier_id)  { setFormError("Please select a supplier."); return; }
    if (!form.item_id)      { setFormError(t("inv.err.selectIngredient")); return; }
    if (form.quantity <= 0) { setFormError(t("inv.err.qtyPositive")); return; }
    if (form.unit_cost <= 0){ setFormError("Unit cost is required."); return; }

    setSaving(true); setFormError(""); setInfo("");
    const blocked = await checkDateOpen(form.branch_id, form.entry_date);
    if (blocked) { setSaving(false); setFormError(blocked); return; }
    try {
      const saved = await addPurchase({
        branch_id: form.branch_id,
        supplier_id: form.supplier_id,
        item_id: form.item_id,
        entry_date: form.entry_date,
        quantity: form.quantity,
        unit_cost: form.unit_cost,
        tax_amount: form.tax_amount,
        payable_amount: payable,
        notes: form.notes,
        user_id: Number(localStorage.getItem("user_id") ?? 1),
      });
      if (!saved) throw new Error("Purchase was not saved");

      window.dispatchEvent(new CustomEvent(PROCUREMENT_PO_EVENT, { detail: { count: 1, branchId: form.branch_id } }));
      onPurchasesCreated?.();

      const nowOrdered = new Set(ordered).add(form.item_id);
      setOrdered(nowOrdered);
      const next = alertItems.find(b => !nowOrdered.has(b.ingredient_id));
      if (next) {
        setInfo(`PO created for ${nameOf(form.item_id)}. Next low-stock item loaded. Cancel to finish.`);
        setForm(f => ({
          ...f, item_id: next.ingredient_id, quantity: suggestQty(next),
          unit_cost: 0, tax_amount: 0, notes: noteFor(next),
        }));
      } else {
        onClose();
      }
    } catch (e) {
      console.error("Failed to create PO:", e);
      setFormError("Could not save the purchase order. Check that the period is open, then see the POST /api/purchases response.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("inv.po.title")}
      subtitle={t("inv.po.sub").replace("{n}", String(alertItems.length))}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      cancelLabel={t("inv.modal.cancel")}
      saveLabel={t("inv.modal.save")}
    >
      {formError && (
        <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}
        </p>
      )}
      {info && (
        <p className="text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          <CheckCircle className="w-3 h-3 flex-shrink-0" />{info}
        </p>
      )}

      {alertItems.length > 0 && (
        <div>
          <p className={labelClass}>Low stock items</p>
          <div className="flex flex-wrap gap-1.5">
            {alertItems.map(b => {
              const done = ordered.has(b.ingredient_id);
              const active = form.item_id === b.ingredient_id;
              return (
                <button key={b.ingredient_id} type="button" onClick={() => pickItem(b.ingredient_id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 ${
                    active ? "bg-primary text-primary-foreground border-primary"
                    : done ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                    : b.negative_alert ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800"
                    : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"}`}>
                  {done && <Check className="w-3 h-3" />}{b.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Branch *">
          <select className={inputClass} value={form.branch_id || ""}
            onChange={e => setForm(f => ({ ...f, branch_id: Number(e.target.value) }))}>
            <option value="">Select branch...</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Supplier *">
          <select className={inputClass} value={form.supplier_id || ""}
            onChange={e => setForm(f => ({ ...f, supplier_id: Number(e.target.value) }))}>
            <option value="">Select supplier...</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Ingredient *">
        <select className={inputClass} value={form.item_id || ""} onChange={e => pickItem(Number(e.target.value))}>
          <option value="">Select ingredient...</option>
          {balances.map(b => <option key={b.ingredient_id} value={b.ingredient_id}>{b.name} ({b.unit})</option>)}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date *">
          <input type="date" className={inputClass} value={form.entry_date}
            onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} />
        </Field>
        <Field label="Quantity *">
          <input type="number" min={0} step={0.001} className={inputClass} placeholder="0.000"
            value={form.quantity || ""} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Unit Cost (${getCurrencyLabel()}) *`}
          hint={costHint === "quote" ? "Approved supplier quote"
              : costHint === "master" ? "Item master cost, no approved quote for this supplier"
              : costHint === "none" ? "No price found, enter the invoice price" : undefined}>
          <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00"
            value={form.unit_cost || ""} onChange={e => setForm(f => ({ ...f, unit_cost: Number(e.target.value) }))} />
        </Field>
        <Field label={`Tax Amount (${getCurrencyLabel()})`}>
          <input type="number" min={0} step={0.01} className={inputClass} placeholder="0.00"
            value={form.tax_amount || ""} onChange={e => setForm(f => ({ ...f, tax_amount: Number(e.target.value) }))} />
        </Field>
      </div>

      <div className="bg-secondary/40 rounded-xl p-4 space-y-1.5 border border-border">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Gross Amount</span>
          <span className="font-semibold tabular-nums">{fmtEGP(gross)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Tax</span>
          <span className="font-semibold tabular-nums">{fmtEGP(form.tax_amount)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2 mt-1">
          <span className="text-sm font-semibold text-foreground">Total Payable</span>
          <span className="text-base font-bold text-primary tabular-nums">{fmtEGP(payable)}</span>
        </div>
      </div>

      <Field label="Notes">
        <textarea className={inputClass} rows={2} placeholder="Optional notes"
          value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </Field>
    </Modal>
  );
}
    
  

  // ─── Stock Table Card ─────────────────────────────────────────────────────────

  function StockTableCard({
    title, icon, rows, loading, isFinished, branchName, accentColor,
    branchId, stockCounts, purchases, transfers, openingStock, adjustments, productionMovements, wasteRecords, t,
  }: {
    title: string; icon: React.ReactNode; rows: StockBalance[]; loading: boolean;
    isFinished: boolean; branchName: string; accentColor: string;
    branchId: number; 
    stockCounts: any[]; purchases: any[]; transfers: any[];
    openingStock: any[]; adjustments: any[]; productionMovements: any[]; wasteRecords: any[]; t: (k: string) => string;
  }) {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatus] = useState<StatusFilter>("all");
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortDir, setSortDir] = useState<SortDir>("asc");
    const [groupBy, setGroupBy] = useState<GroupBy>("none");
    const [showFilters, setShowFilters] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 20;

    const countMap = useMemo(() => {
      const map: Record<number, any> = {};
      stockCounts.forEach(c => {
        const id = Number(c.ingredient_id);
        const counted = Number(c.counted_qty ?? c.counted_quantity ?? c.quantity ?? 0);
        const rawSys = c.system_qty ?? c.system_quantity ?? c.expected_qty;
        const delta = Number(
          c.delta ?? c.quantity_delta ?? c.variance ??
          (rawSys != null ? counted - Number(rawSys) : 0)
        );
        const systemQty = rawSys != null ? Number(rawSys) : counted - delta;

        const norm = { ...c, counted_qty: counted, delta, system_qty: systemQty };
        const prev = map[id];
        const newer =
          !prev ||
          (c.entry_date ?? "") > (prev.entry_date ?? "") ||
          ((c.entry_date ?? "") === (prev.entry_date ?? "") && Number(c.id ?? 0) >= Number(prev.id ?? 0));
        if (newer) map[id] = norm;
      });
      return map;
    }, [stockCounts]);

    const purchaseMap = useMemo(() => {
      const map: Record<number, { totalQty: number; totalValue: number; count: number }> = {};
      purchases.forEach(p => {
        const id = Number(p.ingredient_id);
        if (!map[id]) map[id] = { totalQty: 0, totalValue: 0, count: 0 };
        map[id].totalQty += Number(p.quantity ?? 0);
        map[id].totalValue += Number(p.payable_amount ?? p.gross_amount ?? 0);
        map[id].count += 1;
      });
      return map;
    }, [purchases]);

    const transferMap = useMemo(() => {
      const map: Record<number, { in: number; out: number }> = {};
      transfers.forEach(tr => {
        const id = Number(tr.ingredient_id);
        if (!map[id]) map[id] = { in: 0, out: 0 };
        if (Number(tr.to_branch_id) === branchId) {
          map[id].in += Number(tr.quantity ?? 0);
        } else if (Number(tr.from_branch_id) === branchId) {
          map[id].out += Number(tr.quantity ?? 0);
        }
      });
      return map;
    }, [transfers, branchId]);

    const openingMap = useMemo(() => {
      const map: Record<number, number> = {};
      openingStock.forEach(o => { const id = Number(o.ingredient_id); map[id] = (map[id] ?? 0) + Number(o.qty_issued ?? o.quantity ?? 0); });
      return map;
    }, [openingStock]);

    // total = approved adjustments + recorded waste (net effect on stock)
    // waste = recorded waste only (always <= 0)
    const adjustmentMap = useMemo(() => {
      const map: Record<number, { total: number; waste: number }> = {};
      adjustments
        .filter(a => a.status === "approved")   // ignore pending and rejected
        .forEach(a => {
          const id = Number(a.ingredient_id);
          if (!map[id]) map[id] = { total: 0, waste: 0 };
          map[id].total += Number(a.quantity_delta ?? 0);
        });
      wasteRecords
        .filter(w => !w.status || w.status === "approved")
        .forEach(w => {
          const id = Number(w.ingredient_id);
          if (!map[id]) map[id] = { total: 0, waste: 0 };
          const qty = -Math.abs(Number(w.quantity ?? 0));
          map[id].total += qty;
          map[id].waste += qty;
        });
      return map;
    }, [adjustments, wasteRecords]);
      const productionMap = useMemo(() => {
        const map: Record<number, number> = {};
        productionMovements.forEach(m => {
          const id = Number(m.ingredient_id);
          map[id] = (map[id] ?? 0) + Number(m.quantity_delta ?? 0);
        });
        return map;
      }, [productionMovements]);

    function toggleSort(field: SortField) {
      if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
      else { setSortField(field); setSortDir("asc"); }
      setPage(1);
    }

    function SortIcon({ field }: { field: SortField }) {
      if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 text-muted-foreground inline ml-1" />;
      return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-1 text-primary" /> : <ChevronDown className="w-3 h-3 inline ml-1 text-primary" />;
    }
    const STATUS_ORDER: Record<string, number> = { negative: 0, low: 1, ok: 2 };

    const groupLabel = useCallback((r: StockBalance): string => {
      if (groupBy === "status") {
        const s = getStatus(r);
        return s === "negative" ? t("inv.table.status.negative")
            : s === "low"      ? t("inv.table.status.low")
            :                    t("inv.table.status.ok");
      }
      if (groupBy === "unit") return r.unit || "—";
      return "";
    }, [groupBy, t]);

    const filtered = useMemo(() => {
      const q = search.trim().toLowerCase();
      return rows
        .filter(r => {
          if (statusFilter !== "all" && getStatus(r) !== statusFilter) return false;
          if (q && !r.name.toLowerCase().includes(q) && !r.unit.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => {
          if (groupBy !== "none") {
            const ga = groupBy === "status" ? STATUS_ORDER[getStatus(a)] : (a.unit ?? "");
            const gb = groupBy === "status" ? STATUS_ORDER[getStatus(b)] : (b.unit ?? "");
            if (ga < gb) return -1;
            if (ga > gb) return 1;
          }
          let av: any, bv: any;
          if (sortField === "name") { av = a.name; bv = b.name; }
          else if (sortField === "balance_qty") { av = a.balance_qty; bv = b.balance_qty; }
          else if (sortField === "reorder_level") { av = a.reorder_level ?? 0; bv = b.reorder_level ?? 0; }
          else { av = stockValue(a); bv = stockValue(b); }
          if (av < bv) return sortDir === "asc" ? -1 : 1;
          if (av > bv) return sortDir === "asc" ? 1 : -1;
          return 0;
        });
    }, [rows, search, statusFilter, sortField, sortDir, groupBy]);

    const pagedRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const totalValue = rows.reduce((s, r) => s + assetValue(r), 0);
    const negCount = rows.filter(r => r.negative_alert).length;
    const lowCount = rows.filter(r => r.reorder_alert && !r.negative_alert).length;

    if (loading) return (
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-xl bg-secondary/60 animate-pulse" />
          <div className="h-5 w-48 bg-secondary/60 rounded animate-pulse" />
        </div>
        <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 bg-secondary/40 rounded animate-pulse" />)}</div>
      </Card>
    );

    return (
      <Card className="overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-4 border-b border-border bg-gradient-to-r ${accentColor}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">{icon}</div>
              <div>
                <h2 className="text-base font-bold text-white">{title}</h2>
                <p className="text-xs text-white/70">{t("inv.table.items").replace("{n}", String(rows.length))} · {branchName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
                onClick={() => exportCSV(filtered.length ? filtered : rows, title, branchName, isFinished, countMap, purchaseMap, transferMap, openingMap, adjustmentMap)}>
                <Download className="w-4 h-4 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
                onClick={() => exportStockPDF(filtered.length ? filtered : rows, title, branchName, isFinished, countMap, purchaseMap, transferMap, openingMap, adjustmentMap)}>
                <Printer className="w-4 h-4 mr-1" /> PDF
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 mt-4">
            {[
              { label: t("inv.table.totalValue"), value: fmtEGP(totalValue),  color: "text-white" },
              { label: t("inv.table.items2"),     value: String(rows.length), color: "text-white/80" },
              { label: t("inv.table.negative"),   value: String(negCount),    color: negCount > 0 ? "text-red-200" : "text-white/70" },
              { label: t("inv.table.lowStock"),   value: String(lowCount),    color: lowCount > 0 ? "text-amber-200" : "text-white/70" },
            ].map(s => (
              <div key={s.label} className="bg-white/10 rounded-xl px-3 py-2 text-center">
                <p className="text-[10px] text-white/60 uppercase tracking-wide">{s.label}</p>
                <p className={`text-sm font-bold mt-0.5 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input type="text" placeholder={t("inv.table.searchPlaceholder")} value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3 h-3" /></button>}
            </div>
            <div className="flex gap-1">
              {(["all", "ok", "low", "negative"] as StatusFilter[]).map(s => (
                <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${statusFilter === s
                    ? s === "negative" ? "bg-red-600 text-white border-red-600"
                      : s === "low" ? "bg-amber-500 text-white border-amber-500"
                        : s === "ok" ? "bg-green-600 text-white border-green-600"
                          : "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:bg-secondary"}`}>
                  {s === "all"
                    ? t("inv.audit.action.all")
                    : s === "ok"  ? `✓ ${t("inv.table.status.ok")}`
                    : s === "low" ? `⚠ ${t("inv.table.status.low")}`
                    : `✕ ${t("inv.table.status.negative")}`}
                </button>
              ))}
            </div>
            <button onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${showFilters ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-input hover:bg-secondary"}`}>
              <Filter className="w-3.5 h-3.5" /> {t("inv.table.more")}
            </button>
          </div>
          {showFilters && (
            <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">{t("inv.table.group")}</span>
                {(["none", "status", "unit"] as GroupBy[]).map(g => (
                  <button key={g} onClick={() => { setGroupBy(g); setPage(1); }}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${groupBy === g ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input text-muted-foreground hover:bg-secondary"}`}>
                    {g === "none" ? t("inv.table.groupNone") : g === "status" ? t("inv.table.groupStatus") : t("inv.table.groupUnit")}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">{t("inv.table.sort")}</span>
                {([["name", t("inv.table.sortName")], ["balance_qty", t("inv.table.sortBalance")], ["inventory_value", t("inv.table.sortValue")]] as [SortField, string][]).map(([f, label]) => (
                  <button key={f} onClick={() => toggleSort(f)}
                    className={`px-2 py-1 rounded text-xs border transition-colors flex items-center gap-1 ${sortField === f ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input text-muted-foreground hover:bg-secondary"}`}>
                    {label}{sortField === f && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground ml-auto">{filtered.length} of {rows.length} items</p>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {!rows.length ? (
            <div className="py-16 text-center">
              <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("inv.table.noData")}</p>
            </div>
          ) : !filtered.length ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("inv.table.noMatch")}</p>
              <button className="text-xs text-primary hover:underline mt-2" onClick={() => { setSearch(""); setStatus("all"); }}>
                {t("inv.table.clearFilters")}
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/70 border-b border-border">
                  <th rowSpan={2} className="px-4 py-2.5 text-left w-8"></th>
                  <th rowSpan={2} className="px-4 py-2.5 text-left">
                    <button onClick={() => toggleSort("name")} className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary">
                      {isFinished ? t("inv.table.col.product") : t("inv.table.col.ingredient")}<SortIcon field="name" />
                    </button>
                  </th>
                  <th rowSpan={2} className="px-4 py-2.5 text-right">
                    <button onClick={() => toggleSort("balance_qty")} className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary ml-auto">
                      {t("inv.table.col.balance")}<SortIcon field="balance_qty" />
                    </button>
                  </th>
                  <th rowSpan={2} className="px-4 py-2.5 text-right">
                    <button onClick={() => toggleSort("reorder_level")} className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary ml-auto">
                      {t("inv.table.col.reorder")}<SortIcon field="reorder_level" />
                    </button>
                  </th>
                  <th rowSpan={2} className="px-4 py-2.5 text-right">
                    <button onClick={() => toggleSort("inventory_value")} className="flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary ml-auto">
                      {t("inv.table.col.value")}<SortIcon field="inventory_value" />
                    </button>
                  </th>
                  <th colSpan={3} className="px-4 py-1.5 text-center text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/40 border-l border-blue-200 dark:border-blue-800 uppercase tracking-wider">{t("inv.table.legend.count")}</th>                <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50/80 dark:bg-violet-950/40 border-l border-violet-200 dark:border-violet-800 uppercase tracking-wider">{t("inv.table.legend.purchases")}</th>
                  <th colSpan={2} className="px-4 py-1.5 text-center text-[10px] font-bold text-green-700 dark:text-green-300 bg-green-50/80 dark:bg-green-950/40 border-l border-green-200 dark:border-green-800 uppercase tracking-wider">{t("inv.table.legend.transfers")}</th>
                  <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40 border-l border-amber-200 dark:border-amber-800 uppercase tracking-wider">{t("inv.table.legend.opening")}</th>
                  <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-red-700 dark:text-red-300 bg-red-50/80 dark:bg-red-950/40 border-l border-red-200 dark:border-red-800 uppercase tracking-wider">{t("inv.table.legend.waste")}</th>
                  <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50/80 dark:bg-sky-950/40 border-l border-sky-200 dark:border-sky-800 uppercase tracking-wider">{t("inv.table.legend.variance")}</th>
                  <th rowSpan={2} className="px-4 py-2.5 text-center text-xs font-semibold text-foreground">{t("inv.table.col.status")}</th>
                </tr>
                <tr className="bg-secondary/50 border-b border-border">
                  <th className="px-4 py-2 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/30 border-l border-blue-200 dark:border-blue-800">{t("inv.table.col.lastCount")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/30">{t("inv.table.col.diff")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/30">vs Balance</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-50/60 dark:bg-violet-950/30 border-l border-violet-200 dark:border-violet-800">{t("inv.table.col.totalRcvd")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50/60 dark:bg-green-950/30 border-l border-green-200 dark:border-green-800">{t("inv.table.col.in")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50/60 dark:bg-green-950/30 border-l border-green-200 dark:border-green-800">{t("inv.table.col.out")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border-l border-amber-200 dark:border-amber-800">{t("inv.table.col.openingQty")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50/60 dark:bg-red-950/30 border-l border-red-200 dark:border-red-800">{t("inv.table.col.netAdj")}</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50/60 dark:bg-sky-950/30 border-l border-sky-200 dark:border-sky-800">{t("inv.table.col.varPct")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, i) => {
                  const rid = Number((row as any).ingredient_id ?? (row as any).product_id);
                  const status = getStatus(row);
                  const value = stockValue(row);
                  const reorderPct = row.reorder_level > 0 ? Math.min(100, (row.balance_qty / row.reorder_level) * 100) : 100;

                  // movement data is keyed by ingredient_id, so only raw materials may read it
                  const countData      = isFinished ? undefined : countMap[rid];
                  const purchaseData   = isFinished ? undefined : purchaseMap[rid];
                  const transferData   = isFinished ? undefined : transferMap[rid];
                  const openingQty     = isFinished ? null : (openingMap[rid] ?? null);
                  const adjustmentData = isFinished ? undefined : adjustmentMap[rid];

                  const countedQty = countData ? Number(countData.counted_qty ?? 0) : null;
                  const countDiff = countData ? Number(countData.delta ?? 0) : null;
                  const driftVsBalance = countedQty !== null
                    ? Number((row.balance_qty - countedQty).toFixed(3))
                    : null;
                  const totalPurchased = purchaseData?.totalQty ?? null;
                  const netAdj = adjustmentData?.total ?? null;
                  const wasteOnly = adjustmentData?.waste ?? 0;
                  const adjOnly = (adjustmentData?.total ?? 0) - wasteOnly;
                  const isExpanded = expandedRows.has(rid);
                  const sysBefore = countData ? Math.abs(countData.system_qty) : null;
                  const varPct =
                    countDiff === null ? null
                    : sysBefore && sysBefore > 0 ? (countDiff / sysBefore) * 100
                    : countDiff === 0 ? 0
                    : Math.sign(countDiff) * 100;

                  const showGroupHeader =
                    groupBy !== "none" &&
                    (i === 0 || groupLabel(pagedRows[i - 1]) !== groupLabel(row));
                  const groupCount = showGroupHeader
                    ? filtered.filter(r => groupLabel(r) === groupLabel(row)).length
                    : 0;

                  return (
                    <React.Fragment key={rid}>
                      {showGroupHeader && (
                        <tr className="bg-secondary/60 border-b border-border">
                          <td colSpan={15} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-foreground">
                            {groupLabel(row)}
                            <span className="ml-2 font-normal text-muted-foreground">({groupCount})</span>
                          </td>
                        </tr>
                      )}
                      <tr className={`border-b border-border hover:bg-secondary/30 transition-colors ${isExpanded ? "bg-secondary/20" : ""}`}>
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={() => setExpandedRows(s => { const n = new Set(s); n.has(rid) ? n.delete(rid) : n.add(rid); return n; })}
                            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground text-sm">{row.name}</p>
                          {row.reorder_level > 0 && (
                            <div className="mt-1 w-full max-w-[100px] h-1 bg-secondary rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${row.negative_alert ? "bg-red-500" : row.reorder_alert ? "bg-amber-400" : "bg-green-500"}`}
                                style={{ width: `${Math.max(0, Math.min(100, reorderPct))}%` }} />
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums ${row.negative_alert ? "text-red-600" : "text-foreground"}`}>
                          {row.balance_qty.toFixed(3)}<span className="text-xs text-muted-foreground font-normal ml-1">{row.unit}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-muted-foreground font-mono tabular-nums">
                          {(row.reorder_level ?? 0).toFixed(3)}<span className="text-xs ml-1">{row.unit}</span>
                        </td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold ${value < 0 ? "text-red-600" : ""}`}>{fmtSignedEGP(value)}</td>
                        <td className="px-4 py-3 text-right border-l border-blue-100 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/20">
                          {countedQty !== null ? (
                            <div>
                              <span className="font-mono text-sm font-semibold text-blue-700 dark:text-blue-400">{countedQty.toFixed(3)}</span>
                              <span className="text-xs text-muted-foreground ml-1">{row.unit}</span>
                              {countData?.entry_date && <p className="text-[10px] text-muted-foreground">{countData.entry_date}</p>}
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right bg-blue-50/30 dark:bg-blue-950/20">
                          {countDiff !== null ? <DeltaBadge value={countDiff} unit={row.unit} /> : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right bg-blue-50/30 dark:bg-blue-950/20">
                          {driftVsBalance !== null
                            ? <DeltaBadge value={driftVsBalance} unit={row.unit} />
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right border-l border-violet-100 dark:border-violet-900 bg-violet-50/30 dark:bg-violet-950/20">
                          {totalPurchased !== null ? (
                            <div>
                              <span className="font-mono text-sm font-semibold text-violet-700 dark:text-violet-400">{totalPurchased.toFixed(3)}</span>
                              <span className="text-xs text-muted-foreground ml-1">{row.unit}</span>
                              {purchaseData && purchaseData.count > 0 && <p className="text-[10px] text-muted-foreground">{t("inv.table.orders").replace("{n}", String(purchaseData.count))}</p>}
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right border-l border-green-100 dark:border-green-900 bg-green-50/30 dark:bg-green-950/20">
                          {transferData?.in && transferData.in > 0
                            ? <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold text-green-700 dark:text-green-400">▲ +{transferData.in.toFixed(3)}<span className="font-normal text-muted-foreground ml-0.5">{row.unit}</span></span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right bg-green-50/30 dark:bg-green-950/20">
                          {transferData?.out && transferData.out > 0
                            ? <span className="inline-flex items-center gap-0.5 font-mono text-xs font-bold text-orange-600 dark:text-orange-400">▼ -{transferData.out.toFixed(3)}<span className="font-normal text-muted-foreground ml-0.5">{row.unit}</span></span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right border-l border-amber-100 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/20">
                          {openingQty !== null && openingQty > 0 ? (
                            <div>
                              <span className="font-mono text-sm font-semibold text-amber-700 dark:text-amber-400">{openingQty.toFixed(3)}</span>
                              <span className="text-xs text-muted-foreground ml-1">{row.unit}</span>
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right border-l border-red-100 dark:border-red-900 bg-red-50/30 dark:bg-red-950/20">
                          {netAdj !== null ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <DeltaBadge value={netAdj} unit={row.unit} />
                              {netAdj < -0.5 && <span className="text-[10px] bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded-full font-semibold">{t("inv.table.status.loss")}</span>}
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right border-l border-sky-100 dark:border-sky-900 bg-sky-50/30 dark:bg-sky-950/20">
                          {varPct !== null ? (
                            <div className="flex flex-col items-end">
                              <span className={`text-xs font-bold ${Math.abs(varPct) > 15 ? "text-red-600" : Math.abs(varPct) > 5 ? "text-amber-600" : "text-green-600"}`}>
                                {fmtPct(varPct)}
                              </span>
                              <div className="w-12 h-1 bg-secondary rounded-full overflow-hidden mt-1">
                                <div className={`h-full rounded-full ${varPct < 0 ? "bg-red-400" : "bg-green-400"}`} style={{ width: `${Math.min(100, Math.abs(varPct) * 4)}%` }} />
                              </div>
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {status === "negative"
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-semibold whitespace-nowrap">{t("inv.table.status.negative")}</span>
                            : status === "low"
                              ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold whitespace-nowrap">{t("inv.table.status.low")}</span>
                              : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-semibold whitespace-nowrap">{t("inv.table.status.ok")}</span>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-secondary/30 border-b border-border">
                          <td colSpan={15} className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-2">{t("inv.flow.title")}</p>
                                  <div className="space-y-1.5">
                                    {[
                                      { label: t("inv.flow.opening"),     value: openingQty !== null && openingQty > 0 ? `+${openingQty.toFixed(3)} ${row.unit}` : "—", color: "text-amber-600" },
                                      { label: t("inv.flow.purchases"),   value: totalPurchased !== null && totalPurchased > 0 ? `+${totalPurchased.toFixed(3)} ${row.unit}` : "—", color: "text-violet-600" },
                                      { label: t("inv.flow.transferIn"),  value: transferData?.in && transferData.in > 0 ? `+${transferData.in.toFixed(3)} ${row.unit}` : "—", color: "text-green-600" },
                                      { label: t("inv.flow.transferOut"), value: transferData?.out && transferData.out > 0 ? `-${transferData.out.toFixed(3)} ${row.unit}` : "—", color: "text-orange-600" },
                                      { label: t("inv.flow.production"),  value: (() => { const used = isFinished ? 0 : (productionMap[rid] ?? 0); return used < 0 ? `-${Math.abs(used).toFixed(3)} ${row.unit}` : "—"; })(), color: "text-red-600" },
                                      { label: t("inv.flow.adjustments"), value: Math.abs(adjOnly) > 0.0005 ? `${adjOnly >= 0 ? "+" : ""}${adjOnly.toFixed(3)} ${row.unit}` : "—", color: adjOnly < 0 ? "text-red-600" : "text-green-600" },
                                      { label: "Waste", value: Math.abs(wasteOnly) > 0.0005 ? `${wasteOnly.toFixed(3)} ${row.unit}` : "—", color: "text-red-600" },
                                      { label: t("inv.flow.balance"),     value: `${row.balance_qty.toFixed(3)} ${row.unit}`, color: "text-foreground font-bold" },
                                    ].map(item => (
                                    <div key={item.label} className="flex items-center justify-between text-xs bg-background rounded-lg px-3 py-1.5 border border-border">
                                      <span className="text-muted-foreground">{item.label}</span>
                                      <span className={`font-mono font-medium ${item.color}`}>{item.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary/10">
            <p className="text-xs text-muted-foreground">
              {t("inv.table.page").replace("{page}", String(page)).replace("{total}", String(totalPages)).replace("{count}", String(filtered.length))}
            </p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1 : Math.max(1, page - 2) + i;
                if (p > totalPages) return null;
                return <Button key={p} size="sm" variant={p === page ? "default" : "outline"} onClick={() => setPage(p)}>{p}</Button>;
              })}
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>→</Button>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="px-6 py-2.5 border-t border-border bg-secondary/10 flex items-center gap-5 flex-wrap">
          {[
            { color: "bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800",         label: t("inv.table.legend.count") },
            { color: "bg-violet-100 dark:bg-violet-900/40 border-violet-200 dark:border-violet-800", label: t("inv.table.legend.purchases") },
            { color: "bg-green-100 dark:bg-green-900/40 border-green-200 dark:border-green-800",     label: t("inv.table.legend.transfers") },
            { color: "bg-amber-100 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800",     label: t("inv.table.legend.opening") },
            { color: "bg-red-100 dark:bg-red-900/40 border-red-200 dark:border-red-800",             label: t("inv.table.legend.waste") },
            { color: "bg-sky-100 dark:bg-sky-900/40 border-sky-200 dark:border-sky-800",             label: t("inv.table.legend.variance") },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded border ${l.color}`} />
              <span className="text-[10px] text-muted-foreground">{l.label}</span>
            </div>
          ))}
          <span className="text-[10px] text-muted-foreground ml-auto italic">{t("inv.table.legend.hint")}</span>
        </div>
      </Card>
    );
  }

  // ─── Main Component ───────────────────────────────────────────────────────────
  function InventoryTransactions({
      movements,
      loading,
      t,
    }: {
      movements: any[];
      loading: boolean;
      t: (k: string) => string;
    }) {
      const [search, setSearch] = useState("");
      const [movementType, setMovementType] = useState("all");

      const filtered = useMemo(() => {
        return movements.filter((m) => {
          const matchesType =
            movementType === "all" ||
            m.movement_type === movementType;

          const text = [
            m.ingredient_name,
            m.branch_name,
            m.movement_type,
            m.reference_table,
            m.reference_id,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          const matchesSearch =
            !search || text.includes(search.toLowerCase());

          return matchesType && matchesSearch;
        });
      }, [movements, search, movementType]);

      const movementTypes = [
        "opening_stock",
        "grn",
        "purchase_return",
        "transfer_in",
        "transfer_out",
        "issue",
        "waste",
        "damage",
        "adjustment",
        "stock_count",
        "customer_return",
      ];

      return (
        <div className="space-y-5">

          {/* Header */}
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Inventory Transactions
            </h2>

            <p className="text-sm text-muted-foreground mt-1">
              Complete history of stock movements
            </p>
          </div>

          {/* Filters */}
          <Card className="p-4">
            <div className="flex gap-3 flex-wrap">

              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

                <input
                  className={inputClass + " pl-9"}
                  placeholder="Search ingredient, reference..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className={inputClass + " w-auto min-w-[180px]"}
                value={movementType}
                onChange={(e) => setMovementType(e.target.value)}
              >
                <option value="all">All movement types</option>

                {movementTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>

            </div>
          </Card>

          {/* Transaction table */}
          <Card className="overflow-hidden">

            {loading ? (
              <div className="p-10 text-center text-sm text-muted-foreground">
                Loading transactions...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-16 text-center">
                <ClipboardList className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />

                <p className="text-sm font-medium text-muted-foreground">
                  No inventory transactions found
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">

                <table className="w-full text-sm">

                  <thead>
                    <tr className="bg-secondary/70 border-b border-border">

                      <th className="px-4 py-3 text-left">
                        Date
                      </th>

                      <th className="px-4 py-3 text-left">
                        Ingredient
                      </th>

                      <th className="px-4 py-3 text-left">
                        Movement
                      </th>

                      <th className="px-4 py-3 text-right">
                        Quantity
                      </th>

                      <th className="px-4 py-3 text-right">
                        Unit Cost
                      </th>

                      <th className="px-4 py-3 text-left">
                        Reference
                      </th>

                      <th className="px-4 py-3 text-left">
                        Notes
                      </th>

                    </tr>
                  </thead>

                  <tbody>

                    {filtered.map((m) => {

                      const quantity = Number(m.quantity_delta ?? 0);
                      const positive = quantity >= 0;

                      return (
                        <tr
                          key={m.id}
                          className="border-b border-border hover:bg-secondary/30"
                        >

                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {m.entry_date ?? "—"}
                          </td>

                          <td className="px-4 py-3 font-medium">
                            {m.ingredient_name ?? `Ingredient #${m.ingredient_id}`}
                          </td>

                          <td className="px-4 py-3">

                            <span className="text-xs px-2 py-1 rounded-full bg-secondary capitalize">
                              {String(m.movement_type ?? "")
                                .replaceAll("_", " ")}
                            </span>

                          </td>

                          <td
                            className={`px-4 py-3 text-right font-mono font-bold ${
                              positive
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {positive ? "+" : ""}
                            {quantity.toFixed(3)}
                          </td>

                          <td className="px-4 py-3 text-right font-mono">
                            {Number(m.unit_cost ?? 0).toFixed(4)}
                          </td>

                          <td className="px-4 py-3 text-xs">
                            {m.reference_table
                              ? `${m.reference_table} #${m.reference_id ?? ""}`
                              : "—"}
                          </td>

                          <td className="px-4 py-3 text-xs text-muted-foreground max-w-[250px] truncate">
                            {m.notes ?? "—"}
                          </td>

                        </tr>
                      );
                    })}

                  </tbody>

                </table>

              </div>
            )}

          </Card>
        </div>
      );
    }
    // ─────────────────────────────────────────────────────────────────────────────
// PASTE THIS BLOCK into your inventory file, just above `export default function InventoryControls()`.
// It reuses helpers that already exist there: Card, Button, Modal, Field, inputClass,
// fetchBalances, checkDateOpen, apiCall, and the React hooks you already import.
//
// Also add `Pencil` and `ArrowRight` to your lucide-react import list.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Transfers History ────────────────────────────────────────────────────────

interface TransferRow {
  id: number;
  ingredient_id: number;
  ingredient_name: string;
  unit: string;
  from_branch_id: number;
  from_name: string;
  to_branch_id: number;
  to_name: string;
  quantity: number;
  entry_date: string; // YYYY-MM-DD
  notes: string;
  user_name: string;
}

async function updateTransfer(
  id: number,
  payload: { to_branch_id: number; entry_date: string; quantity: number; notes: string; user_id: number },
): Promise<void> {
  // Throws on failure so the modal can show the server's message
  await apiCall(`/api/transfers/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

function EditTransferModal({ row, branches, onClose, onSaved }: {
  row: TransferRow;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    to_branch_id: row.to_branch_id,
    entry_date: row.entry_date,
    quantity: row.quantity,
    notes: row.notes,
  });
  const [sourceBalance, setSourceBalance] = useState<StockBalance | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Stock currently in the source branch, so we can stop an edit that would push it below zero
  useEffect(() => {
    let cancelled = false;
    fetchBalances(row.from_branch_id)
      .then(rows => {
        if (!cancelled) setSourceBalance(rows.find(b => b.ingredient_id === row.ingredient_id));
      })
      .catch(() => { /* the server still enforces stock rules */ });
    return () => { cancelled = true; };
  }, [row.from_branch_id, row.ingredient_id]);

  // The old quantity is added back because the edit replaces it, not adds to it
  const available = sourceBalance ? sourceBalance.balance_qty + row.quantity : null;

  async function handleSave() {
    if (!form.to_branch_id) { setError("Select a destination branch."); return; }
    if (form.to_branch_id === row.from_branch_id) { setError("Source and destination must be different branches."); return; }
    if (!form.entry_date) { setError("Date is required."); return; }
    if (!(form.quantity > 0)) { setError("Quantity must be greater than zero."); return; }
    if (available !== null && form.quantity > available) {
      setError(`Only ${available.toFixed(3)} ${row.unit} can be sent from ${row.from_name} (current stock plus this transfer).`);
      return;
    }

    const unchanged =
      form.to_branch_id === row.to_branch_id &&
      form.entry_date === row.entry_date &&
      form.quantity === row.quantity &&
      form.notes === row.notes;
    if (unchanged) { onClose(); return; }

    setSaving(true);
    setError("");

    // Editing reverses the old entry and writes a new one, so both the old and the new
    // date must be in an open period, for every branch involved.
    const checks: [number, string][] = [
      [row.from_branch_id, row.entry_date],
      [row.to_branch_id, row.entry_date],
      [row.from_branch_id, form.entry_date],
      [form.to_branch_id, form.entry_date],
    ];
    for (const [branch, date] of checks) {
      const blocked = await checkDateOpen(branch, date);
      if (blocked) { setSaving(false); setError(blocked); return; }
    }

    try {
      await updateTransfer(row.id, {
        to_branch_id: form.to_branch_id,
        entry_date: form.entry_date,
        quantity: form.quantity,
        notes: form.notes,
        user_id: Number(localStorage.getItem("user_id") ?? 1),
      });
      onSaved();
      onClose();
    } catch (e) {
      console.error("[transfer] update failed", e);
      setError(e instanceof Error && e.message ? e.message : "Could not update the transfer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit transfer #${row.id}`}
      subtitle="Stock in both branches is corrected automatically."
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      saveLabel="Save changes"
    >
      {error && (
        <p role="alert" className="text-xs text-red-600 flex items-start gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />{error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ingredient">
          <input className={inputClass + " bg-secondary/40"} value={row.ingredient_name} readOnly />
        </Field>
        <Field label="From branch">
          <input className={inputClass + " bg-secondary/40"} value={row.from_name} readOnly />
        </Field>
      </div>

      <Field label="To branch">
        <select className={inputClass} value={form.to_branch_id || ""}
          onChange={e => setForm(f => ({ ...f, to_branch_id: Number(e.target.value) }))}>
          <option value="">Select branch...</option>
          {branches.filter(b => Number(b.id) !== row.from_branch_id).map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" className={inputClass} value={form.entry_date}
            onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} />
        </Field>
        <Field
          label={`Quantity${row.unit ? ` (${row.unit})` : ""}`}
          hint={available !== null ? `Up to ${available.toFixed(3)} ${row.unit} available` : undefined}
        >
          <input type="number" min={0.001} step={0.001} className={inputClass}
            value={form.quantity || ""}
            onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} />
        </Field>
      </div>

      <Field label="Notes">
        <textarea className={inputClass} rows={2} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </Field>

      <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
        The ingredient and source branch can't be changed here. If one of those was wrong,
        reverse the transfer and record a new one.
      </p>
    </Modal>
  );
}

function TransfersHistory({ transfers, loading, branches, branchId, onChanged }: {
  transfers: any[];
  loading: boolean;
  branches: Branch[];
  branchId: number;
  onChanged: () => void;
}) {
  const PAGE_SIZE = 20;
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TransferRow | null>(null);

  const nameOfBranch = useCallback(
    (id: number, fallback?: string) =>
      fallback ?? branches.find(b => Number(b.id) === id)?.name ?? `Branch #${id}`,
    [branches],
  );

  const rows = useMemo<TransferRow[]>(() =>
    transfers
      .map(r => ({
        id: Number(r.id),
        ingredient_id: Number(r.ingredient_id),
        ingredient_name: String(r.ingredient_name ?? r.name ?? `Ingredient #${r.ingredient_id}`),
        unit: String(r.unit ?? ""),
        from_branch_id: Number(r.from_branch_id),
        from_name: nameOfBranch(Number(r.from_branch_id), r.from_branch_name),
        to_branch_id: Number(r.to_branch_id),
        to_name: nameOfBranch(Number(r.to_branch_id), r.to_branch_name),
        quantity: Number(r.quantity ?? 0),
        entry_date: String(r.entry_date ?? "").slice(0, 10),
        notes: String(r.notes ?? ""),
        user_name: String(r.user_name ?? r.created_by ?? ""),
      }))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id),
    [transfers, nameOfBranch],
  );

  // Direction is relative to the branch picked at the top of the page
  const dirOf = useCallback((r: TransferRow): "in" | "out" | null => {
    if (!branchId) return null;
    if (r.to_branch_id === branchId) return "in";
    if (r.from_branch_id === branchId) return "out";
    return null;
  }, [branchId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (direction !== "all" && dirOf(r) !== direction) return false;
      if (dateFrom && r.entry_date < dateFrom) return false;
      if (dateTo && r.entry_date > dateTo) return false;
      if (q) {
        const hay = `${r.id} ${r.ingredient_name} ${r.from_name} ${r.to_name} ${r.notes} ${r.user_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, direction, dateFrom, dateTo, dirOf]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = Boolean(search || dateFrom || dateTo || direction !== "all");

  function clearFilters() {
    setSearch(""); setDirection("all"); setDateFrom(""); setDateTo(""); setPage(1);
  }

  return (
    <div className="space-y-5">
      {editing && (
        <EditTransferModal
          row={editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}

      <div>
        <h2 className="text-lg font-bold text-foreground">Transfers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every stock transfer between branches. Use Edit to correct the date, quantity, destination or notes.
        </p>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              className={inputClass + " pl-9"}
              placeholder="Search ingredient, branch, notes, #id..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <div className="flex items-center gap-2">
            <input type="date" className={inputClass + " w-auto"} value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(1); }} aria-label="From date" />
            <span className="text-muted-foreground">→</span>
            <input type="date" className={inputClass + " w-auto"} value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(1); }} aria-label="To date" />
          </div>

          {branchId > 0 && (
            <div className="flex gap-1">
              {(["all", "in", "out"] as const).map(d => (
                <button key={d} onClick={() => { setDirection(d); setPage(1); }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    direction === d
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:bg-secondary"
                  }`}>
                  {d === "all" ? "All" : d === "in" ? "Received" : "Sent"}
                </button>
              ))}
            </div>
          )}

          {hasFilters && (
            <button className="text-xs text-primary hover:underline" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {filtered.length} of {rows.length} transfers
          {!branchId && " · all branches"}
        </p>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 bg-secondary/40 rounded animate-pulse" />)}
          </div>
        ) : !rows.length ? (
          <div className="py-16 text-center">
            <ArrowUpFromLine className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No transfers recorded yet</p>
            <p className="text-xs text-muted-foreground mt-1">Use Transfer on the dashboard to move stock between branches.</p>
          </div>
        ) : !filtered.length ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No transfers match these filters.</p>
            <button className="text-xs text-primary hover:underline mt-2" onClick={clearFilters}>Clear filters</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/70 border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">Ingredient</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">From → To</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">Quantity</th>
                  {branchId > 0 && <th className="px-4 py-3 text-center text-xs font-semibold text-foreground">Direction</th>}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">Notes</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">Recorded by</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(r => {
                  const dir = dirOf(r);
                  return (
                    <tr key={r.id} className="border-b border-border hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.entry_date || "—"}</td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {r.ingredient_name}
                        <span className="block text-[10px] text-muted-foreground font-normal">#{r.id}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="font-medium text-foreground">{r.from_name}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="font-medium text-foreground">{r.to_name}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                        {r.quantity.toFixed(3)}
                        {r.unit && <span className="text-xs text-muted-foreground font-normal ml-1">{r.unit}</span>}
                      </td>
                      {branchId > 0 && (
                        <td className="px-4 py-3 text-center">
                          {dir === "in" ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-semibold">Received</span>
                          ) : dir === "out" ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 font-semibold">Sent</span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px] truncate" dir="auto" title={r.notes}>
                        {r.notes || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.user_name || "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                          <Pencil className="w-3 h-3 mr-1" /> Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary/10">
            <p className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</p>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>←</Button>
              <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>→</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

  export default function InventoryControls() {
    const { t } = useLanguage();
    // Falls back to readable text if a translation key is missing
    const tr = (key: string, fallback: string) => {
      const v = t(key);
      return v === key ? fallback : v;
    };
    const currentUserId = Number(localStorage.getItem("user_id") ?? 1);
    const currentUserName = localStorage.getItem("user_name") ?? "System";
    const [branchId, setBranchId] = useState<number>(0);
    const { workingPeriod } = useWorkingPeriod();
    const [activeTab, setActiveTab] = useState<MainTab>("dashboard");
    const [modal, setModal] = useState<ModalType>(null);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const [showPOModal, setShowPOModal] = useState(false);
    const [dismissedApprovals, setDismissedApprovals] = useState<Set<number>>(new Set());

    // ── Period status form state (mirrors Finance component) ──────────────────
    const [periodStatusForm, setPeriodStatusForm] = useState<{ status: PeriodStatusValue; notes: string }>({ status: "closed", notes: "" });

    const { data: branches } = useApi<Branch[]>(getBranches);
    const { data: balances,              loading: balancesLoading, refetch: refetchBalances   } = useApi<StockBalance[]>(() => branchId ? fetchBalances(branchId) : Promise.resolve<StockBalance[]>([]), { deps: [branchId] });
    const { data: finishedGoodsBalances, loading: fgLoading,      refetch: refetchFG          } = useApi<StockBalance[]>(() => branchId ? fetchFGBalances(branchId) : Promise.resolve<StockBalance[]>([]), { deps: [branchId] });
    const { data: stockCounts,  refetch: refetchCounts     } = useApi<any[]>(() => getStockCountsWithPurchases(branchId || undefined), { deps: [branchId] });
    const { data: purchases,    refetch: refetchPurchases  } = useApi<any[]>(() => getPurchasesByBranch(branchId || undefined),        { deps: [branchId] });
    const { data: transfers, loading: transfersLoading, refetch: refetchTransfers } = useApi<any[]>(() => getTransfersByBranch(branchId || undefined), { deps: [branchId] });
const { data: openingStock, refetch: refetchOpening } = useApi<any[]>(() => getOpeningStockByBranch(branchId || undefined), { deps: [branchId] });
    const { data: adjustments,  loading: adjLoading, refetch: refetchAdjustments } = useApi<any[]>(() => getAdjustmentsByBranch(branchId || undefined), { deps: [branchId] });
    const { data: wasteRecords, refetch: refetchWaste } = useApi<WasteRecord[]>(() => getWasteByBranch(branchId || undefined), { deps: [branchId] });
    const { data: periodSnapshots, refetch: refetchSnapshots } = useApi<PeriodSnapshot[]>(() => getPeriodSnapshots(branchId || undefined), { deps: [branchId] });

    // ── NEW: Company period status (same as Finance) ──────────────────────────
    const { data: companyPeriodStatus, loading: periodStatusLoading, refetch: refetchCompanyPeriodStatus } =
      useApi<PeriodStatusRow>(() => getPeriodStatus(workingPeriod), { deps: [workingPeriod] });

    // ── Branch-level period closure check ────────────────────────────────────
    const { data: branchPeriodStatus, refetch: refetchBranchPeriodStatus } =
      useApi<{ is_closed: boolean; is_locked?: boolean; status?: PeriodStatusValue }>(
        () => branchId ? isPeriodClosed(branchId, today()) : Promise.resolve({ is_closed: false }),
        { deps: [branchId] }
      );
    const { data: productionMovements, refetch: refetchProductionMovements } =
      useApi<any[]>(() => getInventoryMovements(branchId || undefined, "issue"), { deps: [branchId] });
    
    const {
      data: inventoryMovements,
      loading: movementsLoading,
      refetch: refetchMovements,
    } = useApi<any[]>(
      () => branchId > 0
        ? getInventoryMovements(branchId)
        : Promise.resolve([]),
      { deps: [branchId] }
    );

    const safeProductionMovements = productionMovements ?? [];
    // Derived period state (company-wide wins over branch-level)
    const selectedPeriodState    = companyPeriodStatus?.status ?? branchPeriodStatus?.status ?? "open";
    const selectedPeriodClosed   = selectedPeriodState === "closed" || selectedPeriodState === "locked" || Boolean(branchPeriodStatus?.is_closed);
    const selectedPeriodLocked   = selectedPeriodState === "locked" || Boolean(branchPeriodStatus?.is_locked);

    const [countForm,    setCountForm]    = useState({ ingredient_id: 0, entry_date: today(), counted_quantity: 0, notes: "" });
    const [adjForm,      setAdjForm]      = useState({ ingredient_id: 0, entry_date: today(), quantity_delta: 0, reason: "", notes: "", requires_approval: false });
    const [wasteForm,    setWasteForm]    = useState({ ingredient_id: 0, entry_date: today(), quantity: 0, waste_reason: "other", notes: "" });
    const [transferForm, setTransferForm] = useState({ from_branch_id: branchId, to_branch_id: 0, ingredient_id: 0, entry_date: today(), quantity: 0, notes: "" });
    const [transferBalances, setTransferBalances] = useState<StockBalance[]>([]);
    const [transferBalancesLoading, setTransferBalancesLoading] = useState(false);

    // Balances for the transfer modal follow the modal's "From" branch, not the page branch
    useEffect(() => {
      if (modal !== "transfer" || !transferForm.from_branch_id) {
        setTransferBalances([]);
        return;
      }
      let cancelled = false;
      setTransferBalancesLoading(true);
      fetchBalances(transferForm.from_branch_id)
        .then(rows => { if (!cancelled) setTransferBalances(rows ?? []); })
        .catch(() => { if (!cancelled) setTransferBalances([]); })
        .finally(() => { if (!cancelled) setTransferBalancesLoading(false); });
      return () => { cancelled = true; };
    }, [modal, transferForm.from_branch_id]);
    const [openingForm,  setOpeningForm]  = useState({ ingredient_id: 0, entry_date: today(), qty_issued: 0, notes: "" });
    const [periodForm,   setPeriodForm]   = useState({ period_label: "", entry_date: today(), notes: "" });

    const safeBalances    = balances ?? [];
    const safeFG          = finishedGoodsBalances ?? [];
    const safeCounts      = stockCounts ?? [];
    const safePurchases   = purchases ?? [];
    const safeTransfers   = transfers ?? [];
    const safeOpening     = openingStock ?? [];
    const safeAdjustments = adjustments ?? [];
    const safeWaste       = wasteRecords ?? [];
    const safeSnapshots   = periodSnapshots ?? [];
    const safeInventoryMovements = inventoryMovements ?? [];

    // Which list loads have failed right now (cleared when the same load later succeeds)
    const [loadErrors, setLoadErrors] = useState<Record<string, true>>({});
    useEffect(() => {
      const onLoad = (e: Event) => {
        const { label, ok } = (e as CustomEvent<{ label: string; ok: boolean }>).detail;
        setLoadErrors(prev => {
          if (ok) {
            if (!(label in prev)) return prev;
            const { [label]: _cleared, ...rest } = prev;
            return rest;
          }
          return prev[label] ? prev : { ...prev, [label]: true };
        });
      };
      window.addEventListener(LOAD_ERROR_EVENT, onLoad);
      return () => window.removeEventListener(LOAD_ERROR_EVENT, onLoad);
    }, []);
    const failedLoads = Object.keys(loadErrors);
    // COGS and Period Close are wrong if either of these silently came back empty
    const financeDataFailed = Boolean(loadErrors["purchases"] || loadErrors["period snapshots"]);

    const branchName = branches?.find(b => b.id === branchId)?.name ?? t("dashboard.allBranches");
    const pendingApprovals = useMemo(() => {
    return (Array.isArray(safeAdjustments) ? safeAdjustments : [])
      .filter((a: any) => a.status === "pending").length;
    }, [safeAdjustments]);



    const stats = useMemo(() => {
      const balances = Array.isArray(safeBalances) ? safeBalances : [];
      const fg = Array.isArray(safeFG) ? safeFG : [];
      const purchases = Array.isArray(safePurchases) ? safePurchases : [];

      return {
        rawValue: balances.reduce((s, b) => s + assetValue(b), 0),
        fgValue: fg.reduce((s, b) => s + assetValue(b), 0),

        lowStock: balances.filter(
          (b) => b.reorder_alert && !b.negative_alert
        ).length,

        negative: balances.filter(
          (b) => b.negative_alert
        ).length,

        totalPurchasesValue: purchases.reduce(
          (s, p) => s + Number(p.payable_amount ?? p.gross_amount ?? 0),
          0
        ),
      };
    }, [safeBalances, safeFG, safePurchases]);
    // Single source of truth for the period-close modal and the saved snapshot
    const closePeriodKey = periodOf(periodForm.entry_date);
    const [closePurchases, setClosePurchases] = useState<any[]>([]);
    const [closePurchState, setClosePurchState] = useState<"idle" | "loading" | "ok" | "error">("idle");

    useEffect(() => {
      if (modal !== "periodClose" || !closePeriodKey) { setClosePurchState("idle"); return; }
      let cancelled = false;
      setClosePurchState("loading");
      fetchPurchasesForPeriod(branchId || undefined, closePeriodKey)
        .then(rows => { if (!cancelled) { setClosePurchases(rows); setClosePurchState("ok"); } })
        .catch(e => {
          console.error("[period close] purchases load failed", e);
          if (!cancelled) setClosePurchState("error");
        });
      return () => { cancelled = true; };
    }, [modal, branchId, closePeriodKey]);

    const closePreview = useMemo(() => {
      const period = closePeriodKey;
      const opening = openingValueForPeriod(safeSnapshots, period);
      const purchasesValue = purchasesValueForPeriod(closePurchases, period);
      const closing = stats.rawValue + stats.fgValue;
      return { period, opening, purchasesValue, closing, cogs: opening + purchasesValue - closing };
    }, [closePeriodKey, safeSnapshots, closePurchases, stats.rawValue, stats.fgValue]);

    const alerts = useMemo(() =>
      safeBalances.filter(b => b.negative_alert || b.reorder_alert)
        .sort((a, b) => Number(b.negative_alert) - Number(a.negative_alert))
      ,
      [safeBalances]
    );

    function refetchAll() {
      refetchBalances?.(); refetchFG?.(); refetchCounts?.(); refetchPurchases?.();
      refetchTransfers?.(); refetchOpening?.(); refetchAdjustments?.(); refetchWaste?.(); refetchSnapshots?.();
      refetchCompanyPeriodStatus?.(); refetchBranchPeriodStatus?.(); refetchProductionMovements?.();
      refetchMovements?.();
    }
    const WRITE_MODALS: ModalType[] = ["count", "adjustment", "waste", "transfer", "opening", "periodClose"];

    function openModal(type: ModalType) {
      if (selectedPeriodClosed && type && WRITE_MODALS.includes(type)) return;
      setFormError(""); setModal(type);
      if (type === "transfer") setTransferForm(f => ({ ...f, from_branch_id: branchId }));
      if (type === "periodStatus") {
        setPeriodStatusForm({
          status: selectedPeriodState === "open" ? "closed" : selectedPeriodState,
          notes: "",
        });
      }
    }
    
    async function handleSaveCount() {
      if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
      if (!countForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
      if (countForm.counted_quantity < 0) { setFormError(t("inv.err.negativeQty")); return; }
      setSaving(true); setFormError("");
      const blocked = await checkDateOpen(branchId, countForm.entry_date);
      if (blocked) { setSaving(false); setFormError(blocked); return; }

      // The server recalculates system_qty itself; we still send it because the schema likely requires it.
      const sysBefore = safeBalances.find(b => b.ingredient_id === countForm.ingredient_id)?.balance_qty ?? 0;

      let ok = false;
      try {
        await apiCall("/api/stock-counts", {
          method: "POST",
          body: JSON.stringify({
            branch_id: branchId,
            ingredient_id: countForm.ingredient_id,
            entry_date: countForm.entry_date,
            system_qty: sysBefore,
            counted_qty: countForm.counted_quantity,
            notes: countForm.notes,
          }),
        });
        ok = true;
      } catch (e) {
        console.error("[stock-count] save failed", e);
      }

      setSaving(false);
      if (ok) {
        setModal(null);
        setCountForm({ ingredient_id: 0, entry_date: today(), counted_quantity: 0, notes: "" });
        refetchAll();
      } else setFormError(t("inv.err.saveFailed"));
    }

    async function handleSaveAdjustment() {
      if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
      if (!adjForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
      if (!adjForm.reason.trim()) { setFormError(t("inv.err.reasonRequired")); return; }
      if (!adjForm.quantity_delta) { setFormError(t("inv.err.qtyPositive")); return; }
      setSaving(true); setFormError("");
      const blocked = await checkDateOpen(branchId, adjForm.entry_date);
      if (blocked) { setSaving(false); setFormError(blocked); return; }

      let ok = false;
      try {
        await apiCall("/api/stock-adjustments", {
          method: "POST",
          body: JSON.stringify({
            branch_id: branchId,
            ingredient_id: adjForm.ingredient_id,
            entry_date: adjForm.entry_date,
            quantity_delta: adjForm.quantity_delta,
            notes: `${adjForm.reason}: ${adjForm.notes}`.trim(),
          }),
        });
        ok = true;
      } catch (e) {
        console.error("[adjustment] save failed", e);
      }

      setSaving(false);
      if (ok) {
        setModal(null);
        setAdjForm({ ingredient_id: 0, entry_date: today(), quantity_delta: 0, reason: "", notes: "", requires_approval: false });
        refetchAll();
      } else setFormError(t("inv.err.saveFailed"));
  }

    async function handleSaveWaste() {
      if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
      if (!wasteForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
      if (wasteForm.quantity <= 0) { setFormError(t("inv.err.qtyPositive")); return; }
      if (!wasteForm.waste_reason.trim()) { setFormError("Waste reason is required."); return; }

      setSaving(true);
      setFormError("");

      const blocked = await checkDateOpen(branchId, wasteForm.entry_date);
      if (blocked) { setSaving(false); setFormError(blocked); return; }

      const wasteBalance = safeBalances.find(b => b.ingredient_id === wasteForm.ingredient_id);
      const needsApproval = wasteNeedsApproval(wasteBalance, wasteForm.quantity);

      try {
        if (needsApproval) {
          // Same pending flow as manual adjustments; stock changes only after approval
          await apiCall("/api/stock-adjustments", {
            method: "POST",
            body: JSON.stringify({
              branch_id: branchId,
              ingredient_id: wasteForm.ingredient_id,
              entry_date: wasteForm.entry_date,
              quantity_delta: -wasteForm.quantity,
              notes: `Waste (${wasteForm.waste_reason}): ${wasteForm.notes}`.trim(),
            }),
          });
        } else {
          await apiCall("/api/waste", {
            method: "POST",
            body: JSON.stringify({
              branch_id: branchId,
              ingredient_id: wasteForm.ingredient_id,
              entry_date: wasteForm.entry_date,
              quantity: wasteForm.quantity,
              waste_reason: wasteForm.waste_reason,
              notes: wasteForm.notes,
            }),
          });
        }

        setModal(null);
        setWasteForm({
          ingredient_id: 0,
          entry_date: today(),
          quantity: 0,
          waste_reason: "other",
          notes: "",
        });

        // Waste creates an inventory ledger movement, so refresh the
        // balance, the waste history and the transactions ledger.
        refetchBalances?.();
        refetchWaste?.();
        refetchAdjustments?.();
        refetchMovements?.();
        refetchProductionMovements?.();
      } catch (e) {
        console.error("[waste] save failed", e);
        setFormError(
          e instanceof Error ? e.message : "Could not record waste."
        );
      } finally {
        setSaving(false);
      }
    }

    async function handleSaveTransfer() {
      if (!transferForm.from_branch_id) { setFormError(t("inv.err.sourceBranch")); return; }
      if (!transferForm.to_branch_id) { setFormError(t("inv.err.destBranch")); return; }
      if (transferForm.from_branch_id === transferForm.to_branch_id) { setFormError(t("inv.err.sameBranch")); return; }
      if (!transferForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
      if (transferForm.quantity <= 0) { setFormError(t("inv.err.qtyPositive")); return; }
      const src = transferBalances.find(b => b.ingredient_id === transferForm.ingredient_id);
      if (src && transferForm.quantity > src.balance_qty) {
        setFormError(`Only ${src.balance_qty.toFixed(3)} ${src.unit} available in the source branch.`);
        return;
      }
      setSaving(true); setFormError("");
      const blocked =
        (await checkDateOpen(transferForm.from_branch_id, transferForm.entry_date)) ??
        (await checkDateOpen(transferForm.to_branch_id, transferForm.entry_date));
      if (blocked) { setSaving(false); setFormError(blocked); return; }
      const ok = await addTransfer({ from_branch_id: transferForm.from_branch_id, to_branch_id: transferForm.to_branch_id, ingredient_id: transferForm.ingredient_id, entry_date: transferForm.entry_date, quantity: transferForm.quantity, notes: transferForm.notes, user_id: currentUserId });
      setSaving(false);
      if (ok) { setModal(null); setTransferForm({ from_branch_id: branchId, to_branch_id: 0, ingredient_id: 0, entry_date: today(), quantity: 0, notes: "" }); refetchAll(); }
      else setFormError(t("inv.err.saveFailed"));
    }

    async function handleSaveOpening() {
      if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
      if (!openingForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
      if (openingForm.qty_issued <= 0) { setFormError(t("inv.err.qtyPositive")); return; }
      setSaving(true); setFormError("");
      const blocked = await checkDateOpen(branchId, openingForm.entry_date);
      if (blocked) { setSaving(false); setFormError(blocked); return; }
      const ok = await addOpeningStock({ branch_id: branchId, ingredient_id: openingForm.ingredient_id, entry_date: openingForm.entry_date, qty_issued: openingForm.qty_issued, issued_to: "opening_stock", notes: openingForm.notes });
      setSaving(false);
      if (ok) { setModal(null); setOpeningForm({ ingredient_id: 0, entry_date: today(), qty_issued: 0, notes: "" }); refetchAll(); }
      else setFormError(t("inv.err.saveFailed"));
    }

    async function handlePeriodClose() {
      if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
      if (!periodForm.period_label.trim()) { setFormError(t("inv.err.periodLabel")); return; }
      if (closePurchState !== "ok") {
        setFormError(closePurchState === "loading"
          ? "Still loading this period's purchases. Try again in a moment."
          : "Could not load this period's purchases, so the closing numbers would be wrong. Change the date and back, or reopen this dialog.");
        return;
      }
      if (financeDataFailed) {
        setFormError("Purchases or previous snapshots failed to load, so the closing numbers would be wrong. Close this dialog, click Retry, and try again.");
        return;
      }
      setSaving(true); setFormError("");
      const { opening: openingValue, purchasesValue, closing: closingValue, cogs } = closePreview;
      const ok = await createPeriodSnapshot({ branch_id: branchId, period_label: periodForm.period_label, entry_date: periodForm.entry_date, notes: periodForm.notes, locked_by: currentUserName, opening_value: openingValue, closing_value: closingValue, purchases_value: purchasesValue, cogs });
      setSaving(false);
      if (ok) { setModal(null); setPeriodForm({ period_label: "", entry_date: today(), notes: "" }); refetchAll(); }
      else setFormError(t("inv.err.saveFailed"));
    }

    // ── NEW: Company-wide period status handler (identical to Finance) ─────────
    async function handleSavePeriodStatus() {
      setSaving(true); setFormError("");
      try {
        await setPeriodStatus({
          period: workingPeriod,
          status: periodStatusForm.status,
          notes: periodStatusForm.notes,
        });
        setModal(null);
        refetchAll();
      } catch {
        setFormError("Could not update period status");
      }
      setSaving(false);
    }

    async function handleApprove(id: number, notes: string) {
      try {
        await approveAdjustment(id, "approved", notes);

        setDismissedApprovals(prev => new Set(prev).add(id));

        // Refresh the approval list, stock balance and transactions ledger
        refetchBalances?.();
        refetchAdjustments?.();
        refetchMovements?.();
      } catch (error) {
        console.error("[adjustment] approval failed", error);
        throw error;
      }
    }

    async function handleReject(id: number, notes: string) {
      try {
        await approveAdjustment(id, "rejected", notes);

        setDismissedApprovals(prev => new Set(prev).add(id));

        // Adjustment status changed
        refetchAdjustments?.();
      } catch (error) {
        console.error("[adjustment] rejection failed", error);
        throw error;
      }
    }

    const tabs: { key: MainTab; label: string; icon: React.ReactNode; badge?: number }[] = [
      { key: "dashboard",     label: t("inv.tab.dashboard"),     icon: <BarChart2 className="w-4 h-4" /> },
      { key: "rawMaterials",  label: t("inv.tab.rawMaterials"),  icon: <Package className="w-4 h-4" /> },
      { key: "finishedGoods", label: t("inv.tab.finishedGoods"), icon: <Layers className="w-4 h-4" /> },
      { key: "transactions",  label: tr("inv.tab.transactions", "Transactions"),  icon: <ClipboardList className="w-4 h-4" /> },
      { key: "transfers", label: tr("inv.tab.transfers", "Transfers"), icon: <ArrowUpFromLine className="w-4 h-4" /> },
      { key: "variance",      label: t("inv.tab.variance"),      icon: <TrendingDown className="w-4 h-4" /> },
      { key: "cogs",          label: t("inv.tab.cogs"),          icon: <BarChart2 className="w-4 h-4" /> },
      { key: "auditLog",      label: t("inv.tab.auditLog"),      icon: <History className="w-4 h-4" /> },
    ];

    // Waste, damage, spoilage and expiry are recorded through the Waste form so each
    // loss produces exactly one ledger movement. Adjustments are for corrections only.
    const adjReasons = [
      { key: "inv.modal.adj.reason.theft",     label: t("inv.modal.adj.reason.theft") },
      { key: "inv.modal.adj.reason.recount",   label: t("inv.modal.adj.reason.recount") },
      { key: "inv.modal.adj.reason.prodError", label: t("inv.modal.adj.reason.prodError") },
      { key: "inv.modal.adj.reason.other",     label: t("inv.modal.adj.reason.other") },
    ];

    return (
      <div className="space-y-6">
        {/* ── Modals ── */}
        {modal === "count" && (
    <Modal
      title={t("inv.modal.count.title")} 
      subtitle={t("inv.modal.count.sub")}
      onClose={() => setModal(null)} 
      onSave={handleSaveCount} 
      saving={saving}
      cancelLabel={t("inv.modal.cancel")} 
      saveLabel={t("inv.modal.save")}
    >
      {formError && <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2"><AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}</p>}
      
      <Field label={t("inv.modal.count.field.ingredient")}>
        <IngredientSelect 
          balances={safeBalances} 
          value={countForm.ingredient_id} 
          onChange={id => setCountForm({ ...countForm, ingredient_id: id })} 
          placeholder={t("inv.modal.selectIngredient")} 
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("inv.modal.count.field.date")}>
          <input 
            type="date" 
            className={inputClass} 
            value={countForm.entry_date} 
            onChange={e => setCountForm({ ...countForm, entry_date: e.target.value })} 
          />
        </Field>
        <Field label={t("inv.modal.count.field.qty")}>
          <input 
            type="number" 
            min={0} 
            step={0.001} 
            className={inputClass} 
            placeholder="0.000" 
            value={countForm.counted_quantity || ""} 
            onChange={e => setCountForm({ ...countForm, counted_quantity: Number(e.target.value) })} 
          />
        </Field>
      </div>

      <Field label={t("inv.modal.count.field.notes")}>
        <textarea 
          className={inputClass} 
          rows={2} 
          placeholder={t("inv.modal.notesPlaceholder")} 
          value={countForm.notes} 
          onChange={e => setCountForm({ ...countForm, notes: e.target.value })} 
        />
      </Field>

      {/* ──────── PREVIEW SECTION (NEW) ────────── */}
      {countForm.ingredient_id > 0 && countForm.counted_quantity >= 0 && (
        <CountPreviewAlert 
          balance={safeBalances.find(b => b.ingredient_id === countForm.ingredient_id)} 
          countedQty={countForm.counted_quantity} 
          t={t} 
        />
      )}

      <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2">{t("inv.modal.count.hint")}</p>
    </Modal>
  )}

        {modal === "waste" && (
          <Modal
            title="Record Waste"
            subtitle="Record wasted raw material and reduce stock immediately."
            onClose={() => setModal(null)}
            onSave={handleSaveWaste}
            saving={saving}
            cancelLabel={t("inv.modal.cancel")}
            saveLabel="Record Waste"
          >
            {formError && (
              <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                {formError}
              </p>
            )}

            <Field label="Ingredient">
              <IngredientSelect
                balances={safeBalances}
                value={wasteForm.ingredient_id}
                onChange={id => setWasteForm({ ...wasteForm, ingredient_id: id })}
                placeholder={t("inv.modal.selectIngredient")}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input
                  type="date"
                  className={inputClass}
                  value={wasteForm.entry_date}
                  onChange={e => setWasteForm({ ...wasteForm, entry_date: e.target.value })}
                />
              </Field>

              <Field label="Quantity">
                <input
                  type="number"
                  min={0.001}
                  step={0.001}
                  className={inputClass}
                  placeholder="0.000"
                  value={wasteForm.quantity || ""}
                  onChange={e => setWasteForm({ ...wasteForm, quantity: Number(e.target.value) })}
                />
              </Field>
            </div>

            <Field label="Waste Reason">
              <select
                className={inputClass}
                value={wasteForm.waste_reason}
                onChange={e => setWasteForm({ ...wasteForm, waste_reason: e.target.value })}
              >
                <option value="waste">Waste</option>
                <option value="damage">Damage</option>
                <option value="spoilage">Spoilage</option>
                <option value="expiry">Expiry</option>
                <option value="theft">Theft</option>
                <option value="production_error">Production Error</option>
                <option value="other">Other</option>
              </select>
            </Field>

            <Field label="Notes">
              <textarea
                className={inputClass}
                rows={2}
                placeholder="Optional notes..."
                value={wasteForm.notes}
                onChange={e => setWasteForm({ ...wasteForm, notes: e.target.value })}
              />
            </Field>

            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Waste reduces the selected ingredient's stock immediately. The backend calculates the unit cost from the inventory cost history.
            </p>
            {wasteNeedsApproval(safeBalances.find(b => b.ingredient_id === wasteForm.ingredient_id), wasteForm.quantity) && (
              <p className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 flex items-start gap-2">
                <Shield className="w-3 h-3 mt-0.5 flex-shrink-0" />
                This is large compared with stock on hand, so it will be sent for manager approval. Stock changes only after approval.
              </p>
            )}
          </Modal>
        )}

        {modal === "adjustment" && (
          <Modal
            title={t("inv.modal.adj.title")} subtitle={t("inv.modal.adj.sub")}
            onClose={() => setModal(null)} onSave={handleSaveAdjustment} saving={saving}
            cancelLabel={t("inv.modal.cancel")} saveLabel={t("inv.modal.save")}
          >
            {formError && <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2"><AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}</p>}
            <Field label={t("inv.modal.adj.field.ingredient")}>
              <IngredientSelect balances={safeBalances} value={adjForm.ingredient_id} onChange={id => setAdjForm({ ...adjForm, ingredient_id: id })} placeholder={t("inv.modal.selectIngredient")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("inv.modal.adj.field.date")}><input type="date" className={inputClass} value={adjForm.entry_date} onChange={e => setAdjForm({ ...adjForm, entry_date: e.target.value })} /></Field>
              <Field label={t("inv.modal.adj.field.delta")} hint={t("inv.modal.adj.field.deltaHint")}>
                <input type="number" step={0.001} className={inputClass} placeholder="e.g. -5 or +10" value={adjForm.quantity_delta || ""} onChange={e => setAdjForm({ ...adjForm, quantity_delta: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label={t("inv.modal.adj.field.reason")}>
              <select className={inputClass} value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })}>
                <option value="">{t("inv.modal.selectReason")}</option>
                {adjReasons.map(r => <option key={r.key} value={r.label}>{r.label}</option>)}
              </select>
            </Field>
            <Field label={t("inv.modal.adj.field.notes")}><textarea className={inputClass} rows={2} placeholder={t("inv.modal.adjNotesPlaceholder")} value={adjForm.notes} onChange={e => setAdjForm({ ...adjForm, notes: e.target.value })} /></Field>
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-start gap-2">
                <Shield className="w-3 h-3 mt-0.5 flex-shrink-0" />
                Adjustments stay pending until a manager approves them. Stock changes only after approval.
              </p>
              <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
                For waste, damage, spoilage or expiry, use <strong>Waste</strong> on the dashboard instead. It reduces stock immediately and is reported separately.
              </p>
          </Modal>
        )}

        {modal === "transfer" && (
          <Modal
            title={t("inv.modal.transfer.title")} subtitle={t("inv.modal.transfer.sub")}
            onClose={() => setModal(null)} onSave={handleSaveTransfer} saving={saving}
            cancelLabel={t("inv.modal.cancel")} saveLabel={t("inv.modal.save")}
          >
            {formError && <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2"><AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("inv.modal.transfer.field.from")}>
                <select
                  className={inputClass}
                  value={transferForm.from_branch_id || ""}
                  onChange={e => {
                    const from = Number(e.target.value);
                    setTransferForm(f => ({
                      ...f,
                      from_branch_id: from,
                      ingredient_id: 0,
                      to_branch_id: f.to_branch_id === from ? 0 : f.to_branch_id,
                    }));
                  }}
                >
                  <option value="">{t("inv.modal.selectBranch")}</option>
                  {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label={t("inv.modal.transfer.field.to")}>
                <select className={inputClass} value={transferForm.to_branch_id || ""} onChange={e => setTransferForm({ ...transferForm, to_branch_id: Number(e.target.value) })}>
                  <option value="">{t("inv.modal.selectBranch")}</option>
                  {branches?.filter(b => b.id !== transferForm.from_branch_id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t("inv.modal.transfer.field.ingredient")}>
              <IngredientSelect
                balances={transferBalances}
                value={transferForm.ingredient_id}
                onChange={id => setTransferForm({ ...transferForm, ingredient_id: id })}
                placeholder={
                  !transferForm.from_branch_id ? t("inv.modal.selectBranch")
                  : transferBalancesLoading ? "Loading..."
                  : t("inv.modal.selectIngredient")
                }
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("inv.modal.transfer.field.date")}><input type="date" className={inputClass} value={transferForm.entry_date} onChange={e => setTransferForm({ ...transferForm, entry_date: e.target.value })} /></Field>
              <Field
                label={t("inv.modal.transfer.field.qty")}
                hint={(() => {
                  const src = transferBalances.find(b => b.ingredient_id === transferForm.ingredient_id);
                  return src ? `Available in source branch: ${src.balance_qty.toFixed(3)} ${src.unit}` : undefined;
                })()}
              >
                <input type="number" min={0.001} step={0.001} className={inputClass} placeholder="0.000" value={transferForm.quantity || ""} onChange={e => setTransferForm({ ...transferForm, quantity: Number(e.target.value) })} />
              </Field>
            </div>
            <Field label={t("inv.modal.transfer.field.notes")}><textarea className={inputClass} rows={2} placeholder={t("inv.modal.transferNotesPlaceholder")} value={transferForm.notes} onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} /></Field>
          </Modal>
        )}

        {modal === "opening" && (
          <Modal
            title={t("inv.modal.opening.title")} subtitle={t("inv.modal.opening.sub")}
            onClose={() => setModal(null)} onSave={handleSaveOpening} saving={saving}
            cancelLabel={t("inv.modal.cancel")} saveLabel={t("inv.modal.save")}
          >
            {formError && <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2"><AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}</p>}
            <Field label={t("inv.modal.opening.field.ingredient")}>
              <IngredientSelect balances={safeBalances} value={openingForm.ingredient_id} onChange={id => setOpeningForm({ ...openingForm, ingredient_id: id })} placeholder={t("inv.modal.selectIngredient")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("inv.modal.opening.field.date")}><input type="date" className={inputClass} value={openingForm.entry_date} onChange={e => setOpeningForm({ ...openingForm, entry_date: e.target.value })} /></Field>
              <Field label={t("inv.modal.opening.field.qty")}><input type="number" min={0.001} step={0.001} className={inputClass} placeholder="0.000" value={openingForm.qty_issued || ""} onChange={e => setOpeningForm({ ...openingForm, qty_issued: Number(e.target.value) })} /></Field>
            </div>
            <Field label={t("inv.modal.opening.field.notes")}><textarea className={inputClass} rows={2} placeholder={t("inv.modal.openingNotesPlaceholder")} value={openingForm.notes} onChange={e => setOpeningForm({ ...openingForm, notes: e.target.value })} /></Field>
          </Modal>
        )}

        {modal === "periodClose" && (
          <Modal
            title={t("inv.modal.period.title")} subtitle={t("inv.modal.period.sub")}
            onClose={() => setModal(null)} onSave={handlePeriodClose} saving={saving}
            cancelLabel={t("inv.modal.cancel")} saveLabel={t("inv.modal.save")}
          >
            {formError && <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2"><AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}</p>}
            <div className="p-4 bg-secondary/50 rounded-xl border border-border space-y-2 text-sm">
              <p className="font-semibold text-foreground flex items-center gap-2"><Lock className="w-4 h-4 text-amber-600" />{t("inv.modal.period.preview")}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-background rounded-lg p-2 border border-border"><p className="text-muted-foreground">{t("inv.modal.period.closingRaw")}</p><p className="font-bold text-foreground">{fmtEGP(stats.rawValue)}</p></div>
                <div className="bg-background rounded-lg p-2 border border-border"><p className="text-muted-foreground">{t("inv.modal.period.closingFG")}</p><p className="font-bold text-foreground">{fmtEGP(stats.fgValue)}</p></div>
                <div className="bg-background rounded-lg p-2 border border-border"><p className="text-muted-foreground">{t("inv.modal.period.totalPurch")}</p><p className="font-bold text-violet-600">{fmtEGP(closePreview.purchasesValue)}</p></div>
                <div className="bg-background rounded-lg p-2 border border-border"><p className="text-muted-foreground">{t("inv.modal.period.estCogs")}</p><p className="font-bold text-amber-600">{closePreview.cogs < 0 ? "−" : ""}{fmtEGP(closePreview.cogs)}</p></div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Period {closePreview.period || "—"} (from the date below): opening {fmtEGP(closePreview.opening)} + purchases {fmtEGP(closePreview.purchasesValue)} − closing {fmtEGP(closePreview.closing)}
              </p>
              {closePurchState === "loading" && (
                <p className="text-[11px] text-muted-foreground">Loading purchases for {closePreview.period}...</p>
              )}
              {closePurchState === "error" && (
                <p className="text-[11px] text-red-600">Could not load purchases for {closePreview.period}. Saving is disabled.</p>
              )}
            </div>
            <Field label={t("inv.modal.period.field.label")} hint={t("inv.modal.period.field.labelHint")}>
              <input type="text" className={inputClass} placeholder={t("inv.modal.period.field.labelPlaceholder")} value={periodForm.period_label} onChange={e => setPeriodForm({ ...periodForm, period_label: e.target.value })} />
            </Field>
            <Field label={t("inv.modal.period.field.date")}><input type="date" className={inputClass} value={periodForm.entry_date} onChange={e => setPeriodForm({ ...periodForm, entry_date: e.target.value })} /></Field>
            <Field label={t("inv.modal.period.field.notes")}><textarea className={inputClass} rows={2} placeholder={t("inv.modal.periodNotesPlaceholder")} value={periodForm.notes} onChange={e => setPeriodForm({ ...periodForm, notes: e.target.value })} /></Field>
            <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-start gap-2">
              <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />{t("inv.modal.period.warning")}
            </p>
          </Modal>
        )}

        {/* ── NEW: Company Period Status Modal (mirrors Finance exactly) ─────── */}
        {modal === "periodStatus" && (
          <Modal
            title="Period Status"
            subtitle="Set company-wide period access for all branches"
            onClose={() => setModal(null)}
            onSave={handleSavePeriodStatus}
            saving={saving}
            cancelLabel={t("inv.modal.cancel")}
            saveLabel={t("inv.modal.save")}
          >
            {formError && (
              <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}
              </p>
            )}
            <Field label="Period">
              <input type="text" className={inputClass} value={workingPeriod} readOnly />
            </Field>
            <Field label="Status">
              <select
                className={inputClass}
                value={periodStatusForm.status}
                onChange={e => setPeriodStatusForm({ ...periodStatusForm, status: e.target.value as PeriodStatusValue })}
              >
                <option value="open">Open — normal work</option>
                <option value="closed">Closed — no edits</option>
                <option value="locked">Locked — fully frozen</option>
              </select>
            </Field>
            <Field label="Notes">
              <textarea
                className={inputClass}
                rows={2}
                placeholder="Reason for status change..."
                value={periodStatusForm.notes}
                onChange={e => setPeriodStatusForm({ ...periodStatusForm, notes: e.target.value })}
              />
            </Field>
            <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
              This applies to the selected period for the whole company. Closing or locking prevents new entries across all branches.
            </p>
          </Modal>
        )}

        {showPOModal && (
          <POGeneratorModal
            balances={safeBalances}
            branches={branches ?? []}
            onClose={() => setShowPOModal(false)}
            t={t}
            branchId={branchId}
            onPurchasesCreated={refetchAll}
          />
        )}
        {/* ── Page Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-primary">{t("inv.title")}</h1>
            <p className="text-muted-foreground mt-1">{t("inv.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select className="px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-40"
              value={branchId || ""} onChange={e => setBranchId(Number(e.target.value))}>
              <option value="">{t("inv.selectBranch")}</option>
              {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            
            {branchId > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowPOModal(true)} disabled={selectedPeriodClosed} title={selectedPeriodClosed ? "Period is closed" : undefined} className="border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30">
                <ShoppingCart className="w-4 h-4 mr-1.5" /> {t("inv.generatePO")}
              </Button>
            )}
            {branchId > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openModal("periodClose")}
                disabled={selectedPeriodClosed}
                title={selectedPeriodClosed ? "Period is already closed" : undefined}
              >
                <Lock className="w-4 h-4 mr-1.5" /> {t("inv.modal.period.title")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => openModal("periodStatus")}
              disabled={periodStatusLoading}
              title={`${workingPeriod}: ${selectedPeriodState}`}
            >
              <Calendar className="w-4 h-4 mr-1.5" /> {workingPeriod} · {selectedPeriodState}
            </Button>
            <Button variant="outline" size="sm" onClick={refetchAll} disabled={balancesLoading}>
              <RefreshCw className={`w-4 h-4 ${balancesLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {!branchId && (
          <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
            <p className="text-sm text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />{t("inv.selectBranchAlert")}
            </p>
          </Card>
        )}

        {failedLoads.length > 0 && (
          <Card className="p-4 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-red-700 dark:text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                Could not load: {failedLoads.join(", ")}. Empty tables may be missing data, not zero.
              </p>
              <Button size="sm" variant="outline" onClick={refetchAll}>
                <RefreshCw className="w-3 h-3 mr-1" /> Retry
              </Button>
            </div>
          </Card>
        )}

        {/* ── NEW: Period closed/locked alert banner (mirrors Finance) ─────────── */}
        {selectedPeriodClosed && (
          <Card className={`${selectedPeriodLocked ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20" : "border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20"} p-4`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className={`flex items-center gap-2 text-sm ${selectedPeriodLocked ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                <Lock className="h-4 w-4" />
                {selectedPeriodLocked
                  ? `${workingPeriod} is locked for the whole company. No inventory edits are allowed.`
                  : `${workingPeriod} is closed for the whole company. Inventory entries are restricted.`}
              </p>
              <Button size="sm" variant="outline" onClick={() => openModal("periodStatus")}>
                Change status
              </Button>
            </div>
          </Card>
        )}

        {/* ── Pending Approvals Banner ── */}
        {pendingApprovals > 0 && (
          <Card className="p-4 border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">
                    {(pendingApprovals > 1 ? t("inv.pendingBanner.titlePlural") : t("inv.pendingBanner.title")).replace("{n}", String(pendingApprovals))}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400">{t("inv.pendingBanner.sub")}</p>
                </div>
              </div>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => setActiveTab("dashboard")}>
                {t("inv.pendingBanner.cta")} <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        {/* ── Navigation Tabs ── */}
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-px">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap relative ${
                activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}>
              {tab.icon}{tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] flex items-center justify-center font-bold">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Dashboard Tab ── */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard label={t("inv.kpi.rawValue")}  value={fmtEGP(stats.rawValue)}  sub={t("inv.kpi.ingredients").replace("{n}", String(safeBalances.length))} color="text-blue-600"   icon={<Package className="w-5 h-5 text-blue-600" />} />
              <KpiCard label={t("inv.kpi.fgValue")}   value={fmtEGP(stats.fgValue)}   sub={t("inv.kpi.products").replace("{n}", String(safeFG.length))}          color="text-violet-600" icon={<Layers className="w-5 h-5 text-violet-600" />} />
              <KpiCard label={t("inv.kpi.lowStock")}   value={String(stats.lowStock)}   sub={t("inv.kpi.requiresReorder")}                                         color="text-amber-600"  icon={<AlertTriangle className="w-5 h-5 text-amber-600" />} />
              <KpiCard label={t("inv.kpi.negative")}   value={String(stats.negative)}   sub={t("inv.kpi.urgentAttention")}                                         color="text-red-600"    icon={<TrendingDown className="w-5 h-5 text-red-600" />} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* ── Stock Operations ── */}
              <Card className="p-6">
                <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-4">{t("inv.ops.title")}</h2>
                <div className="space-y-2.5">
                  {[
                    { key: "count"      as ModalType, label: t("inv.ops.count"),      desc: t("inv.ops.countDesc"),      icon: <ClipboardList className="w-5 h-5 text-blue-600" />,    bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-100 dark:border-blue-900"        },
                    { key: "adjustment" as ModalType, label: t("inv.ops.adjustment"), desc: t("inv.ops.adjustmentDesc"), icon: <Zap className="w-5 h-5 text-amber-600" />,             bg: "bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900"    },
                    { key: "waste"      as ModalType, label: "Waste",                   desc: "Record wasted stock",                                           icon: <TrendingDown className="w-5 h-5 text-red-600" />,    bg: "bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900"          },
                    { key: "transfer"   as ModalType, label: t("inv.ops.transfer"),   desc: t("inv.ops.transferDesc"),   icon: <ArrowUpFromLine className="w-5 h-5 text-green-600" />,  bg: "bg-green-50 dark:bg-green-950/40 border-green-100 dark:border-green-900"    },
                    { key: "opening"    as ModalType, label: t("inv.ops.opening"),    desc: t("inv.ops.openingDesc"),    icon: <ArrowDownToLine className="w-5 h-5 text-violet-600" />, bg: "bg-violet-50 dark:bg-violet-950/40 border-violet-100 dark:border-violet-900" },
                  ].map(item => (
                    <div key={item.key} className={`flex items-center justify-between p-3 rounded-xl border ${item.bg} hover:border-primary/30 transition-colors`}>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-white/80 dark:bg-white/10 flex items-center justify-center border border-white/50 dark:border-white/20">
                          {item.icon}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white/80 dark:bg-white/10"
                        onClick={() => openModal(item.key)}
                        disabled={(!branchId && item.key !== "transfer") || selectedPeriodClosed}
                        title={selectedPeriodClosed ? (selectedPeriodLocked ? "Period is locked" : "Period is closed") : undefined}
                      >
                        {selectedPeriodClosed ? <Lock className="w-3 h-3" /> : t("inv.ops.record")}
                      </Button>
                    
                    </div>
                  ))}
                </div>
              </Card>

              {/* ── Approval Queue ── */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">{t("inv.approvals.title")}</h2>
                  {pendingApprovals > 0 && (
                    <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">{pendingApprovals} {t("inv.approvals.pending")}</span>
                  )}
                </div>
                <ApprovalPanel
                  adjustments={safeAdjustments as AdjustmentRecord[]}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  loading={adjLoading}
                  dismissedIds={dismissedApprovals}
                  t={t}
                />
              </Card>

              {/* ── Stock Alerts ── */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">{t("inv.alerts.title")}</h2>
                  {(stats.negative > 0 || stats.lowStock > 0) && (
                    <Button size="sm" variant="outline" onClick={() => setShowPOModal(true)} disabled={selectedPeriodClosed} title={selectedPeriodClosed ? "Period is closed" : undefined} className="text-xs">
                      <ShoppingCart className="w-3 h-3 mr-1" /> {t("inv.alerts.createPO")}
                    </Button>
                  )}
                </div>
                {balancesLoading ? (
                  <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-secondary/50 rounded-xl animate-pulse" />)}</div>
                ) : !alerts.length ? (
                  <div className="py-10 text-center">
                    <CheckCircle className="w-10 h-10 text-green-500/30 mx-auto mb-2" />
                    <p className="text-sm text-green-600 font-medium">{t("inv.alerts.allOk")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{branchId ? t("inv.alerts.noAlerts") : t("inv.selectBranch")}</p>
                  </div>
                ) : alerts.map(alert => (
                  <div key={alert.ingredient_id} className={`p-3 rounded-xl border mb-2 ${
                    alert.negative_alert ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900" : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
                  }`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${alert.negative_alert ? "text-red-600" : "text-amber-600"}`} />
                        <p className="font-medium text-foreground text-sm truncate">{alert.name}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0 whitespace-nowrap ${
                        alert.negative_alert ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300" : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                      }`}>
                        {alert.negative_alert ? t("inv.alerts.critical") : t("inv.alerts.low")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      {alert.negative_alert
                        ? t("inv.alerts.negative").replace("{qty}", alert.balance_qty.toFixed(2)).replace("{unit}", alert.unit)
                        : t("inv.alerts.lowDetail").replace("{qty}", alert.balance_qty.toFixed(2)).replace("{reorder}", (alert.reorder_level ?? 0).toFixed(2)).replace("{unit}", alert.unit)}
                    </p>
                  </div>
                ))}
              </Card>
            </div>

            {/* ── Recent Waste ── */}
            {branchId > 0 && (
              <Card className="overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Recent Waste</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">Latest waste records for the selected branch</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openModal("waste")}
                    disabled={selectedPeriodClosed}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Record Waste
                  </Button>
                </div>

                {safeWaste.length === 0 ? (
                  <div className="py-10 text-center">
                    <TrendingDown className="w-9 h-9 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">No waste recorded for this branch.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-secondary/50 border-b border-border">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground">Date</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground">Ingredient</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground">Quantity</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground">Reason</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground">Recorded By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {safeWaste.slice(0, 10).map(w => (
                          <tr key={w.id} className="border-b border-border last:border-0 hover:bg-secondary/30">
                            <td className="px-4 py-3 text-xs text-muted-foreground">{w.entry_date}</td>
                            <td className="px-4 py-3 font-medium text-foreground">{w.ingredient_name}</td>
                            <td className="px-4 py-3 text-right font-mono text-red-600 font-semibold">
                              -{Number(w.quantity).toFixed(3)}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                                {w.waste_reason}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{w.wasted_by ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {/* ── Period History Mini ── */}
            {safeSnapshots.length > 0 && (
              <Card className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">{t("inv.snapshots.title")}</h2>
                  <Button size="sm" variant="outline" onClick={() => setActiveTab("cogs")}>
                    <Eye className="w-3 h-3 mr-1" /> {t("inv.snapshots.fullCogs")}
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {safeSnapshots.slice(0, 3).map(s => (
                    <div key={s.id} className="bg-secondary/40 rounded-xl p-4 border border-border">
                      <div className="flex items-center gap-2 mb-2">
                        <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-semibold text-sm text-foreground">{s.period_label}</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-muted-foreground">{t("inv.snapshots.cogs")}</span><span className="font-bold text-amber-600">{fmtEGP(s.cogs)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">{t("inv.snapshots.closing")}</span><span className="font-mono">{fmtEGP(s.closing_value)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">{t("inv.snapshots.lockedBy")}</span><span>{s.locked_by}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── Raw Materials Tab ── */}
        {activeTab === "rawMaterials" && branchId > 0 && (
          <StockTableCard title={t("inv.tab.rawMaterials")} icon={<Package className="w-5 h-5 text-white" />}
            rows={safeBalances} loading={balancesLoading} isFinished={false} branchName={branchName}
            accentColor="from-blue-700 to-blue-500" branchId={branchId} stockCounts={safeCounts} purchases={safePurchases}
            transfers={safeTransfers} openingStock={safeOpening} adjustments={safeAdjustments} productionMovements={safeProductionMovements} wasteRecords={safeWaste} t={t} />
        )}
        {activeTab === "rawMaterials" && !branchId && (
          <Card className="p-12 text-center"><p className="text-sm text-muted-foreground">{t("inv.table.selectBranch")}</p></Card>
        )}

        {/* ── Finished Goods Tab ── */}
        {activeTab === "finishedGoods" && branchId > 0 && (
          <StockTableCard title={t("inv.tab.finishedGoods")} icon={<Layers className="w-5 h-5 text-white" />}
            rows={safeFG} loading={fgLoading} isFinished={true} branchName={branchName}
            accentColor="from-violet-700 to-violet-500" branchId={branchId} stockCounts={safeCounts} purchases={safePurchases}
            transfers={safeTransfers} openingStock={safeOpening} adjustments={safeAdjustments} productionMovements={safeProductionMovements} wasteRecords={safeWaste} t={t} />
        )}
        {activeTab === "finishedGoods" && !branchId && (
          <Card className="p-12 text-center"><p className="text-sm text-muted-foreground">{t("inv.table.selectBranch")}</p></Card>
        )}

        {/* ── Variance Tab ── */}
        {activeTab === "variance" && <VarianceReport branchId={branchId} balances={safeBalances} fgBalances={safeFG} t={t} />}

        {/* ── COGS Tab ── */}
        {activeTab === "cogs" && (financeDataFailed ? (
          <Card className="p-10 text-center">
            <AlertCircle className="w-10 h-10 text-red-500/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">COGS can't be calculated right now</p>
            <p className="text-xs text-muted-foreground mt-1">Purchases or period snapshots failed to load. Showing a figure would be misleading.</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={refetchAll}>
              <RefreshCw className="w-3 h-3 mr-1" /> Retry
            </Button>
          </Card>
        ) : (
          <CogsPanel snapshots={safeSnapshots} balances={[...safeBalances, ...safeFG]} purchases={safePurchases} branchId={branchId} t={t} />
        ))}

        {/* ── Audit Log Tab ── */}
        {activeTab === "auditLog" && <AuditLogPanel branchId={branchId} t={t} />}
        {/* ── Transactions Tab ── */}
        {activeTab === "transactions" && (
          <InventoryTransactions
            movements={safeInventoryMovements}
            loading={movementsLoading}
            t={t}
          />
        )}
        {activeTab === "transfers" && (
          <TransfersHistory
            transfers={safeTransfers}
            loading={transfersLoading}
            branches={branches ?? []}
            branchId={branchId}
            onChanged={refetchAll}
          />
        )}
      </div>
    );
  }