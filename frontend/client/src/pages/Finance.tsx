import { useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertCircle, CheckCircle2, Loader2, Lock, Plus,
  Receipt, RefreshCw, TrendingUp, Wallet, X, FileText,
  BarChart2, DollarSign, TrendingDown, ArrowUpRight, ArrowDownRight,
  Printer, Calendar, ChevronRight, Activity,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import {
  addAccrual, addDepreciation, addExpense, addPayroll, addPrepayment,
  approveRequest, rejectRequest, closePeriod, getAccrualEntries, getBranches,
  getBudgetVsActual, getDepreciationEntries, getExpenses, getFinanceKpi,
  generatePeriodBackups, getPeriodBackups, getPeriodStatus,
  getPayrollEntries, getPendingApprovals, getPrepaymentEntries, getSalesByBranch,
  isPeriodClosed, setBudget, setPeriodStatus,
} from "@/lib/api";
import type {
  AccrualEntryRow, ApprovalRow, Branch, BudgetVsActualRow,
  DepreciationEntryRow, ExpenseRow, FinanceKpiRow, PayrollEntryRow,
  PeriodBackupRow, PeriodStatusRow, PeriodStatusValue, PrepaymentEntryRow, SaleRow,
} from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  formatCurrency as formatCurrencyValue,
  formatDateTime,
} from "@/lib/localization";

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalType =
  | "expense" | "payroll" | "accrual" | "depreciation"
  | "prepayment" | "budget" | "close" | "periodStatus" | null;

type ActiveTab = "overview" | "pl" | "budget" | "activity" | "approvals";

type FinanceActivityRow = {
  id: string;
  entry_date: string;
  type: string;
  description: string;
  amount: number;
  notes: string;
  branch_name: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

const labelClass = "block text-xs font-medium text-muted-foreground mb-1";

const budgetCategories = [
  "food_cost", "labor", "rent", "utilities", "marketing", "other",
] as const;

const expenseGroups = ["operating", "admin", "finance", "payroll"] as const;

// ─── Expense label helpers ────────────────────────────────────────────────────

const EXPENSE_LABELS: Record<string, { label: string; color: string }> = {
  rent:         { label: "Rent & Facilities", color: "bg-blue-500"   },
  labor:        { label: "Salaries & Wages",  color: "bg-green-500"  },
  utilities:    { label: "Utilities",         color: "bg-yellow-500" },
  marketing:    { label: "Marketing & Ads",   color: "bg-purple-500" },
  delivery:     { label: "Delivery Fees",     color: "bg-orange-500" },
  food_cost:    { label: "Food Cost",         color: "bg-red-500"    },
  depreciation: { label: "Depreciation",      color: "bg-gray-500"   },
  other:        { label: "Other Expenses",    color: "bg-slate-400"  },
};

function expenseLabel(cat: string) {
  return EXPENSE_LABELS[cat]?.label ?? labelize(cat);
}
function expenseColor(cat: string) {
  return EXPENSE_LABELS[cat]?.color ?? "bg-indigo-400";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function Modal({ title, saving, onClose, onSave, children, tCancel, tSave }: {
  title: string; saving: boolean; onClose: () => void;
  onSave: () => void; children: ReactNode;
  tCancel: string; tSave: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{tCancel}</Button>
          <Button onClick={onSave} disabled={saving} className="min-w-[92px]">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : tSave}
          </Button>
        </div>
      </div>
    </div>
  );
}

function today() { return new Date().toISOString().split("T")[0]; }
function currentPeriod() { return today().slice(0, 7); }
function getPeriodEnd(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month, 0).toISOString().split("T")[0];
}
function defaultDateForPeriod(period: string) {
  return period === currentPeriod() ? today() : `${period}-01`;
}
function formatCurrency(value: number) {
  return formatCurrencyValue(value, { maximumFractionDigits: 2 });
}
function formatPercent(value: number) { return `${value.toFixed(1)}%`; }
function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
function emptyKpi(branchId: number, period: string): FinanceKpiRow {
  return { branch_id: branchId, period, revenue: 0, food_cost: 0, food_cost_pct: 0, labor_cost: 0, labor_cost_pct: 0, waste_cost: 0, gross_profit: 0, net_profit: 0 };
}

// ─── PDF Export (strings kept in English as they're printed documents) ────────

function exportPLtoPDF(
  branchName: string, period: string, summary: any,
  expenseBreakdown: any[], budgetViewRows: any[]
) {
  const now = formatDateTime(new Date());
  const isProfit = summary.operatingResult >= 0;
  const gpMargin = summary.revenue > 0 ? (summary.grossProfit / summary.revenue) * 100 : 0;
  const netMargin = summary.revenue > 0 ? (summary.operatingResult / summary.revenue) * 100 : 0;
  const depTotal = expenseBreakdown.find((r: any) => r.category === "depreciation")?.amount ?? 0;
  const ebitda = summary.grossProfit - summary.recognizedExpenses + depTotal;

  const expenseRows = expenseBreakdown.map((r: any) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155">${expenseLabel(r.category)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#334155">${formatCurrency(r.amount)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b">
        ${summary.recognizedExpenses > 0 ? ((r.amount / summary.recognizedExpenses) * 100).toFixed(1) + "%" : "—"}
      </td>
    </tr>`).join("");

  const budgetRowsHtml = budgetViewRows.map((r: any) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155">${labelize(r.category)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${formatCurrency(r.budget_amount)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${formatCurrency(r.actual_amount)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:${r.variance >= 0 ? "#16a34a" : "#dc2626"};font-weight:600">${formatCurrency(r.variance)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#64748b">${formatPercent(r.pct_used)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>P&L Report — ${branchName} — ${period}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;font-size:11px;color:#1e293b;padding:28px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e2e8f0}
  .badge{display:inline-block;background:#dbeafe;color:#1d4ed8;font-size:9px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
  .title{font-size:22px;font-weight:800;color:#0f172a}
  .sub{font-size:11px;color:#64748b;margin-top:2px}
  .meta{text-align:right;font-size:10px;color:#94a3b8}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:24px}
  .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}
  .kpi-label{font-size:9px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  .kpi-value{font-size:16px;font-weight:800}
  .section{margin-bottom:24px}
  .section-title{font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
  .pl-row{display:flex;justify-content:space-between;padding:7px 12px;border-radius:6px;margin-bottom:3px}
  .pl-row.total{background:#f1f5f9;font-weight:700;font-size:12px}
  .pl-row.ebitda{background:#eff6ff;font-weight:700;color:#1d4ed8}
  .pl-row.profit{background:${isProfit ? "#dcfce7" : "#fee2e2"};font-weight:800;font-size:13px;color:${isProfit ? "#15803d" : "#dc2626"}}
  table{width:100%;border-collapse:collapse}
  th{background:#1e293b;color:#f8fafc;padding:8px 12px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
  th.right{text-align:right}
  .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;text-align:center}
  @media print{body{padding:14px}@page{margin:8mm;size:A4}}
</style></head><body>
<div class="header">
  <div>
    <div class="badge">Enterprise Finance Report</div>
    <div class="title">Profit & Loss Statement</div>
    <div class="sub">Branch: ${branchName} · Period: ${period}</div>
  </div>
  <div class="meta">Generated: ${now}<br/>STARK AI Costing System</div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value" style="color:#1d4ed8">${formatCurrency(summary.revenue)}</div></div>
  <div class="kpi"><div class="kpi-label">Gross Profit</div><div class="kpi-value" style="color:${summary.grossProfit >= 0 ? "#15803d" : "#dc2626"}">${formatCurrency(summary.grossProfit)}<br/><span style="font-size:10px;color:#64748b">${formatPercent(gpMargin)} margin</span></div></div>
  <div class="kpi"><div class="kpi-label">EBITDA</div><div class="kpi-value" style="color:#4f46e5">${formatCurrency(ebitda)}</div></div>
  <div class="kpi"><div class="kpi-label">Total Costs</div><div class="kpi-value" style="color:#d97706">${formatCurrency(summary.foodCost + summary.recognizedExpenses)}</div></div>
  <div class="kpi"><div class="kpi-label">Net ${isProfit ? "Profit" : "Loss"}</div><div class="kpi-value" style="color:${isProfit ? "#15803d" : "#dc2626"}">${formatCurrency(Math.abs(summary.operatingResult))}<br/><span style="font-size:10px;color:#64748b">${formatPercent(Math.abs(netMargin))} margin</span></div></div>
</div>
<div class="section">
  <div class="section-title">Income Statement</div>
  <div class="pl-row"><span>Revenue (Net Sales)</span><span style="color:#1d4ed8;font-weight:700">${formatCurrency(summary.revenue)}</span></div>
  <div class="pl-row" style="color:#64748b"><span style="padding-left:12px">− Cost of Goods Sold (Food Cost)</span><span>(${formatCurrency(summary.foodCost)})</span></div>
  <div class="pl-row" style="color:#64748b"><span style="padding-left:12px">− Waste & Damage Cost</span><span>(${formatCurrency(summary.wasteCost)})</span></div>
  <div class="pl-row total"><span>GROSS PROFIT — ${formatPercent(gpMargin)} margin</span><span style="color:${summary.grossProfit >= 0 ? "#15803d" : "#dc2626"}">${formatCurrency(summary.grossProfit)}</span></div>
  <div style="height:6px"></div>
  <div class="pl-row" style="color:#64748b"><span>  − Operating Expenses (total)</span><span>(${formatCurrency(summary.recognizedExpenses)})</span></div>
  ${expenseBreakdown.map((r: any) => `<div class="pl-row" style="color:#94a3b8;font-size:10px"><span style="padding-left:20px">· ${expenseLabel(r.category)}</span><span>(${formatCurrency(r.amount)})</span></div>`).join("")}
  <div style="height:6px"></div>
  <div class="pl-row ebitda"><span>EBITDA (excl. depreciation)</span><span>${formatCurrency(ebitda)}</span></div>
  <div style="height:6px"></div>
  <div class="pl-row profit"><span>${isProfit ? "NET PROFIT" : "NET LOSS"} — ${formatPercent(Math.abs(netMargin))} margin</span><span>${formatCurrency(Math.abs(summary.operatingResult))}</span></div>
</div>
${budgetViewRows.length ? `
<div class="section">
  <div class="section-title">Budget vs Actual</div>
  <table>
    <thead><tr><th>Category</th><th class="right">Budget</th><th class="right">Actual</th><th class="right">Variance</th><th class="right">Used %</th></tr></thead>
    <tbody>${budgetRowsHtml}</tbody>
  </table>
</div>` : ""}
<div class="footer">STARK AI Costing System · Finance Report · ${branchName} · ${period} · Confidential</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function exportActivityToPDF(branchName: string, period: string, activity: FinanceActivityRow[]) {
  const now = formatDateTime(new Date());
  const total = activity.reduce((s, r) => s + r.amount, 0);
  const rows = activity.map(r => `
    <tr>
      <td>${r.entry_date}</td>
      <td><span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:600">${r.type}</span></td>
      <td>${r.description}</td>
      <td style="text-align:right;font-weight:600;color:#1d4ed8">${formatCurrency(r.amount)}</td>
      <td style="color:#64748b">${r.notes || "—"}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Finance Activity — ${branchName} — ${period}</title>
<style>
  body{font-family:'Segoe UI',sans-serif;font-size:11px;color:#1e293b;padding:24px}
  .header{display:flex;justify-content:space-between;border-bottom:2px solid #e2e8f0;padding-bottom:14px;margin-bottom:20px}
  .title{font-size:20px;font-weight:800;color:#0f172a}
  .sub{font-size:11px;color:#64748b;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  th{background:#1e293b;color:white;padding:8px 10px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase}
  td{padding:7px 10px;border-bottom:1px solid #f1f5f9;color:#334155}
  tr:nth-child(even) td{background:#f8fafc}
  .footer{margin-top:16px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;text-align:center}
  @media print{@page{margin:8mm;size:A4 landscape}}
</style></head><body>
<div class="header">
  <div><div class="title">Financial Activity Log</div><div class="sub">Branch: ${branchName} · Period: ${period} · ${activity.length} entries · Total: ${formatCurrency(total)}</div></div>
  <div style="text-align:right;font-size:10px;color:#94a3b8">Generated: ${now}</div>
</div>
<table>
  <thead><tr><th>Date</th><th>Type</th><th>Description</th><th style="text-align:right">Amount</th><th>Notes</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">STARK AI Costing System · Activity Report · ${branchName} · ${period}</div>
<script>window.onload = () => window.print();</script>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon, trend, trendLabel }: {
  label: string; value: string; sub?: string;
  color: string; icon: ReactNode; trend?: number; trendLabel?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
          <p className={`text-2xl font-bold mt-1.5 ${color}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center opacity-80 bg-secondary dark:bg-white/10`}>
          {icon}
        </div>
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {Math.abs(trend).toFixed(1)}% {trendLabel}
        </div>
      )}
    </Card>
  );
}

// ─── P&L Statement Component ──────────────────────────────────────────────────

function PLStatement({ summary, branchName, period, expenseBreakdown, budgetViewRows }: {
  summary: any; branchName: string; period: string;
  expenseBreakdown: any[]; budgetViewRows: any[];
}) {
  const { t } = useLanguage();
  const [plTab, setPlTab] = useState<"pl" | "expenses" | "comparison">("pl");
  const [showAllExpenses, setShowAllExpenses] = useState(false);

  const isProfit     = summary.operatingResult >= 0;
  const gpMargin     = summary.revenue > 0 ? (summary.grossProfit / summary.revenue) * 100 : 0;
  const netMargin    = summary.revenue > 0 ? (summary.operatingResult / summary.revenue) * 100 : 0;
  const depTotal     = expenseBreakdown.find((r: any) => r.category === "depreciation")?.amount ?? 0;
  const ebitda       = summary.grossProfit - summary.recognizedExpenses + depTotal;
  const ebitdaMargin = summary.revenue > 0 ? (ebitda / summary.revenue) * 100 : 0;
  const opexRatio    = summary.revenue > 0 ? (summary.recognizedExpenses / summary.revenue) * 100 : 0;

  const topExpenses   = showAllExpenses ? expenseBreakdown : expenseBreakdown.slice(0, 5);
  const totalBudget   = budgetViewRows.reduce((s: number, r: any) => s + r.budget_amount, 0);
  const totalActual   = budgetViewRows.reduce((s: number, r: any) => s + r.actual_amount, 0);
  const totalVariance = totalBudget - totalActual;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">{t("finance.pl.title")}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{branchName} · {period}</p>
        </div>
        <Button size="sm" variant="outline"
          onClick={() => exportPLtoPDF(branchName, period, summary, expenseBreakdown, budgetViewRows)}
          className="gap-2">
          <Printer className="w-4 h-4" /> {t("finance.pl.exportPdf")}
        </Button>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label={t("finance.kpi.revenue")}
          value={formatCurrency(summary.revenue)}
          color="text-blue-600 dark:text-blue-400"
          icon={<DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />} />

        <KpiCard label={t("finance.kpi.grossProfit")}
          value={formatCurrency(summary.grossProfit)}
          color={summary.grossProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
          icon={<TrendingUp className="w-5 h-5" />}
          sub={`${formatPercent(gpMargin)} ${t("finance.pl.margin")}`} />

        <KpiCard label={t("finance.kpi.ebitda")}
          value={formatCurrency(ebitda)}
          color={ebitda >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-red-600 dark:text-red-400"}
          icon={<Activity className="w-5 h-5" />}
          sub={`${formatPercent(ebitdaMargin)} ${t("finance.pl.margin")}`} />

        <KpiCard label={t("finance.kpi.totalCosts")}
          value={formatCurrency(summary.foodCost + summary.recognizedExpenses)}
          color="text-amber-600 dark:text-amber-400"
          icon={<Receipt className="w-5 h-5 text-amber-600 dark:text-amber-400" />} />

        <KpiCard label={isProfit ? t("finance.kpi.netProfit") : t("finance.kpi.netLoss")}
          value={formatCurrency(Math.abs(summary.operatingResult))}
          color={isProfit ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
          icon={isProfit ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
          sub={`${formatPercent(Math.abs(netMargin))} ${t("finance.pl.margin")}`} />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto pb-px">
        {(["pl", "expenses", "comparison"] as const).map(tab => (
          <button key={tab} onClick={() => setPlTab(tab)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors
              ${plTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {tab === "pl" ? t("finance.pl.incomeStatement") : tab === "expenses" ? t("finance.pl.costBreakdown") : t("finance.pl.vsBudget")}
          </button>
        ))}
      </div>

      {/* ── Income Statement Tab ── */}
      {plTab === "pl" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-secondary/20">
              <h3 className="font-semibold text-sm text-foreground">{t("finance.pl.incomeStatement")}</h3>
            </div>
            <div className="p-4 space-y-0.5">
              {/* Revenue row */}
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-secondary/30">
                <span className="text-sm font-medium text-foreground">{t("finance.pl.netSales")}</span>
                <span className="text-sm font-bold font-mono text-blue-600 dark:text-blue-400">{formatCurrency(summary.revenue)}</span>
              </div>
              {/* Food cost */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary/30">
                <span className="text-sm font-medium text-foreground" style={{ paddingLeft: 14 }}>
                  <span className="text-muted-foreground mr-1">─</span>{t("finance.pl.foodCostCogs")}
                </span>
                <span className="text-sm font-bold font-mono text-red-500 dark:text-red-400">({formatCurrency(summary.foodCost)})</span>
              </div>
              {/* Waste */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary/30">
                <span className="text-sm font-medium text-foreground" style={{ paddingLeft: 14 }}>
                  <span className="text-muted-foreground mr-1">─</span>{t("finance.pl.wasteAndDamage")}
                </span>
                <span className="text-sm font-bold font-mono text-red-400 dark:text-red-300">({formatCurrency(summary.wasteCost)})</span>
              </div>

              <div className="my-1.5 border-t border-border/60" />

              {/* Gross Profit */}
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border
                ${summary.grossProfit >= 0
                  ? "bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800/40"
                  : "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/40"}`}>
                <span className="text-sm font-bold text-foreground">
                  {t("finance.pl.grossProfit")}
                  <span className="text-[10px] text-muted-foreground font-normal ml-2">({formatPercent(gpMargin)} {t("finance.pl.margin")})</span>
                </span>
                <span className={`text-sm font-bold font-mono ${summary.grossProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {formatCurrency(summary.grossProfit)}
                </span>
              </div>

              {/* Operating Expenses */}
              <div className="pt-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-3 py-1">
                  {t("finance.pl.operatingExp")}
                </p>
                {topExpenses.map((r: any) => (
                  <div key={r.category} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary/20">
                    <span className="text-sm font-medium text-foreground flex items-center gap-2" style={{ paddingLeft: 14 }}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${expenseColor(r.category)}`} />
                      {expenseLabel(r.category)}
                    </span>
                    <span className="text-sm font-bold font-mono text-amber-700 dark:text-amber-400">({formatCurrency(r.amount)})</span>
                  </div>
                ))}
                {expenseBreakdown.length > 5 && (
                  <button onClick={() => setShowAllExpenses(s => !s)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-5 py-1">
                    <ChevronRight className={`w-3 h-3 transition-transform ${showAllExpenses ? "rotate-90" : ""}`} />
                    {showAllExpenses
                      ? t("finance.pl.showLess")
                      : t("finance.pl.moreCategories").replace("{count}", String(expenseBreakdown.length - 5))}
                  </button>
                )}
              </div>

              <div className="my-1.5 border-t border-border/60" />

              {/* EBITDA */}
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border
                ${ebitda >= 0
                  ? "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100 dark:border-indigo-800/40"
                  : "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/40"}`}>
                <span className="text-sm font-bold text-foreground">
                  {t("finance.pl.ebitda")}
                </span>
                <span className={`text-sm font-bold font-mono ${ebitda >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-red-600 dark:text-red-400"}`}>
                  {formatCurrency(ebitda)}
                </span>
              </div>

              <div className="my-1.5 border-t border-border/60" />

              {/* Net Profit / Loss */}
              <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border
                ${isProfit
                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/40"
                  : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40"}`}>
                <span className="text-sm font-bold text-foreground">
                  {isProfit ? t("finance.pl.netProfit") : t("finance.pl.netLoss")}
                  <span className="text-[10px] text-muted-foreground font-normal ml-2">({formatPercent(Math.abs(netMargin))} {t("finance.pl.margin")})</span>
                </span>
                <span className={`text-sm font-bold font-mono ${isProfit ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {summary.operatingResult < 0
                    ? `(${formatCurrency(Math.abs(summary.operatingResult))})`
                    : formatCurrency(summary.operatingResult)}
                </span>
              </div>
            </div>

            {/* Key Ratios */}
            <div className="px-5 py-4 border-t border-border bg-secondary/10">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t("finance.pl.keyRatios")}</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: t("finance.kpi.foodCostPct"),    value: formatPercent(summary.foodCostPct),  warn: summary.foodCostPct > 35,  bench: "< 35%" },
                  { label: t("finance.kpi.laborCostPct"),   value: formatPercent(summary.laborCostPct), warn: summary.laborCostPct > 30, bench: "< 30%" },
                  { label: t("finance.ratio.grossMargin"),  value: formatPercent(gpMargin),             warn: gpMargin < 50,             bench: "> 50%" },
                  { label: t("finance.ratio.netMargin"),    value: formatPercent(netMargin),            warn: netMargin < 10,            bench: "> 10%" },
                  { label: t("finance.ratio.ebitdaMargin"), value: formatPercent(ebitdaMargin),         warn: ebitda < 0,                bench: "> 15%" },
                  { label: t("finance.ratio.opexRatio"),    value: formatPercent(opexRatio),            warn: opexRatio > 50,            bench: "< 50%" },
                ].map(r => (
                  <div key={r.label} className={`rounded-lg px-3 py-2 border ${
                    r.warn
                      ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40"
                      : "bg-secondary/30 border-border"
                  }`}>
                    <p className="text-[10px] text-muted-foreground">{r.label}</p>
                    <p className={`text-sm font-bold ${r.warn ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{r.value}</p>
                    <p className="text-[9px] text-muted-foreground">{t("finance.pl.benchmark")}: {r.bench}</p>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Cost Waterfall */}
          <Card className="p-5">
            <p className="text-sm font-semibold text-foreground mb-4">{t("finance.pl.costWaterfall")}</p>
            <div className="space-y-3">
              {[
                // ✅ collapse bar to 0 when there's no revenue
                { label: t("finance.kpi.revenue"),   value: summary.revenue,            pct: summary.revenue > 0 ? 100 : 0, color: "bg-blue-500" },
                { label: t("finance.pl.foodCost"),   value: summary.foodCost,           pct: summary.revenue > 0 ? (summary.foodCost / summary.revenue) * 100 : 0,                        color: "bg-red-400"   },
                { label: t("finance.pl.waste"),      value: summary.wasteCost,          pct: summary.revenue > 0 ? (summary.wasteCost / summary.revenue) * 100 : 0,                       color: "bg-orange-400"},
                { label: t("finance.pl.opex"),       value: summary.recognizedExpenses, pct: summary.revenue > 0 ? (summary.recognizedExpenses / summary.revenue) * 100 : 0,              color: "bg-amber-400" },
                { label: t("finance.pl.netResult"),  value: Math.abs(summary.operatingResult), pct: summary.revenue > 0 ? Math.abs(summary.operatingResult / summary.revenue) * 100 : 0, color: isProfit ? "bg-green-500" : "bg-red-500" },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{r.label}</span>
                  <div className="flex-1 h-2.5 bg-secondary rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${r.color}`} style={{ width: `${Math.min(100, r.pct)}%`, opacity: 0.8 }} />
                  </div>
                  <span className="text-xs font-mono font-semibold text-foreground w-28 text-right flex-shrink-0">
                    {formatCurrency(r.value)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Cost Breakdown Tab ── */}
      {plTab === "expenses" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("finance.pl.totalOpex")}</p>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(summary.recognizedExpenses)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatPercent(summary.revenue > 0 ? (summary.recognizedExpenses / summary.revenue) * 100 : 0)} of revenue
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("finance.pl.categories")}</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{expenseBreakdown.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("finance.pl.categoriesDesc")}</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-secondary/20">
              <h3 className="font-semibold text-sm">{t("finance.pl.detailedBreakdown")}</h3>
            </div>
            {!expenseBreakdown.length ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">{t("finance.pl.noExpenseData")}</p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {expenseBreakdown.map((row: any) => {
                  const pct = summary.recognizedExpenses > 0 ? (row.amount / summary.recognizedExpenses) * 100 : 0;
                  return (
                    <div key={row.category}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${expenseColor(row.category)}`} />
                          <span className="text-sm font-medium text-foreground">{expenseLabel(row.category)}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{formatPercent(pct)}</span>
                          <span className="text-sm font-bold text-foreground w-28 text-right">{formatCurrency(row.amount)}</span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${expenseColor(row.category)}`}
                          style={{ width: `${Math.min(100, pct)}%`, opacity: 0.7 }} />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-3 border-t border-border flex justify-between text-sm font-bold">
                  <span>{t("finance.pl.totalOpexRow")}</span>
                  <span className="text-amber-600 dark:text-amber-400">{formatCurrency(summary.recognizedExpenses)}</span>
                </div>
              </div>
            )}
          </Card>

          {expenseBreakdown.length > 0 && (
            <Card className="p-4 border-amber-200 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/20">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2">{t("finance.pl.insights")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                <strong>{expenseLabel(expenseBreakdown[0].category)}</strong>{" "}
                {t("finance.pl.largestCost")
                  .replace("{cat}", "")
                  .replace("{pct}", formatPercent(summary.recognizedExpenses > 0 ? (expenseBreakdown[0].amount / summary.recognizedExpenses) * 100 : 0))}
              </p>
              {summary.foodCostPct > 35 && (
                <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                  {t("finance.pl.foodCostWarn").replace("{pct}", formatPercent(summary.foodCostPct))}
                </p>
              )}
              {summary.laborCostPct > 30 && (
                <p className="text-xs text-orange-700 dark:text-orange-400 mt-1">
                  {t("finance.pl.laborCostWarn").replace("{pct}", formatPercent(summary.laborCostPct))}
                </p>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── vs Budget Tab ── */}
      {plTab === "comparison" && (
        <div className="space-y-4">
          {budgetViewRows.length === 0 ? (
            <Card className="p-10 text-center">
              <BarChart2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">{t("finance.noBudget")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("finance.noBudgetHint")}</p>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("finance.kpi.totalBudget")}</p>
                  <p className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">{formatCurrency(totalBudget)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("finance.kpi.totalActual")}</p>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(totalActual)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{t("finance.kpi.totalVariance")}</p>
                  <p className={`text-xl font-bold mt-1 ${totalVariance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {formatCurrency(totalVariance)}
                  </p>
                </Card>
              </div>

              <Card className="overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/20">
                  <h3 className="font-semibold text-sm">{t("finance.budget.title")} — {period}</h3>
                </div>
                <div className="p-4 space-y-4">
                  {budgetViewRows.map((r: any) => {
                    const over = r.pct_used > 100;
                    return (
                      <div key={r.category}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-foreground">{labelize(r.category)}</span>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-muted-foreground">
                              {formatCurrency(r.actual_amount)} / {formatCurrency(r.budget_amount)}
                            </span>
                            <span className={`font-bold ${over ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                              {over ? "▲" : "▼"} {formatPercent(Math.abs(r.pct_used - 100))} {over ? t("finance.budget.over") : t("finance.budget.under")}
                            </span>
                          </div>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${over ? "bg-red-500" : r.pct_used > 80 ? "bg-amber-400" : "bg-green-500"}`}
                            style={{ width: `${Math.min(100, r.pct_used)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Budget Tab ───────────────────────────────────────────────────────────────

function BudgetTab({ budgetViewRows, loading, onSetBudget }: {
  budgetViewRows: any[]; loading: boolean; onSetBudget: () => void;
}) {
  const { t } = useLanguage();
  const totalBudget   = budgetViewRows.reduce((s, r) => s + r.budget_amount, 0);
  const totalActual   = budgetViewRows.reduce((s, r) => s + r.actual_amount, 0);
  const totalVariance = totalBudget - totalActual;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">{t("finance.budget.title")}</h2>
        <Button size="sm" variant="outline" onClick={onSetBudget} className="gap-2">
          <Plus className="w-4 h-4" /> {t("finance.setBudget")}
        </Button>
      </div>

      {totalBudget > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <KpiCard label={t("finance.kpi.totalBudget")}   value={formatCurrency(totalBudget)}   color="text-blue-600 dark:text-blue-400"  icon={<BarChart2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />} />
          <KpiCard label={t("finance.kpi.totalActual")}   value={formatCurrency(totalActual)}   color="text-amber-600 dark:text-amber-400" icon={<Receipt className="w-5 h-5 text-amber-600 dark:text-amber-400" />} />
          <KpiCard label={t("finance.kpi.totalVariance")} value={formatCurrency(totalVariance)} color={totalVariance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"} icon={totalVariance >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />} />
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-10 animate-pulse rounded bg-secondary/50" />)}</div>
        ) : !budgetViewRows.length ? (
          <div className="p-12 text-center">
            <BarChart2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{t("finance.noBudget")}</p>
            <Button size="sm" variant="outline" onClick={onSetBudget} className="mt-3">{t("finance.setFirstBudget")}</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/70 border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("finance.budget.category")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("finance.budget.budget")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("finance.budget.actual")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("finance.budget.variance")}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("finance.budget.usedPct")}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("finance.budget.progress")}</th>
                </tr>
              </thead>
              <tbody>
                {budgetViewRows.map(row => {
                  const pct  = Math.min(100, row.pct_used);
                  const over = row.pct_used > 100;
                  return (
                    <tr key={row.category} className="border-b border-border hover:bg-secondary/30">
                      <td className="px-4 py-3 font-medium text-foreground">{labelize(row.category)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(row.budget_amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(row.actual_amount)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-sm font-bold ${row.variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatCurrency(row.variance)}</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold ${over ? "text-red-600 dark:text-red-400" : row.pct_used > 80 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>{formatPercent(row.pct_used)}</td>
                      <td className="px-4 py-3 min-w-32">
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${over ? "bg-red-500" : row.pct_used > 80 ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
                        </div>
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Finance() {
  const { t } = useLanguage();
  const currentUserId = Number(localStorage.getItem("user_id") ?? 1);
  const currentUserName = localStorage.getItem("user_name") ?? "";
  const currentUserRole = localStorage.getItem("role") ?? "";

  const [branchId, setBranchId]   = useState<number>(0);
  const [period, setPeriod]       = useState(currentPeriod());
  const [modal, setModal]         = useState<ModalType>(null);
  const [saving, setSaving]       = useState(false);
  const [backupRefreshing, setBackupRefreshing] = useState(false);
  const [backupDateFrom, setBackupDateFrom] = useState("");
  const [backupDateTo, setBackupDateTo] = useState("");
  const [formError, setFormError] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");

  const periodEnd = useMemo(() => getPeriodEnd(period), [period]);

  // ── Form state ──
  const [expenseForm, setExpenseForm]           = useState({ entry_date: today(), category: "rent", amount: 0, expense_group: "operating", subtype: "admin", notes: "" });
  const [payrollForm, setPayrollForm] = useState({
  entry_date: today(),
  employee_group: "Kitchen Staff",
  headcount: 1,
  base_salary: 0,
  burden_pct: 26,
  employer_burden: 0,
  notes: ""
});
  const [accrualForm, setAccrualForm]           = useState({ entry_date: today(), category: "utilities", amount: 0, notes: "" });
  const [depreciationForm, setDepreciationForm] = useState({ entry_date: today(), asset_name: "", amount: 0, notes: "" });
  const [prepaymentForm, setPrepaymentForm]     = useState({ entry_date: today(), category: "marketing", amount: 0, months: 1, notes: "" });
  const [budgetForm, setBudgetForm]             = useState({ period: currentPeriod(), category: "food_cost", amount: 0 });
  const [closeForm, setCloseForm]               = useState({ closed_to: getPeriodEnd(currentPeriod()), notes: "" });
  const [periodStatusForm, setPeriodStatusForm] = useState<{ status: PeriodStatusValue; notes: string }>({ status: "closed", notes: "" });

  // ── API calls ──
  const { data: branches }                                                                          = useApi<Branch[]>(getBranches);
  const { data: expenses,            loading: expensesLoading,      refetch: refetchExpenses }      = useApi<ExpenseRow[]>(() => branchId ? getExpenses(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: payrollEntries,      loading: payrollLoading,       refetch: refetchPayroll }       = useApi<PayrollEntryRow[]>(() => branchId ? getPayrollEntries(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: accrualEntries,      loading: accrualLoading,       refetch: refetchAccruals }      = useApi<AccrualEntryRow[]>(() => branchId ? getAccrualEntries(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: depreciationEntries, loading: depreciationLoading,  refetch: refetchDepreciation }  = useApi<DepreciationEntryRow[]>(() => branchId ? getDepreciationEntries(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: prepaymentEntries,   loading: prepaymentLoading,    refetch: refetchPrepayments }   = useApi<PrepaymentEntryRow[]>(() => branchId ? getPrepaymentEntries(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: budgetRows,          loading: budgetLoading,        refetch: refetchBudget }        = useApi<BudgetVsActualRow[]>(() => branchId ? getBudgetVsActual(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: approvals,           loading: approvalsLoading,     refetch: refetchApprovals }     = useApi<ApprovalRow[]>(getPendingApprovals);
  const { data: kpi,                 loading: kpiLoading,           refetch: refetchKpi }           = useApi<FinanceKpiRow>(() => branchId ? getFinanceKpi(branchId, period) : Promise.resolve(emptyKpi(branchId, period)), { deps: [branchId, period] });
  const { data: periodStatus,        loading: periodStatusLoading,  refetch: refetchPeriodStatus }  = useApi<{ is_closed: boolean; is_locked?: boolean; status?: PeriodStatusValue }>(() => branchId ? isPeriodClosed(branchId, periodEnd) : Promise.resolve({ is_closed: false }), { deps: [branchId, periodEnd] });
  const { data: sales,               loading: salesLoading,         refetch: refetchSales }         = useApi<SaleRow[]>(() => branchId ? getSalesByBranch(branchId, period) : Promise.resolve([]), { deps: [branchId, period] });
  const { data: periodBackups,       refetch: refetchPeriodBackups }                                = useApi<PeriodBackupRow[]>(() => getPeriodBackups({ branchId: branchId || undefined, months: 4, dateFrom: backupDateFrom || undefined, dateTo: backupDateTo || undefined }), { deps: [branchId, backupDateFrom, backupDateTo] });
  const { data: companyPeriodStatus, loading: companyPeriodStatusLoading, refetch: refetchCompanyPeriodStatus } = useApi<PeriodStatusRow>(() => getPeriodStatus(period), { deps: [period] });

  // ── Safe values ──
  const safeBranches            = branches            ?? [];
  const safeExpenses            = expenses            ?? [];
  const safePayrollEntries      = payrollEntries      ?? [];
  const safeAccrualEntries      = accrualEntries      ?? [];
  const safeDepreciationEntries = depreciationEntries ?? [];
  const safePrepaymentEntries   = prepaymentEntries   ?? [];
  const safeBudgetRows          = budgetRows          ?? [];
  const safeApprovals           = approvals           ?? [];
  const safeSales               = sales               ?? [];
  const safeKpi                 = kpi                 ?? emptyKpi(branchId, period);
  const safePeriodBackups       = periodBackups       ?? [];
  const selectedBranch          = safeBranches.find(b => b.id === branchId) ?? null;
  const selectedPeriodState     = companyPeriodStatus?.status ?? periodStatus?.status ?? "open";
  const selectedPeriodClosed    = selectedPeriodState === "closed" || selectedPeriodState === "locked" || Boolean(periodStatus?.is_closed);
  const selectedPeriodLocked    = selectedPeriodState === "locked" || Boolean(periodStatus?.is_locked);

  const isRefreshing = expensesLoading || payrollLoading || accrualLoading ||
    depreciationLoading || prepaymentLoading || budgetLoading ||
    approvalsLoading || kpiLoading || periodStatusLoading || salesLoading || companyPeriodStatusLoading;

  // ── Computed ──
  const payrollTotals = useMemo(() => {
  const perPerson  = Number(payrollForm.base_salary) || 0;
  const count      = Number(payrollForm.headcount)   || 1;
  const pct        = Number(payrollForm.burden_pct)  || 0;
  const grossSalary   = perPerson * count;
  const burdenAmount  = grossSalary * (pct / 100);
  const totalCost     = grossSalary + burdenAmount;
  return { grossSalary, burdenAmount, totalCost };
  }, [payrollForm.base_salary, payrollForm.headcount, payrollForm.burden_pct]);

  const adjustedActualsByCategory = useMemo(() => {
    const actuals = new Map<string, number>();
    const add = (cat: string, amt: number) => actuals.set(cat, (actuals.get(cat) ?? 0) + Number(amt || 0));
    safeExpenses.forEach(r => add(r.category || "other", Number(r.amount)));
    safePayrollEntries.forEach(r => add("labor", Number(r.total_amount)));
    safeAccrualEntries.forEach(r => add(r.category || "other", Number(r.amount)));
    safePrepaymentEntries.forEach(r => add(r.category || "other", Number(r.monthly_expense)));
    return actuals;
  }, [safeAccrualEntries, safeExpenses, safePayrollEntries, safePrepaymentEntries]);

  const budgetViewRows = useMemo(() => {
    const rows = new Map<string, BudgetVsActualRow>();
    safeBudgetRows.forEach(row => {
      rows.set(row.category, { category: row.category, budget_amount: Number(row.budget_amount || 0), actual_amount: 0, variance: 0, pct_used: 0 });
    });
    adjustedActualsByCategory.forEach((amt, cat) => {
      if (!budgetCategories.includes(cat as any)) return;
      const ex = rows.get(cat) ?? { category: cat, budget_amount: 0, actual_amount: 0, variance: 0, pct_used: 0 };
      rows.set(cat, { ...ex, actual_amount: amt, variance: ex.budget_amount - amt, pct_used: ex.budget_amount > 0 ? (amt / ex.budget_amount) * 100 : 0 });
    });
    return Array.from(rows.values()).filter(r => r.budget_amount > 0 || r.actual_amount > 0).sort((a, b) => a.category.localeCompare(b.category));
  }, [adjustedActualsByCategory, safeBudgetRows]);

  const summary = useMemo(() => {
    const revenueFromSales = safeSales.reduce((s, r) => s + Number(r.net_amount || 0), 0);
    const revenue          = revenueFromSales > 0 ? revenueFromSales : Number(safeKpi.revenue || 0);
    const foodCost         = Number(safeKpi.food_cost || 0);
    const wasteCost        = Number(safeKpi.waste_cost || 0);
    const laborCost        = Number(adjustedActualsByCategory.get("labor") ?? 0);

    // Single source of truth — matches expenseBreakdown exactly
    const depTotal = safeDepreciationEntries.reduce((s, r) => s + Number(r.amount || 0), 0);
    const recognizedExpenses =
      Array.from(adjustedActualsByCategory.values()).reduce((s, v) => s + v, 0) + depTotal;

    const grossProfit     = revenue - foodCost - wasteCost;
    const operatingResult = grossProfit - recognizedExpenses;
    return {
      revenue, foodCost, wasteCost, recognizedExpenses, laborCost, grossProfit, operatingResult,
      foodCostPct:  revenue > 0 ? (foodCost  / revenue) * 100 : Number(safeKpi.food_cost_pct  || 0),
      laborCostPct: revenue > 0 ? (laborCost / revenue) * 100 : Number(safeKpi.labor_cost_pct || 0),
  };
}, [adjustedActualsByCategory, safeDepreciationEntries, safeKpi, safeSales]);
const expenseBreakdown = useMemo(() => {
  const map = new Map<string, number>();
  adjustedActualsByCategory.forEach((amt, cat) => map.set(cat, amt));
  
  // Merge depreciation into the map so it appears inline
  const depTotal = safeDepreciationEntries.reduce((s, r) => s + Number(r.amount || 0), 0);
  if (depTotal > 0) map.set("depreciation", (map.get("depreciation") ?? 0) + depTotal);

  // Merge accruals and prepayments explicitly (they're already in adjustedActualsByCategory
  // but make sure nothing is double-counted)
  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}, [adjustedActualsByCategory, safeDepreciationEntries]);

  const recentActivity = useMemo<FinanceActivityRow[]>(() => {
    const activity: FinanceActivityRow[] = [];
    safeExpenses.forEach(r => activity.push({ id: `expense-${r.id}`, entry_date: r.entry_date, type: t("finance.expense"), description: `${expenseLabel(r.category || "other")} / ${labelize(r.subtype || "general")}`, amount: Number(r.amount || 0), notes: r.notes ?? "", branch_name: r.branch_name ?? selectedBranch?.name ?? "" }));
    safePayrollEntries.forEach(r => activity.push({ id: `payroll-${r.id}`, entry_date: r.entry_date, type: t("finance.payroll"), description: r.employee_group, amount: Number(r.total_amount || 0), notes: r.notes ?? "", branch_name: r.branch_name ?? selectedBranch?.name ?? "" }));
    safeAccrualEntries.forEach(r => activity.push({ id: `accrual-${r.id}`, entry_date: r.entry_date, type: t("finance.accrual"), description: labelize(r.category || "other"), amount: Number(r.amount || 0), notes: r.notes ?? "", branch_name: r.branch_name ?? selectedBranch?.name ?? "" }));
    safeDepreciationEntries.forEach(r => activity.push({ id: `dep-${r.id}`, entry_date: r.entry_date, type: t("finance.depreciation"), description: r.asset_name, amount: Number(r.amount || 0), notes: r.notes ?? "", branch_name: r.branch_name ?? selectedBranch?.name ?? "" }));
    safePrepaymentEntries.forEach(r => activity.push({ id: `pre-${r.id}`, entry_date: r.entry_date, type: t("finance.prepayment"), description: `${labelize(r.category || "other")} (${r.months}mo)`, amount: Number(r.amount || 0), notes: r.notes ?? "", branch_name: r.branch_name ?? selectedBranch?.name ?? "" }));
    return activity.sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id.localeCompare(a.id)).slice(0, 50);
  },[safeAccrualEntries, safeDepreciationEntries, safeExpenses, safePayrollEntries, safePrepaymentEntries, selectedBranch?.name, t]);

  const filteredApprovals = useMemo(() =>
    safeApprovals.filter(a => !branchId || a.branch_id === branchId),
    [branchId, safeApprovals]
  );

  // ── Actions ──
  function refetchAll() {
    refetchExpenses(); refetchPayroll(); refetchAccruals(); refetchDepreciation();
    refetchPrepayments(); refetchBudget(); refetchApprovals(); refetchKpi();
    refetchPeriodStatus(); refetchCompanyPeriodStatus(); refetchSales(); refetchPeriodBackups();
  }

  function openModal(type: ModalType) {
    setFormError("");
    if (type === "expense")      setExpenseForm({ entry_date: defaultDateForPeriod(period), category: "rent", amount: 0, expense_group: "operating", subtype: "admin", notes: "" });
    if (type === "payroll") setPayrollForm({
      entry_date: defaultDateForPeriod(period),
      employee_group: "Kitchen Staff",
      headcount: 1,
      base_salary: 0,
      burden_pct: 26,
      employer_burden: 0,
      notes: ""
    });
    if (type === "accrual")      setAccrualForm({ entry_date: defaultDateForPeriod(period), category: "utilities", amount: 0, notes: "" });
    if (type === "depreciation") setDepreciationForm({ entry_date: defaultDateForPeriod(period), asset_name: "", amount: 0, notes: "" });
    if (type === "prepayment")   setPrepaymentForm({ entry_date: defaultDateForPeriod(period), category: "marketing", amount: 0, months: 1, notes: "" });
    if (type === "budget")       setBudgetForm({ period, category: "food_cost", amount: 0 });
    if (type === "close")        setCloseForm({ closed_to: periodEnd, notes: "" });
    if (type === "periodStatus") setPeriodStatusForm({ status: selectedPeriodState === "open" ? "closed" : selectedPeriodState, notes: "" });
    setModal(type);
  }

  async function handleSaveExpense() {
    if (!branchId) return setFormError(t("finance.selectBranchFirst"));
    if (expenseForm.amount <= 0) return setFormError(t("finance.amountPositive"));
    setSaving(true); setFormError("");
    try {
      await addExpense({ branch_id: branchId, entry_date: expenseForm.entry_date, category: expenseForm.category, amount: expenseForm.amount, expense_group: expenseForm.expense_group, subtype: expenseForm.subtype, notes: expenseForm.notes, user_id: currentUserId });
      setModal(null); refetchAll();
    } catch { setFormError(t("finance.saveFailed")); }
    setSaving(false);
  }

  async function handleSavePayroll() {
  if (!branchId) return setFormError(t("finance.selectBranchFirst"));
  if (payrollForm.base_salary <= 0) return setFormError(t("finance.salaryPositive"));
  if (payrollForm.headcount < 1)    return setFormError("Headcount must be at least 1");
  setSaving(true); setFormError("");
  try {
    await addPayroll({
      branch_id:       branchId,
      entry_date:      payrollForm.entry_date,
      employee_group:  `${payrollForm.employee_group} (×${payrollForm.headcount})`,
      base_salary:     payrollTotals.grossSalary,      // headcount × per-person salary
      employer_burden: payrollTotals.burdenAmount,
      notes:           payrollForm.notes,
    });
    setModal(null); refetchAll();
  } catch { setFormError(t("finance.saveFailed")); }
  setSaving(false);
  }

  async function handleSaveAccrual() {
    if (!branchId) return setFormError(t("finance.selectBranchFirst"));
    if (accrualForm.amount <= 0) return setFormError(t("finance.amountPositive"));
    setSaving(true); setFormError("");
    try {
      await addAccrual({ branch_id: branchId, entry_date: accrualForm.entry_date, category: accrualForm.category, amount: accrualForm.amount, notes: accrualForm.notes });
      setModal(null); refetchAll();
    } catch { setFormError(t("finance.saveFailed")); }
    setSaving(false);
  }

  async function handleSaveDepreciation() {
    if (!branchId) return setFormError(t("finance.selectBranchFirst"));
    if (!depreciationForm.asset_name.trim()) return setFormError(t("finance.assetRequired"));
    if (depreciationForm.amount <= 0) return setFormError(t("finance.amountPositive"));
    setSaving(true); setFormError("");
    try {
      await addDepreciation({ branch_id: branchId, entry_date: depreciationForm.entry_date, asset_name: depreciationForm.asset_name, amount: depreciationForm.amount, notes: depreciationForm.notes });
      setModal(null); refetchAll();
    } catch { setFormError(t("finance.saveFailed")); }
    setSaving(false);
  }

  async function handleSavePrepayment() {
    if (!branchId) return setFormError(t("finance.selectBranchFirst"));
    if (prepaymentForm.amount <= 0) return setFormError(t("finance.amountPositive"));
    if (prepaymentForm.months <= 0) return setFormError(t("finance.monthsPositive"));
    setSaving(true); setFormError("");
    try {
      await addPrepayment({ branch_id: branchId, entry_date: prepaymentForm.entry_date, category: prepaymentForm.category, amount: prepaymentForm.amount, months: prepaymentForm.months, notes: prepaymentForm.notes });
      setModal(null); refetchAll();
    } catch { setFormError(t("finance.saveFailed")); }
    setSaving(false);
  }

  async function handleSaveBudget() {
    if (!branchId) return setFormError(t("finance.selectBranchFirst"));
    if (budgetForm.amount <= 0) return setFormError(t("finance.budgetPositive"));
    setSaving(true); setFormError("");
    try {
      await setBudget({ branch_id: branchId, period: budgetForm.period, category: budgetForm.category, amount: budgetForm.amount });
      setModal(null); refetchBudget();
    } catch { setFormError(t("finance.saveFailed")); }
    setSaving(false);
  }

  async function handleClosePeriod() {
    if (!branchId) return setFormError(t("finance.selectBranchFirst"));
    const confirmMsg = t("finance.closePeriodConfirm")
      .replace("{branch}", selectedBranch?.name ?? "")
      .replace("{date}", closeForm.closed_to);
    if (!window.confirm(confirmMsg)) return;
    setSaving(true); setFormError("");
    try {
      await closePeriod({ branch_id: branchId, closed_to: closeForm.closed_to, notes: closeForm.notes, user_id: currentUserId });
      setModal(null); refetchAll();
    } catch { setFormError(t("finance.closeFailed")); }
    setSaving(false);
  }

  async function handleRefreshPeriodBackups() {
    setBackupRefreshing(true);
    try {
      await generatePeriodBackups({
        months: 4,
        locked_by: currentUserName,
        notes: "Generated from Finance snapshot",
      });
      refetchPeriodBackups();
    } finally {
      setBackupRefreshing(false);
    }
  }

  async function handleSavePeriodStatus() {
    setSaving(true); setFormError("");
    try {
      await setPeriodStatus({
        period,
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

  async function handleApprove(id: number) {
    try { await approveRequest(id, currentUserId); refetchApprovals(); } catch {}
  }

  async function handleReject(id: number) {
    try { await rejectRequest(id, currentUserId); refetchApprovals(); } catch {}
  }

  const tabs: { key: ActiveTab; label: string; icon: ReactNode }[] = [
    { key: "overview",  label: t("finance.tab.overview"),  icon: <BarChart2 className="w-4 h-4" /> },
    { key: "pl",        label: t("finance.tab.pl"),        icon: <FileText className="w-4 h-4" /> },
    { key: "budget",    label: t("finance.tab.budget"),    icon: <Wallet className="w-4 h-4" /> },
    { key: "activity",  label: t("finance.tab.activity"),  icon: <Receipt className="w-4 h-4" /> },
    { key: "approvals", label: t("finance.tab.approvals"), icon: <CheckCircle2 className="w-4 h-4" /> },
  ];

  const modalProps = { saving, tCancel: t("common.cancel"), tSave: t("common.save") };

  return (
    <div className="space-y-6">

      {/* ── Modals ── */}
      {modal === "expense" && (
        <Modal title={t("finance.modal.recordExpense")} {...modalProps} onClose={() => setModal(null)} onSave={handleSaveExpense}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.date")}><input type="date" className={inputClass} value={expenseForm.entry_date} onChange={e => setExpenseForm({ ...expenseForm, entry_date: e.target.value })} /></Field>
            <Field label={t("finance.modal.amount")}><input type="number" min={0.01} step={0.01} className={inputClass} value={expenseForm.amount || ""} onChange={e => setExpenseForm({ ...expenseForm, amount: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.category")}>
              <select className={inputClass} value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })}>
                {budgetCategories.map(c => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            </Field>
            <Field label={t("finance.modal.group")}>
              <select className={inputClass} value={expenseForm.expense_group} onChange={e => setExpenseForm({ ...expenseForm, expense_group: e.target.value })}>
                {expenseGroups.map(g => <option key={g} value={g}>{labelize(g)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("finance.modal.subtype")}><input type="text" className={inputClass} value={expenseForm.subtype} onChange={e => setExpenseForm({ ...expenseForm, subtype: e.target.value })} /></Field>
          <Field label={t("finance.modal.notes")}><textarea className={inputClass} rows={2} value={expenseForm.notes} onChange={e => setExpenseForm({ ...expenseForm, notes: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "payroll" && (
        <Modal
          title={t("finance.modal.recordPayroll")}
          {...modalProps}
          onClose={() => setModal(null)}
          onSave={handleSavePayroll}
        >
          {formError && (
            <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3 w-3" />{formError}
            </p>
          )}

          {/* Row 1: Date + Group */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.date")}>
              <input
                type="date"
                className={inputClass}
                value={payrollForm.entry_date}
                onChange={e => setPayrollForm({ ...payrollForm, entry_date: e.target.value })}
              />
            </Field>
            <Field label={t("finance.modal.employeeGroup")}>
              <select
                className={inputClass}
                value={payrollForm.employee_group}
                onChange={e => setPayrollForm({ ...payrollForm, employee_group: e.target.value })}
              >
                {["Kitchen Staff","Service Staff","Management","Security","Cleaning","Drivers","Administration"]
                  .map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
          </div>

          {/* Row 2: Headcount + Base Salary per person */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number of Employees">
              <input
                type="number"
                min={1}
                step={1}
                className={inputClass}
                value={payrollForm.headcount || ""}
                onChange={e => setPayrollForm({ ...payrollForm, headcount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Base Salary (per person)">
              <input
                type="number"
                min={0.01}
                step={0.01}
                className={inputClass}
                value={payrollForm.base_salary || ""}
                onChange={e => setPayrollForm({ ...payrollForm, base_salary: Number(e.target.value) })}
              />
            </Field>
          </div>

          {/* Row 3: Burden % + Burden Amount (read-only) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Employer Burden %">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className={inputClass}
                value={payrollForm.burden_pct || ""}
                onChange={e => setPayrollForm({ ...payrollForm, burden_pct: Number(e.target.value) })}
              />
            </Field>
            <Field label="Burden Amount (auto)">
              <input
                type="text"
                readOnly
                className={`${inputClass} bg-secondary/50 text-muted-foreground cursor-not-allowed`}
                value={formatCurrency(payrollTotals.burdenAmount)}
              />
            </Field>
          </div>

          {/* Total Cost to Company — prominent summary row */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Total Cost to Company
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {payrollForm.headcount} × {formatCurrency(payrollForm.base_salary)} + {payrollForm.burden_pct}% burden
              </p>
            </div>
            <p className="text-xl font-bold text-primary">{formatCurrency(payrollTotals.totalCost)}</p>
          </div>

          <Field label={t("finance.modal.notes")}>
            <textarea
              className={inputClass}
              rows={2}
              value={payrollForm.notes}
              onChange={e => setPayrollForm({ ...payrollForm, notes: e.target.value })}
            />
          </Field>
        </Modal>
      )}

      {modal === "accrual" && (
        <Modal title={t("finance.modal.recordAccrual")} {...modalProps} onClose={() => setModal(null)} onSave={handleSaveAccrual}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.date")}><input type="date" className={inputClass} value={accrualForm.entry_date} onChange={e => setAccrualForm({ ...accrualForm, entry_date: e.target.value })} /></Field>
            <Field label={t("finance.modal.category")}>
              <select className={inputClass} value={accrualForm.category} onChange={e => setAccrualForm({ ...accrualForm, category: e.target.value })}>
                {budgetCategories.map(c => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("finance.modal.amount")}><input type="number" min={0.01} step={0.01} className={inputClass} value={accrualForm.amount || ""} onChange={e => setAccrualForm({ ...accrualForm, amount: Number(e.target.value) })} /></Field>
          <Field label={t("finance.modal.notes")}><textarea className={inputClass} rows={2} value={accrualForm.notes} onChange={e => setAccrualForm({ ...accrualForm, notes: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "depreciation" && (
        <Modal title={t("finance.modal.recordDepreciation")} {...modalProps} onClose={() => setModal(null)} onSave={handleSaveDepreciation}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.date")}><input type="date" className={inputClass} value={depreciationForm.entry_date} onChange={e => setDepreciationForm({ ...depreciationForm, entry_date: e.target.value })} /></Field>
            <Field label={t("finance.modal.amount")}><input type="number" min={0.01} step={0.01} className={inputClass} value={depreciationForm.amount || ""} onChange={e => setDepreciationForm({ ...depreciationForm, amount: Number(e.target.value) })} /></Field>
          </div>
          <Field label={t("finance.modal.assetName")}><input type="text" className={inputClass} value={depreciationForm.asset_name} onChange={e => setDepreciationForm({ ...depreciationForm, asset_name: e.target.value })} /></Field>
          <Field label={t("finance.modal.notes")}><textarea className={inputClass} rows={2} value={depreciationForm.notes} onChange={e => setDepreciationForm({ ...depreciationForm, notes: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "prepayment" && (
        <Modal title={t("finance.modal.recordPrepayment")} {...modalProps} onClose={() => setModal(null)} onSave={handleSavePrepayment}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.date")}><input type="date" className={inputClass} value={prepaymentForm.entry_date} onChange={e => setPrepaymentForm({ ...prepaymentForm, entry_date: e.target.value })} /></Field>
            <Field label={t("finance.modal.category")}>
              <select className={inputClass} value={prepaymentForm.category} onChange={e => setPrepaymentForm({ ...prepaymentForm, category: e.target.value })}>
                {budgetCategories.map(c => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.amount")}><input type="number" min={0.01} step={0.01} className={inputClass} value={prepaymentForm.amount || ""} onChange={e => setPrepaymentForm({ ...prepaymentForm, amount: Number(e.target.value) })} /></Field>
            <Field label={t("finance.modal.months")}><input type="number" min={1} step={1} className={inputClass} value={prepaymentForm.months || ""} onChange={e => setPrepaymentForm({ ...prepaymentForm, months: Number(e.target.value) })} /></Field>
          </div>
          <Field label={t("finance.modal.notes")}><textarea className={inputClass} rows={2} value={prepaymentForm.notes} onChange={e => setPrepaymentForm({ ...prepaymentForm, notes: e.target.value })} /></Field>
        </Modal>
      )}

      {modal === "budget" && (
        <Modal title={t("finance.modal.setBudget")} {...modalProps} onClose={() => setModal(null)} onSave={handleSaveBudget}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.modal.period")}><input type="month" className={inputClass} value={budgetForm.period} onChange={e => setBudgetForm({ ...budgetForm, period: e.target.value })} /></Field>
            <Field label={t("finance.modal.category")}>
              <select className={inputClass} value={budgetForm.category} onChange={e => setBudgetForm({ ...budgetForm, category: e.target.value })}>
                {budgetCategories.map(c => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("finance.modal.amount")}><input type="number" min={0.01} step={0.01} className={inputClass} value={budgetForm.amount || ""} onChange={e => setBudgetForm({ ...budgetForm, amount: Number(e.target.value) })} /></Field>
        </Modal>
      )}

      {modal === "close" && (
        <Modal title={t("finance.modal.closePeriod")} {...modalProps} onClose={() => setModal(null)} onSave={handleClosePeriod}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <Field label={t("finance.closedThrough")}><input type="date" className={inputClass} value={closeForm.closed_to} onChange={e => setCloseForm({ ...closeForm, closed_to: e.target.value })} /></Field>
          <Field label={t("finance.modal.notes")}><textarea className={inputClass} rows={2} value={closeForm.notes} onChange={e => setCloseForm({ ...closeForm, notes: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">{t("finance.closePeriodNote")}</p>
        </Modal>
      )}

      {/* ── Page Header ── */}
      {modal === "periodStatus" && (
        <Modal title="Period status" {...modalProps} onClose={() => setModal(null)} onSave={handleSavePeriodStatus}>
          {formError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><AlertCircle className="h-3 w-3" />{formError}</p>}
          <Field label="Period"><input className={inputClass} value={period} disabled /></Field>
          <Field label="Status">
            <select className={inputClass} value={periodStatusForm.status} onChange={e => setPeriodStatusForm({ ...periodStatusForm, status: e.target.value as PeriodStatusValue })}>
              <option value="open">Open - normal work</option>
              <option value="closed">Closed - no edits</option>
              <option value="locked">Locked - fully frozen</option>
            </select>
          </Field>
          <Field label={t("finance.modal.notes")}><textarea className={inputClass} rows={2} value={periodStatusForm.notes} onChange={e => setPeriodStatusForm({ ...periodStatusForm, notes: e.target.value })} /></Field>
          <p className="text-xs text-muted-foreground">This applies to the selected period for the whole company. Closing or locking also refreshes the latest 4 month backups.</p>
        </Modal>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary">{t("finance.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("finance.subtitle")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select className={`${inputClass} sm:w-52`} value={branchId || ""} onChange={e => setBranchId(Number(e.target.value))}>
            <option value="">{t("finance.selectBranch")}</option>
            {safeBranches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="month" className={`${inputClass} sm:w-40`} value={period} onChange={e => setPeriod(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => openModal("expense")} disabled={!branchId || selectedPeriodClosed}>
              <Plus className="h-4 w-4 mr-1" /> {t("finance.addEntry")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openModal("periodStatus")}
              className={
                selectedPeriodLocked
                  ? "border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  : selectedPeriodClosed
                    ? "border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                    : "border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
              }>
              <Lock className="h-4 w-4 mr-1" /> {selectedPeriodState.toUpperCase()}
            </Button>
            <Button variant="outline" size="sm" onClick={refetchAll} disabled={isRefreshing}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Alerts ── */}
      {!branchId && (
        <Card className="border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20 p-4">
          <p className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4" />{t("finance.selectBranchAlert")}
          </p>
        </Card>
      )}
      {branchId > 0 && selectedPeriodClosed && (
        <Card className={`${selectedPeriodLocked ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20" : "border-green-200 dark:border-green-700/40 bg-green-50 dark:bg-green-900/20"} p-4`}>
          <p className={`flex items-center gap-2 text-sm ${selectedPeriodLocked ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
            <CheckCircle2 className="h-4 w-4" />
            {selectedPeriodLocked
              ? `${period} is locked for the whole company. No edits are allowed.`
              : t("finance.periodClosed").replace("{branch}", selectedBranch?.name ?? "")}
          </p>
        </Card>
      )}

      {/* ── Top KPIs ── */}
      {branchId > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label={t("finance.kpi.revenue")}     value={formatCurrency(summary.revenue)}          color="text-blue-600 dark:text-blue-400"  icon={<TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />} />
          <KpiCard label={t("finance.kpi.grossProfit")} value={formatCurrency(summary.grossProfit)}      color={summary.grossProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"} icon={<DollarSign className="h-5 w-5" />} sub={`${formatPercent(summary.revenue > 0 ? (summary.grossProfit / summary.revenue) * 100 : 0)} ${t("finance.pl.margin")}`} />
          <KpiCard label={t("finance.kpi.totalCosts")}  value={formatCurrency(summary.foodCost + summary.recognizedExpenses)} color="text-amber-600 dark:text-amber-400" icon={<Receipt className="h-5 w-5 text-amber-600 dark:text-amber-400" />} />
          <KpiCard label={t("finance.kpi.netResult")}   value={formatCurrency(Math.abs(summary.operatingResult))} color={summary.operatingResult >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"} icon={summary.operatingResult >= 0 ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />} sub={summary.operatingResult >= 0 ? t("finance.kpi.profitable") : t("finance.kpi.loss")} />
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto pb-px">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
              ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}>
            {tab.icon}{tab.label}
            {tab.key === "approvals" && filteredApprovals.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] flex items-center justify-center font-bold">{filteredApprovals.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">{t("finance.operations")}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { key: "expense"      as ModalType, labelKey: "finance.expense",      descKey: "finance.expenseDesc",      icon: <Receipt className="w-5 h-5 text-blue-600 dark:text-blue-400" />,      bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900"        },
                { key: "payroll"      as ModalType, labelKey: "finance.payroll",      descKey: "finance.payrollDesc",      icon: <Wallet className="w-5 h-5 text-green-600 dark:text-green-400" />,      bg: "bg-green-50 dark:bg-green-950/30 border-green-100 dark:border-green-900"     },
                { key: "accrual"      as ModalType, labelKey: "finance.accrual",      descKey: "finance.accrualDesc",      icon: <Calendar className="w-5 h-5 text-violet-600 dark:text-violet-400" />,   bg: "bg-violet-50 dark:bg-violet-950/30 border-violet-100 dark:border-violet-900" },
                { key: "depreciation" as ModalType, labelKey: "finance.depreciation", descKey: "finance.depreciationDesc", icon: <TrendingDown className="w-5 h-5 text-amber-600 dark:text-amber-400" />, bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900"     },
                { key: "prepayment"   as ModalType, labelKey: "finance.prepayment",   descKey: "finance.prepaymentDesc",   icon: <ChevronRight className="w-5 h-5 text-teal-600 dark:text-teal-400" />,   bg: "bg-teal-50 dark:bg-teal-950/30 border-teal-100 dark:border-teal-900"        },
                { key: "budget"       as ModalType, labelKey: "finance.budget",       descKey: "finance.budgetDesc",       icon: <BarChart2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,   bg: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900" },
              ].map(item => (
                <div key={item.key} className={`flex items-center justify-between p-3 rounded-xl border ${item.bg} hover:border-primary/30 transition-colors`}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white/80 dark:bg-white/10 flex items-center justify-center border border-white/20">{item.icon}</div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{t(item.labelKey)}</p>
                      <p className="text-xs text-muted-foreground">{t(item.descKey)}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="bg-white/80 dark:bg-white/10" onClick={() => openModal(item.key)} disabled={!branchId || selectedPeriodClosed}>{t("common.add")}</Button>
                </div>
              )))}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">{t("finance.snapshot")}</h2>
            <div className="space-y-3">
              {[
                { label: t("finance.kpi.foodCostPct"),      value: formatPercent(summary.foodCostPct),  warn: summary.foodCostPct > 35 },
                { label: t("finance.kpi.laborCostPct"),     value: formatPercent(summary.laborCostPct), warn: summary.laborCostPct > 30 },
                { label: t("finance.kpi.wasteCost"),        value: formatCurrency(summary.wasteCost),   warn: summary.wasteCost > 0 },
                { label: t("finance.kpi.pendingApprovals"), value: String(filteredApprovals.length),    warn: filteredApprovals.length > 0 },
                { label: t("finance.kpi.periodStatus"),     value: selectedPeriodClosed ? t("finance.periodClosedBadge") : t("finance.periodOpen"), warn: false },
              ].map(item => (
                <div key={item.label} className={`rounded-lg p-3 border ${
                  item.warn
                    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700/40"
                    : "bg-secondary/50 border-border"
                }`}>
                  <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                  <p className={`mt-1 text-lg font-bold ${item.warn ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{item.value}</p>
                </div>
              ))}
              <Button className="w-full mt-2" variant="outline" size="sm" onClick={() => setActiveTab("pl")}>
                <FileText className="w-4 h-4 mr-2" /> {t("finance.viewFullPL")}
              </Button>
              <div className="pt-3 border-t border-border">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Period backups</p>
                  {["owner", "admin"].includes(currentUserRole) && (
                    <Button variant="outline" size="sm" onClick={handleRefreshPeriodBackups} disabled={backupRefreshing}>
                      {backupRefreshing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                      Refresh
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <Field label="From">
                    <input type="date" className={inputClass} value={backupDateFrom} onChange={e => setBackupDateFrom(e.target.value)} />
                  </Field>
                  <Field label="To">
                    <input type="date" className={inputClass} value={backupDateTo} onChange={e => setBackupDateTo(e.target.value)} />
                  </Field>
                </div>
                {(backupDateFrom || backupDateTo) && (
                  <Button className="w-full mb-3" variant="outline" size="sm" onClick={() => { setBackupDateFrom(""); setBackupDateTo(""); }}>
                    Clear backup date filter
                  </Button>
                )}
                <div className="space-y-2">
                  {safePeriodBackups.map(row => {
                    const backupSummary = row.backup_data?.summary;
                    return (
                      <div key={row.id} className="rounded-lg border border-border bg-background/60 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">{row.period}</span>
                          <span className="text-xs text-muted-foreground">{row.branch_name}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <span className="text-muted-foreground">Revenue</span>
                          <span className="text-right font-medium">{formatCurrency(backupSummary?.revenue ?? 0)}</span>
                          <span className="text-muted-foreground">Net profit</span>
                          <span className="text-right font-medium">{formatCurrency(backupSummary?.net_profit ?? 0)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {!safePeriodBackups.length && (
                    <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      No period backups saved yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── P&L Tab ── */}
      {activeTab === "pl" && (
        <PLStatement
          summary={summary}
          branchName={selectedBranch?.name ?? t("dashboard.allBranches")}
          period={period}
          expenseBreakdown={expenseBreakdown}
          budgetViewRows={budgetViewRows}
        />
      )}

      {/* ── Budget Tab ── */}
      {activeTab === "budget" && (
        <BudgetTab
          budgetViewRows={budgetViewRows}
          loading={budgetLoading}
          onSetBudget={() => openModal("budget")}
        />
      )}

      {/* ── Activity Tab ── */}
      {activeTab === "activity" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">{t("finance.activity.title")}</h2>
            <Button size="sm" variant="outline" onClick={() => exportActivityToPDF(selectedBranch?.name ?? "Branch", period, recentActivity)} disabled={!recentActivity.length} className="gap-2">
              <Printer className="w-4 h-4" /> {t("finance.activity.exportPdf")}
            </Button>
          </div>
          <Card className="overflow-hidden">
            {expensesLoading || payrollLoading ? (
              <div className="p-6 space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 animate-pulse rounded bg-secondary/50" />)}</div>
            ) : !recentActivity.length ? (
              <div className="p-12 text-center">
                <Receipt className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">{t("finance.activity.noActivity")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/70 border-b border-border">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("finance.activity.date")}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("finance.activity.type")}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("finance.activity.description")}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-foreground">{t("finance.activity.amount")}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground">{t("finance.activity.notes")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivity.map(row => (
                      <tr key={row.id} className="border-b border-border hover:bg-secondary/30">
                        <td className="px-4 py-3 text-sm text-foreground">{row.entry_date}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            row.type === t("finance.expense")      ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"       :
                            row.type === t("finance.payroll")      ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"   :
                            row.type === t("finance.accrual")      ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" :
                            row.type === t("finance.depreciation") ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"   :
                            "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300"
                          }`}>{row.type}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{row.description}</td>
                        <td className="px-4 py-3 text-right font-bold text-primary">{formatCurrency(row.amount)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-secondary/50 border-t-2 border-border">
                      <td colSpan={3} className="px-4 py-3 text-sm font-bold text-foreground">
                        {t("finance.activity.total").replace("{count}", String(recentActivity.length))}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-primary">{formatCurrency(recentActivity.reduce((s, r) => s + r.amount, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── Approvals Tab ── */}
      {activeTab === "approvals" && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-foreground">{t("finance.approvals.title")}</h2>
          {approvalsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-secondary/50" />)}</div>
          ) : !filteredApprovals.length ? (
            <Card className="p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500/30 mx-auto mb-3" />
              <p className="font-medium text-green-600 dark:text-green-400">{t("finance.approvals.empty")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("finance.approvals.reviewed")}</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map(approval => (
                <Card key={approval.id} className="p-4 border-amber-200 dark:border-amber-700/40 bg-amber-50/40 dark:bg-amber-900/10">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-sm text-foreground">{labelize(approval.entity_type)} #{approval.entity_id}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {approval.branch_name ?? t("finance.approvals.unknown")} · {t("finance.approvals.requestedBy")} {approval.requested_by_name ?? t("finance.approvals.unknownBy")}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(approval.requested_at)}</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleApprove(approval.id)}>{t("finance.approvals.approve")}</Button>
                      <Button size="sm" variant="outline" className="border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => handleReject(approval.id)}>{t("finance.approvals.reject")}</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer Status ── */}
      {branchId > 0 && (
        <Card className="p-4 bg-secondary/20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground text-sm">{selectedBranch?.name} · {period}</p>
              <p className="text-xs text-muted-foreground">{t("finance.revenueNote")}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
              selectedPeriodClosed
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
            }`}>
              {selectedPeriodClosed ? <Lock className="h-3 w-3" /> : <Wallet className="h-3 w-3" />}
              {selectedPeriodClosed ? t("finance.periodClosedBadge") : t("finance.periodOpen")}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
