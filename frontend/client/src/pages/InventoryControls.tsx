import React, { useState, useMemo, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, X, Loader2, AlertCircle, RefreshCw, Search,
  ChevronUp, ChevronDown, ChevronsUpDown, Package, Layers, Filter,
  Printer, Download, ClipboardList, History, TrendingDown, TrendingUp,
  CheckCircle, Clock, XCircle, ShoppingCart, Lock, BarChart2,
  Calendar, ChevronRight, Eye, Percent, Shield, Zap, FileText,
  ArrowDownToLine, ArrowUpFromLine, BookOpen,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import {
  getBranches, getStockBalances, getFinishedGoodsBalances,
  addStockAdjustment, addStockCount, addTransfer, addOpeningStock, apiCall,
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

// ─── Types ────────────────────────────────────────────────────────────────────

// Added "periodStatus" to ModalType
type ModalType = "count" | "adjustment" | "transfer" | "opening" | "periodClose" | "poGenerate" | "periodStatus" | null;
type StatusFilter = "all" | "negative" | "low" | "ok";
type SortField = "name" | "balance_qty" | "reorder_level" | "inventory_value";
type SortDir = "asc" | "desc";
type GroupBy = "none" | "status" | "unit";
type MainTab = "dashboard" | "rawMaterials" | "finishedGoods" | "variance" | "auditLog" | "cogs";

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

interface VarianceRow {
  ingredient_id: number;
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

function today() { return new Date().toISOString().split("T")[0]; }
function currentPeriod() { return today().slice(0, 7); }

function fmtEGP(n: number) {
  return formatCurrencyValue(Math.abs(n), { maximumFractionDigits: 2 });
}

function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }

function getStatus(b: StockBalance): Exclude<StatusFilter, "all"> {
  if (b.negative_alert) return "negative";
  if (b.reorder_alert) return "low";
  return "ok";
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportCSV(rows: StockBalance[], title: string, branchName: string) {
  const currencyLabel = getCurrencyLabel();
  const headers = [
    "Name", "Unit", "Balance Qty", "Reorder Level", `Inventory Value (${currencyLabel})`,
    "Last Count Qty", "Count Diff", "Total Purchased", "Transfer In",
    "Transfer Out", "Opening Qty", "Net Adjustment", "Status",
  ];
  const csvRows = rows.map(r => [
    `"${r.name}"`,
    r.unit,
    r.balance_qty.toFixed(3),
    (r.reorder_level ?? 0).toFixed(3),
    Math.abs(r.inventory_value ?? r.stock_value ?? 0).toFixed(2),
    "", "", "", "", "", "", "",
    getStatus(r),
  ].join(","));
  const csv = [headers.join(","), ...csvRows].join("\n");
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
  const totalValue = rows.reduce((s, r) => s + Math.abs(r.inventory_value ?? r.stock_value ?? 0), 0);
  const negative = rows.filter(r => r.negative_alert).length;
  const low = rows.filter(r => r.reorder_alert && !r.negative_alert).length;

  const tableRows = rows.map(r => {
    const val = Math.abs(r.inventory_value ?? r.stock_value ?? 0);
    const status = getStatus(r);
    const statusColor = status === "negative" ? "#dc2626" : status === "low" ? "#d97706" : "#16a34a";
    const statusLabel = status === "negative" ? "Negative" : status === "low" ? "Low" : "OK";
    const countData = countMap[r.ingredient_id];
    const countedQty = countData ? Number(countData.counted_qty ?? 0) : null;
    const countDiff = countData ? Number(countData.delta ?? 0) : null;
    const purchaseData = purchaseMap[r.ingredient_id];
    const totalPurchased = purchaseData?.totalQty ?? null;
    const transfer = transferMap[r.ingredient_id];
    const openingQty = openingMap[r.ingredient_id] ?? null;
    const adjustment = adjustmentMap[r.ingredient_id];
    const expectedUsage = (openingQty ?? 0) + (purchaseData?.totalQty ?? 0) + (transfer?.in ?? 0) - (transfer?.out ?? 0) - r.balance_qty;
    const actualAdj = adjustment?.waste ?? 0;
    const variancePct = expectedUsage > 0 ? ((actualAdj / expectedUsage) * 100).toFixed(1) : "—";

    return `<tr>
      <td>${r.name}</td>
      <td class="num" style="${r.negative_alert ? "color:#dc2626;font-weight:700" : ""}">${r.balance_qty.toFixed(3)} ${r.unit}</td>
      <td class="num">${(r.reorder_level ?? 0).toFixed(3)}</td>
      <td class="num">${fmtEGP(val)}</td>
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
<title>${title} — ${branchName}</title>
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
    <div class="title">${title}</div>
    <div class="sub">Branch: ${branchName} · ${rows.length} items · Enterprise Costing Report</div>
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
      <th class="num" rowspan="2">Value (${currencyLabel})</th>
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

async function getStockCountsWithPurchases(branchId?: number): Promise<any[]> {
  try { return await apiCall<any[]>(`/api/stock-counts/with-purchases${branchId ? `?branch_id=${branchId}` : ""}`); } catch { return []; }
}
async function getPurchasesByBranch(branchId?: number, limit = 200): Promise<any[]> {
  try {
    const p = new URLSearchParams();
    if (branchId) p.set("branch_id", String(branchId));
    p.set("limit", String(limit));
    return await apiCall<any[]>(`/api/purchases/by-branch?${p}`);
  } catch { return []; }
}
async function getTransfersByBranch(branchId?: number): Promise<any[]> {
  try { return await apiCall<any[]>(`/api/transfers/by-branch${branchId ? `?branch_id=${branchId}` : ""}`); } catch { return []; }
}
async function getOpeningStockByBranch(branchId?: number): Promise<any[]> {
  try { return await apiCall<any[]>(`/api/opening-stock/by-branch${branchId ? `?branch_id=${branchId}` : ""}`); } catch { return []; }
}
async function getAdjustmentsByBranch(branchId?: number): Promise<any[]> {
  try { return await apiCall<any[]>(`/api/stock-adjustments/by-branch${branchId ? `?branch_id=${branchId}` : ""}`); } catch { return []; }
}
async function getPeriodSnapshots(branchId?: number): Promise<PeriodSnapshot[]> {
  try { return await apiCall<PeriodSnapshot[]>(`/api/period-snapshots${branchId ? `?branch_id=${branchId}` : ""}`); } catch { return []; }
}
async function createPeriodSnapshot(payload: any): Promise<boolean> {
  try { await apiCall("/api/period-snapshots", { method: "POST", body: JSON.stringify(payload) }); return true; } catch { return false; }
}
async function getVarianceReport(branchId?: number, dateFrom?: string, dateTo?: string): Promise<VarianceRow[]> {
  try {
    const p = new URLSearchParams();
    if (branchId) p.set("branch_id", String(branchId));
    if (dateFrom) p.set("date_from", dateFrom);
    if (dateTo) p.set("date_to", dateTo);
    return await apiCall<VarianceRow[]>(`/api/reports/variance?${p}`);
  } catch { return []; }
}
async function approveAdjustment(id: number, status: "approved" | "rejected", notes?: string): Promise<boolean> {
  await apiCall(`/api/stock-adjustments/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ status, notes }),
  });
  return true;
}
async function getAuditLog(branchId?: number, limit = 100): Promise<any[]> {
  try {
    const p = new URLSearchParams({ limit: String(limit) });
    if (branchId) p.set("branch_id", String(branchId));
    return await apiCall<any[]>(`/api/audit-log?${p}`);
  } catch { return []; }
}
// Add new API helper
async function getInventoryMovements(branchId?: number, movementType?: string): Promise<any[]> {
  try {
    const p = new URLSearchParams();
    if (branchId) p.set("branch_id", String(branchId));
    if (movementType) p.set("movement_type", movementType);
    return await apiCall<any[]>(`/api/inventory-movements/by-branch?${p}`);
  } catch { return []; }
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
  if (value === 0) return <span className="text-muted-foreground font-mono text-xs">—</span>;
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

  const pending = adjustments.filter(a => a.status === "pending");
  const visible = pending.filter(a => !dismissedIds.has(a.id));

  async function handle(id: number, action: "approved" | "rejected") {
    setProcessingId(id);
    try {
      if (action === "approved") await onApprove(id, approvalNote[id] ?? "");
      else await onReject(id, approvalNote[id] ?? "");
    } catch {
      // silently unfreeze
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
              {adj.reason} · {adj.entry_date} · {t("inv.audit.by")} {adj.user_name}
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
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(today);
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  async function runReport() {
    setLoading(true);
    const result = await getVarianceReport(branchId, dateFrom, dateTo);
    setRows(result);
    setRan(true);
    setLoading(false);
  }

  const fgVarianceRows = useMemo<VarianceRow[]>(() => {
    return fgBalances
      .filter(b => b.balance_qty !== 0)
      .map(b => ({
        ingredient_id: b.ingredient_id,
        name:          b.name + " (Finished Good)",
        unit:          b.unit,
        theoretical_usage: 0,
        actual_usage:      b.balance_qty,
        variance:          b.balance_qty,
        variance_pct:      b.balance_qty < 0 ? -100 : 0,
        variance_value:    Math.abs(b.stock_value ?? b.inventory_value ?? 0),
      }));
  }, [fgBalances]);

  const displayRows = useMemo(() => {
    if (!ran) return [];
    return [...fgVarianceRows, ...rows].sort((a, b) => Math.abs(b.variance_pct) - Math.abs(a.variance_pct));
  }, [ran, rows, fgVarianceRows]);

  const totalShrinkageValue = displayRows.reduce((s, r) => s + (r.variance < 0 ? Math.abs(r.variance_value) : 0), 0);
  const highShrinkage = displayRows.filter(r => r.variance_pct < -10).length;

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
          </div>
        )}
      </Card>

      {ran && displayRows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label={t("inv.variance.analyzed")}       value={String(displayRows.length)}      color="text-blue-600"   icon={<Package className="w-5 h-5 text-blue-600" />} />
          <KpiCard label={t("inv.variance.highShrinkage")}  value={String(highShrinkage)}            color="text-red-600"    icon={<TrendingDown className="w-5 h-5 text-red-600" />} sub={t("inv.variance.highShrinkageSub")} />
          <KpiCard label={t("inv.variance.totalValue")}     value={fmtEGP(totalShrinkageValue)}      color="text-red-600"    icon={<AlertTriangle className="w-5 h-5 text-red-600" />} />
          <KpiCard label={t("inv.variance.avg")}            value={`${(displayRows.reduce((s, r) => s + Math.abs(r.variance_pct), 0) / displayRows.length).toFixed(1)}%`} color="text-amber-600" icon={<Percent className="w-5 h-5 text-amber-600" />} />
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
                  const isFG = row.name.includes("(Finished Good)");
                  const displayName = row.name.replace(" (Finished Good)", "");

                  return (
                    <tr key={row.ingredient_id} className={`border-b border-border hover:bg-secondary/30 ${isFG ? "bg-red-50/20 dark:bg-red-950/10" : ""}`}>
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

  const filteredPurchases = useMemo(() => {
    if (!period) return purchases;
    return purchases.filter(p => {
      const entryMonth = (p.entry_date ?? "").slice(0, 7);
      return entryMonth === period;
    });
  }, [purchases, period]);

  const totalCurrentValue   = balances.reduce((s, b) => s + Math.abs(b.inventory_value ?? b.stock_value ?? 0), 0);
  const totalPurchasesValue = filteredPurchases.reduce((s, p) => s + Number(p.payable_amount ?? p.gross_amount ?? 0), 0);
  const lastSnapshot  = snapshots[0];
  const openingValue  = lastSnapshot ? lastSnapshot.closing_value : 0;
  const estimatedCOGS = openingValue + totalPurchasesValue - totalCurrentValue;

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
        <KpiCard label={t("inv.cogs.estThisPeriod")}                                     value={fmtEGP(Math.max(0, estimatedCOGS))} color="text-amber-600"  icon={<BarChart2 className="w-5 h-5 text-amber-600" />} />
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
                const cogsIsHigh = s.cogs > s.opening_value * 0.8;
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

  function humanEntity(entityType: string, displayNum?: number): string {
    const map: Record<string, string> = {
      sale:                  t("inv.audit.entity.sale"),
      purchase:              t("inv.audit.entity.purchase"),
      transfer:              t("inv.audit.entity.transfer"),
      approval_request:      t("inv.audit.entity.approval_request"),
      inventory_movement:    t("inv.audit.entity.inventory_movement"),
      period_closure:        t("inv.audit.entity.period_closure"),
      period_snapshot:       t("inv.audit.entity.period_snapshot"),
      company_period_status: "Period Status",
      customer_return:       t("inv.audit.entity.customer_return"),
      purchase_return:       t("inv.audit.entity.purchase_return"),
    };
    const label = map[entityType] ?? entityType?.replace(/_/g, " ") ?? t("inv.audit.entity.record");
    return displayNum != null ? `${label} #${String(displayNum).padStart(2, "0")}` : label;
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

              return (
                <div key={log.id ?? i} className="flex items-start gap-4 px-5 py-3.5 hover:bg-secondary/30 transition-colors">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${colors.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors.badge}`}>
                        {humanAction(log.action)}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {humanEntity(log.entity_type, i + 1)}
                      </span>
                    </div>
                    {log.details && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">{log.details}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {log.user_name && (
                        <span className="text-xs text-muted-foreground">
                          {t("inv.audit.by")} <span className="font-medium text-foreground">{log.user_name}</span>
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground capitalize">
                        {log.entity_type?.replace(/_/g, " ")}
                      </span>
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

// ─── PO Generator Modal ───────────────────────────────────────────────────────

function POGeneratorModal({ balances, onClose, t }: { balances: StockBalance[]; onClose: () => void; t: (k: string) => string }) {
  const reorderItems = balances.filter(b => b.negative_alert || b.reorder_alert);
  const [selected, setSelected] = useState<Set<number>>(new Set(reorderItems.map(b => b.ingredient_id)));
  const [quantities, setQuantities] = useState<Record<number, number>>(
    Object.fromEntries(reorderItems.map(b => [b.ingredient_id, Math.max(0, (b.reorder_level ?? 0) * 1.5 - b.balance_qty)]))
  );

  function toggle(id: number) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function exportPO() {
    const items = reorderItems.filter(b => selected.has(b.ingredient_id));
    const now = formatDateTime(new Date());
    const rows = items.map(b => `
      <tr>
        <td>${b.name}</td><td>${b.unit}</td>
        <td style="color:#dc2626;font-weight:700">${b.balance_qty.toFixed(3)}</td>
        <td>${(b.reorder_level ?? 0).toFixed(3)}</td>
        <td style="font-weight:700;color:#1d4ed8">${(quantities[b.ingredient_id] ?? 0).toFixed(3)}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Purchase Order Draft</title>
    <style>body{font-family:'Segoe UI',sans-serif;padding:32px;font-size:12px;color:#1e293b}
    h1{font-size:22px;font-weight:800;margin-bottom:4px}.sub{color:#64748b;margin-bottom:24px}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th{background:#1e293b;color:white;padding:8px;text-align:left;font-size:11px}
    td{padding:8px;border-bottom:1px solid #e2e8f0}
    .footer{margin-top:24px;font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
    @media print{@page{margin:15mm}}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #e2e8f0;padding-bottom:16px;margin-bottom:20px">
      <div><h1>Purchase Order — Draft</h1><div class="sub">Auto-generated from low/negative stock alerts · ${now}</div></div>
      <div style="text-align:right;font-size:10px;color:#94a3b8"><div>PO-DRAFT-${Date.now()}</div><div>Status: PENDING APPROVAL</div></div>
    </div>
    <table><thead><tr><th>Ingredient</th><th>Unit</th><th>Current Stock</th><th>Reorder Level</th><th>Order Qty</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">STARK AI Costing System · Draft Purchase Order · Requires Manager Approval · ${now}</div>
    <script>window.onload = () => window.print();</script></body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-violet-600" />{t("inv.po.title")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t("inv.po.sub").replace("{n}", String(reorderItems.length))}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-2">
          {reorderItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("inv.po.empty")}</p>
          ) : reorderItems.map(b => (
            <div key={b.ingredient_id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${selected.has(b.ingredient_id) ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/20"}`}>
              <input type="checkbox" checked={selected.has(b.ingredient_id)} onChange={() => toggle(b.ingredient_id)} className="w-4 h-4 rounded accent-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{b.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("inv.po.current")} <span className={b.negative_alert ? "text-red-600 font-bold" : "text-amber-600 font-semibold"}>{b.balance_qty.toFixed(3)}</span>
                  {" "}{b.unit} · {t("inv.po.reorderAt")} {(b.reorder_level ?? 0).toFixed(3)} {b.unit}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground">{t("inv.po.orderQty")}</span>
                <input type="number" min={0} step={0.001} value={quantities[b.ingredient_id] ?? 0}
                  onChange={e => setQuantities(q => ({ ...q, [b.ingredient_id]: Number(e.target.value) }))}
                  className="w-24 px-2 py-1 text-xs rounded-lg border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
                <span className="text-xs text-muted-foreground w-8">{b.unit}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-border bg-secondary/20 flex justify-between items-center">
          <span className="text-xs text-muted-foreground">{t("inv.po.selected").replace("{n}", String(selected.size))}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t("inv.modal.cancel")}</Button>
            <Button onClick={exportPO} disabled={selected.size === 0} className="bg-violet-600 hover:bg-violet-700 text-white">
              <Printer className="w-4 h-4 mr-2" />{t("inv.po.print")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stock Table Card ─────────────────────────────────────────────────────────

function StockTableCard({
  title, icon, rows, loading, isFinished, branchName, accentColor,
  branchId, stockCounts, purchases, transfers, openingStock, adjustments, productionMovements, t,
}: {
  title: string; icon: React.ReactNode; rows: StockBalance[]; loading: boolean;
  isFinished: boolean; branchName: string; accentColor: string;
  branchId: number; 
  stockCounts: any[]; purchases: any[]; transfers: any[];
  openingStock: any[]; adjustments: any[]; productionMovements: any[]; t: (k: string) => string;
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
    stockCounts.forEach(c => { const id = Number(c.ingredient_id); if (!map[id] || c.entry_date > map[id].entry_date) map[id] = c; });
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

  const adjustmentMap = useMemo(() => {
    const map: Record<number, { total: number; waste: number }> = {};
    adjustments.forEach(a => {
      const id = Number(a.ingredient_id);
      if (!map[id]) map[id] = { total: 0, waste: 0 };
      const qty = Number(a.quantity_delta ?? a.counted_quantity ?? 0);
      map[id].total += qty;
      map[id].waste += qty;
    });
    return map;
  }, [adjustments]);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => {
        if (statusFilter !== "all" && getStatus(r) !== statusFilter) return false;
        if (q && !r.name.toLowerCase().includes(q) && !r.unit.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        let av: any, bv: any;
        if (sortField === "name") { av = a.name; bv = b.name; }
        else if (sortField === "balance_qty") { av = a.balance_qty; bv = b.balance_qty; }
        else if (sortField === "reorder_level") { av = a.reorder_level ?? 0; bv = b.reorder_level ?? 0; }
        else { av = Math.abs(a.inventory_value ?? a.stock_value ?? 0); bv = Math.abs(b.inventory_value ?? b.stock_value ?? 0); }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [rows, search, statusFilter, sortField, sortDir]);

  const pagedRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const totalValue = rows.reduce((s, r) => s + Math.abs(r.inventory_value ?? r.stock_value ?? 0), 0);
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
              onClick={() => exportCSV(filtered.length ? filtered : rows, title, branchName)}>
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
                <th colSpan={2} className="px-4 py-1.5 text-center text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/40 border-l border-blue-200 dark:border-blue-800 uppercase tracking-wider">{t("inv.table.legend.count")}</th>
                <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50/80 dark:bg-violet-950/40 border-l border-violet-200 dark:border-violet-800 uppercase tracking-wider">{t("inv.table.legend.purchases")}</th>
                <th colSpan={2} className="px-4 py-1.5 text-center text-[10px] font-bold text-green-700 dark:text-green-300 bg-green-50/80 dark:bg-green-950/40 border-l border-green-200 dark:border-green-800 uppercase tracking-wider">{t("inv.table.legend.transfers")}</th>
                <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40 border-l border-amber-200 dark:border-amber-800 uppercase tracking-wider">{t("inv.table.legend.opening")}</th>
                <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-red-700 dark:text-red-300 bg-red-50/80 dark:bg-red-950/40 border-l border-red-200 dark:border-red-800 uppercase tracking-wider">{t("inv.table.legend.waste")}</th>
                <th colSpan={1} className="px-4 py-1.5 text-center text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50/80 dark:bg-sky-950/40 border-l border-sky-200 dark:border-sky-800 uppercase tracking-wider">{t("inv.table.legend.variance")}</th>
                <th rowSpan={2} className="px-4 py-2.5 text-center text-xs font-semibold text-foreground">{t("inv.table.col.status")}</th>
              </tr>
              <tr className="bg-secondary/50 border-b border-border">
                <th className="px-4 py-2 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/30 border-l border-blue-200 dark:border-blue-800">{t("inv.table.col.lastCount")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-950/30">{t("inv.table.col.diff")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-50/60 dark:bg-violet-950/30 border-l border-violet-200 dark:border-violet-800">{t("inv.table.col.totalRcvd")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50/60 dark:bg-green-950/30 border-l border-green-200 dark:border-green-800">{t("inv.table.col.in")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-green-700 dark:text-green-300 bg-green-50/60 dark:bg-green-950/30">{t("inv.table.col.out")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border-l border-amber-200 dark:border-amber-800">{t("inv.table.col.openingQty")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50/60 dark:bg-red-950/30 border-l border-red-200 dark:border-red-800">{t("inv.table.col.netAdj")}</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-50/60 dark:bg-sky-950/30 border-l border-sky-200 dark:border-sky-800">{t("inv.table.col.varPct")}</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, i) => {
                const status = getStatus(row);
                const value = Math.abs(row.inventory_value ?? row.stock_value ?? 0);
                const reorderPct = row.reorder_level > 0 ? Math.min(100, (row.balance_qty / row.reorder_level) * 100) : 100;
                const countData = countMap[row.ingredient_id];
                const countedQty = countData ? Number(countData.counted_qty ?? 0) : null;
                const countDiff = countData ? Number(countData.delta ?? 0) : null;
                const purchaseData = purchaseMap[row.ingredient_id];
                const totalPurchased = purchaseData?.totalQty ?? null;
                const transferData = transferMap[row.ingredient_id];
                const openingQty = openingMap[row.ingredient_id] ?? null;
                const adjustmentData = adjustmentMap[row.ingredient_id];
                const netAdj = adjustmentData?.waste ?? null;
                const isExpanded = expandedRows.has(row.ingredient_id);
                const expectedFromCount = countedQty !== null ? countedQty : null;
                const varDiff = expectedFromCount !== null ? row.balance_qty - expectedFromCount : null;
                const varPct = expectedFromCount !== null && expectedFromCount > 0 ? ((varDiff ?? 0) / expectedFromCount) * 100 : null;

                return (
                  <React.Fragment key={row.ingredient_id ?? i}>
                    <tr className={`border-b border-border hover:bg-secondary/30 transition-colors ${isExpanded ? "bg-secondary/20" : ""}`}>
                      <td className="px-2 py-3 text-center">
                        <button
                          onClick={() => setExpandedRows(s => { const n = new Set(s); n.has(row.ingredient_id) ? n.delete(row.ingredient_id) : n.add(row.ingredient_id); return n; })}
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
                      <td className="px-4 py-3 text-right text-sm font-semibold">{fmtEGP(value)}</td>
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
                                  { label: t("inv.flow.opening"),     value: openingQty !== null && openingQty > 0 ? `+${openingQty.toFixed(3)} ${row.unit}` : "—",                                                               color: "text-amber-600" },
                                  { label: t("inv.flow.purchases"),   value: totalPurchased !== null && totalPurchased > 0 ? `+${totalPurchased.toFixed(3)} ${row.unit}` : "—",                                                    color: "text-violet-600" },
                                  { label: t("inv.flow.transferIn"),  value: transferData?.in && transferData.in > 0 ? `+${transferData.in.toFixed(3)} ${row.unit}` : "—",                                                        color: "text-green-600" },
                                  { label: t("inv.flow.transferOut"), value: transferData?.out && transferData.out > 0 ? `-${transferData.out.toFixed(3)} ${row.unit}` : "—",                                                     color: "text-orange-600" },
                                  { label: t("inv.flow.production"),  value: (() => { const used =productionMap[row.ingredient_id] ?? 0; return used < 0 ? `-${Math.abs(used).toFixed(3)} ${row.unit}` : "—"; })(), color: "text-red-600" },
                                  { label: t("inv.flow.adjustments"), value: netAdj !== null && netAdj !== 0 ? `${netAdj >= 0 ? "+" : ""}${netAdj.toFixed(3)} ${row.unit}` : "—",                                                color: netAdj && netAdj < 0 ? "text-red-600" : "text-green-600" },
                                  { label: t("inv.flow.balance"),     value: `${row.balance_qty.toFixed(3)} ${row.unit}`,                                                                                                          color: "text-foreground font-bold" },
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

export default function InventoryControls() {
  const { t } = useLanguage();
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
  const { data: balances,              loading: balancesLoading, refetch: refetchBalances   } = useApi<StockBalance[]>(() => branchId ? getStockBalances(branchId) : Promise.resolve<StockBalance[]>([]), { deps: [branchId] });
  const { data: finishedGoodsBalances, loading: fgLoading,      refetch: refetchFG          } = useApi<StockBalance[]>(() => branchId ? getFinishedGoodsBalances(branchId) : Promise.resolve<StockBalance[]>([]), { deps: [branchId] });
  const { data: stockCounts,  refetch: refetchCounts     } = useApi<any[]>(() => getStockCountsWithPurchases(branchId || undefined), { deps: [branchId] });
  const { data: purchases,    refetch: refetchPurchases  } = useApi<any[]>(() => getPurchasesByBranch(branchId || undefined),        { deps: [branchId] });
  const { data: transfers,    refetch: refetchTransfers  } = useApi<any[]>(() => getTransfersByBranch(branchId || undefined),        { deps: [branchId] });
  const { data: openingStock, refetch: refetchOpening    } = useApi<any[]>(() => getOpeningStockByBranch(branchId || undefined),     { deps: [branchId] });
  const { data: adjustments,  loading: adjLoading, refetch: refetchAdjustments } = useApi<any[]>(() => getAdjustmentsByBranch(branchId || undefined), { deps: [branchId] });
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

  const safeProductionMovements = productionMovements ?? [];
  // Derived period state (company-wide wins over branch-level)
  const selectedPeriodState    = companyPeriodStatus?.status ?? branchPeriodStatus?.status ?? "open";
  const selectedPeriodClosed   = selectedPeriodState === "closed" || selectedPeriodState === "locked" || Boolean(branchPeriodStatus?.is_closed);
  const selectedPeriodLocked   = selectedPeriodState === "locked" || Boolean(branchPeriodStatus?.is_locked);

  const [countForm,    setCountForm]    = useState({ ingredient_id: 0, entry_date: today(), counted_quantity: 0, notes: "" });
  const [adjForm,      setAdjForm]      = useState({ ingredient_id: 0, entry_date: today(), quantity_delta: 0, reason: "", notes: "", requires_approval: false });
  const [transferForm, setTransferForm] = useState({ from_branch_id: branchId, to_branch_id: 0, ingredient_id: 0, entry_date: today(), quantity: 0, notes: "" });
  const [openingForm,  setOpeningForm]  = useState({ ingredient_id: 0, entry_date: today(), qty_issued: 0, notes: "" });
  const [periodForm,   setPeriodForm]   = useState({ period_label: "", entry_date: today(), notes: "" });

  const safeBalances    = balances ?? [];
  const safeFG          = finishedGoodsBalances ?? [];
  const safeCounts      = stockCounts ?? [];
  const safePurchases   = purchases ?? [];
  const safeTransfers   = transfers ?? [];
  const safeOpening     = openingStock ?? [];
  const safeAdjustments = adjustments ?? [];
  const safeSnapshots   = periodSnapshots ?? [];

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
      rawValue: balances.reduce(
        (s, b) => s + Math.abs(b.inventory_value ?? 0),
        0
      ),

      fgValue: fg.reduce(
        (s, b) => s + Math.abs(b.inventory_value ?? b.stock_value ?? 0),
        0
      ),

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
  const alerts = useMemo(() =>
    safeBalances.filter(b => b.negative_alert || b.reorder_alert)
      .sort((a, b) => (a.negative_alert ? -1 : 1)).slice(0, 8),
    [safeBalances]
  );

  function refetchAll() {
    refetchBalances?.(); refetchFG?.(); refetchCounts?.(); refetchPurchases?.();
    refetchTransfers?.(); refetchOpening?.(); refetchAdjustments?.(); refetchSnapshots?.();
    refetchCompanyPeriodStatus?.(); refetchBranchPeriodStatus?.(); refetchProductionMovements?.();
  }
  const WRITE_MODALS: ModalType[] = ["count", "adjustment", "transfer", "opening", "periodClose"];

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
    const ok = await addStockCount({ branch_id: branchId, ingredient_id: countForm.ingredient_id, entry_date: countForm.entry_date, counted_quantity: countForm.counted_quantity, notes: countForm.notes, user_id: currentUserId });
    setSaving(false);
    if (ok) { setModal(null); setCountForm({ ingredient_id: 0, entry_date: today(), counted_quantity: 0, notes: "" }); refetchAll(); }
    else setFormError(t("inv.err.saveFailed"));
  }

  async function handleSaveAdjustment() {
    if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
    if (!adjForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
    if (!adjForm.reason.trim()) { setFormError(t("inv.err.reasonRequired")); return; }
    setSaving(true); setFormError("");
    const ok = await addStockAdjustment({ branch_id: branchId, ingredient_id: adjForm.ingredient_id, entry_date: adjForm.entry_date, counted_quantity: adjForm.quantity_delta, notes: `${adjForm.reason}: ${adjForm.notes}`.trim(), user_id: currentUserId });
    setSaving(false);
    if (ok) { setModal(null); setAdjForm({ ingredient_id: 0, entry_date: today(), quantity_delta: 0, reason: "", notes: "", requires_approval: false }); refetchAll(); }
    else setFormError(t("inv.err.saveFailed"));
  }

  async function handleSaveTransfer() {
    if (!transferForm.from_branch_id) { setFormError(t("inv.err.sourceBranch")); return; }
    if (!transferForm.to_branch_id) { setFormError(t("inv.err.destBranch")); return; }
    if (transferForm.from_branch_id === transferForm.to_branch_id) { setFormError(t("inv.err.sameBranch")); return; }
    if (!transferForm.ingredient_id) { setFormError(t("inv.err.selectIngredient")); return; }
    if (transferForm.quantity <= 0) { setFormError(t("inv.err.qtyPositive")); return; }
    setSaving(true); setFormError("");
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
    const ok = await addOpeningStock({ branch_id: branchId, ingredient_id: openingForm.ingredient_id, entry_date: openingForm.entry_date, qty_issued: openingForm.qty_issued, issued_to: "opening_stock", notes: openingForm.notes });
    setSaving(false);
    if (ok) { setModal(null); setOpeningForm({ ingredient_id: 0, entry_date: today(), qty_issued: 0, notes: "" }); refetchAll(); }
    else setFormError(t("inv.err.saveFailed"));
  }

  async function handlePeriodClose() {
    if (!branchId) { setFormError(t("inv.err.selectBranch")); return; }
    if (!periodForm.period_label.trim()) { setFormError(t("inv.err.periodLabel")); return; }
    setSaving(true); setFormError("");
    const closingValue   = stats.rawValue + stats.fgValue;
    const lastSnapshot   = safeSnapshots[0];
    const openingValue   = lastSnapshot ? lastSnapshot.closing_value : 0;
    const purchasesValue = stats.totalPurchasesValue;
    const cogs           = openingValue + purchasesValue - closingValue;
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
    try { await approveAdjustment(id, "approved", notes); setDismissedApprovals(prev => new Set(prev).add(id)); }
    finally { refetchAdjustments?.(); }
  }

  async function handleReject(id: number, notes: string) {
    try { await approveAdjustment(id, "rejected", notes); setDismissedApprovals(prev => new Set(prev).add(id)); }
    finally { refetchAdjustments?.(); }
  }

  const tabs: { key: MainTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "dashboard",     label: t("inv.tab.dashboard"),     icon: <BarChart2 className="w-4 h-4" /> },
    { key: "rawMaterials",  label: t("inv.tab.rawMaterials"),  icon: <Package className="w-4 h-4" /> },
    { key: "finishedGoods", label: t("inv.tab.finishedGoods"), icon: <Layers className="w-4 h-4" /> },
    { key: "variance",      label: t("inv.tab.variance"),      icon: <TrendingDown className="w-4 h-4" /> },
    { key: "cogs",          label: t("inv.tab.cogs"),          icon: <BarChart2 className="w-4 h-4" /> },
    { key: "auditLog",      label: t("inv.tab.auditLog"),      icon: <History className="w-4 h-4" /> },
  ];

  const adjReasons = [
    { key: "inv.modal.adj.reason.waste",     label: t("inv.modal.adj.reason.waste") },
    { key: "inv.modal.adj.reason.damage",    label: t("inv.modal.adj.reason.damage") },
    { key: "inv.modal.adj.reason.theft",     label: t("inv.modal.adj.reason.theft") },
    { key: "inv.modal.adj.reason.recount",   label: t("inv.modal.adj.reason.recount") },
    { key: "inv.modal.adj.reason.spoilage",  label: t("inv.modal.adj.reason.spoilage") },
    { key: "inv.modal.adj.reason.expiry",    label: t("inv.modal.adj.reason.expiry") },
    { key: "inv.modal.adj.reason.prodError", label: t("inv.modal.adj.reason.prodError") },
    { key: "inv.modal.adj.reason.other",     label: t("inv.modal.adj.reason.other") },
  ];

  return (
    <div className="space-y-6">
      {/* ── Modals ── */}
      {modal === "count" && (
        <Modal
          title={t("inv.modal.count.title")} subtitle={t("inv.modal.count.sub")}
          onClose={() => setModal(null)} onSave={handleSaveCount} saving={saving}
          cancelLabel={t("inv.modal.cancel")} saveLabel={t("inv.modal.save")}
        >
          {formError && <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2"><AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}</p>}
          <Field label={t("inv.modal.count.field.ingredient")}>
            <IngredientSelect balances={safeBalances} value={countForm.ingredient_id} onChange={id => setCountForm({ ...countForm, ingredient_id: id })} placeholder={t("inv.modal.selectIngredient")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("inv.modal.count.field.date")}><input type="date" className={inputClass} value={countForm.entry_date} onChange={e => setCountForm({ ...countForm, entry_date: e.target.value })} /></Field>
            <Field label={t("inv.modal.count.field.qty")}><input type="number" min={0} step={0.001} className={inputClass} placeholder="0.000" value={countForm.counted_quantity || ""} onChange={e => setCountForm({ ...countForm, counted_quantity: Number(e.target.value) })} /></Field>
          </div>
          <Field label={t("inv.modal.count.field.notes")}><textarea className={inputClass} rows={2} placeholder={t("inv.modal.notesPlaceholder")} value={countForm.notes} onChange={e => setCountForm({ ...countForm, notes: e.target.value })} /></Field>
          <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-800 rounded-lg px-3 py-2">{t("inv.modal.count.hint")}</p>
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
          <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
            <input type="checkbox" id="reqApproval" checked={adjForm.requires_approval} onChange={e => setAdjForm({ ...adjForm, requires_approval: e.target.checked })} className="w-4 h-4 accent-amber-500" />
            <label htmlFor="reqApproval" className="text-xs font-medium text-amber-800 dark:text-amber-300">
              <Shield className="w-3 h-3 inline mr-1" />{t("inv.modal.adj.field.approval")}
            </label>
          </div>
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
              <select className={inputClass} value={transferForm.from_branch_id || ""} onChange={e => setTransferForm({ ...transferForm, from_branch_id: Number(e.target.value) })}>
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
            <IngredientSelect balances={safeBalances} value={transferForm.ingredient_id} onChange={id => setTransferForm({ ...transferForm, ingredient_id: id })} placeholder={t("inv.modal.selectIngredient")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("inv.modal.transfer.field.date")}><input type="date" className={inputClass} value={transferForm.entry_date} onChange={e => setTransferForm({ ...transferForm, entry_date: e.target.value })} /></Field>
            <Field label={t("inv.modal.transfer.field.qty")}><input type="number" min={0.001} step={0.001} className={inputClass} placeholder="0.000" value={transferForm.quantity || ""} onChange={e => setTransferForm({ ...transferForm, quantity: Number(e.target.value) })} /></Field>
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
              <div className="bg-background rounded-lg p-2 border border-border"><p className="text-muted-foreground">{t("inv.modal.period.totalPurch")}</p><p className="font-bold text-violet-600">{fmtEGP(stats.totalPurchasesValue)}</p></div>
              <div className="bg-background rounded-lg p-2 border border-border"><p className="text-muted-foreground">{t("inv.modal.period.estCogs")}</p><p className="font-bold text-amber-600">{fmtEGP(stats.totalPurchasesValue - (stats.rawValue + stats.fgValue))}</p></div>
            </div>
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

      {showPOModal && <POGeneratorModal balances={safeBalances} onClose={() => setShowPOModal(false)} t={t} />}

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
            <Button variant="outline" size="sm" onClick={() => setShowPOModal(true)} className="border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30">
              <ShoppingCart className="w-4 h-4 mr-1.5" /> {t("inv.generatePO")}
            </Button>
          )}
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

      {/* ── NEW: Period closed/locked alert banner (mirrors Finance) ─────────── */}
      {selectedPeriodClosed && (
        <Card className={`${selectedPeriodLocked ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20" : "border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20"} p-4`}>
          <p className={`flex items-center gap-2 text-sm ${selectedPeriodLocked ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <Lock className="h-4 w-4" />
            {selectedPeriodLocked
              ? `${workingPeriod} is locked for the whole company. No inventory edits are allowed.`
              : `${workingPeriod} is closed for the whole company. Inventory entries are restricted.`}
          </p>
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
                  <Button size="sm" variant="outline" onClick={() => setShowPOModal(true)} className="text-xs">
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
                      : t("inv.alerts.lowDetail").replace("{qty}", alert.balance_qty.toFixed(2)).replace("{reorder}", alert.reorder_level.toFixed(2)).replace("{unit}", alert.unit)}
                  </p>
                </div>
              ))}
            </Card>
          </div>

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
          transfers={safeTransfers} openingStock={safeOpening} adjustments={safeAdjustments} productionMovements={safeProductionMovements} t={t} />
      )}
      {activeTab === "rawMaterials" && !branchId && (
        <Card className="p-12 text-center"><p className="text-sm text-muted-foreground">{t("inv.table.selectBranch")}</p></Card>
      )}

      {/* ── Finished Goods Tab ── */}
      {activeTab === "finishedGoods" && branchId > 0 && (
        <StockTableCard title={t("inv.tab.finishedGoods")} icon={<Layers className="w-5 h-5 text-white" />}
          rows={safeFG} loading={fgLoading} isFinished={true} branchName={branchName}
          accentColor="from-violet-700 to-violet-500" branchId={branchId} stockCounts={safeCounts} purchases={safePurchases}
          transfers={safeTransfers} openingStock={safeOpening} adjustments={safeAdjustments} productionMovements={safeProductionMovements} t={t} />
      )}
      {activeTab === "finishedGoods" && !branchId && (
        <Card className="p-12 text-center"><p className="text-sm text-muted-foreground">{t("inv.table.selectBranch")}</p></Card>
      )}

      {/* ── Variance Tab ── */}
      {activeTab === "variance" && <VarianceReport branchId={branchId} balances={safeBalances} fgBalances={safeFG} t={t} />}

      {/* ── COGS Tab ── */}
      {activeTab === "cogs" && <CogsPanel snapshots={safeSnapshots} balances={[...safeBalances, ...safeFG]} purchases={safePurchases} branchId={branchId} t={t} />}

      {/* ── Audit Log Tab ── */}
      {activeTab === "auditLog" && <AuditLogPanel branchId={branchId} t={t} />}
    </div>
  );
}