import { useState, useMemo, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, AlertCircle, CheckCircle,
  Download, Filter, Building2, Package, Clock,
  DollarSign, ShoppingCart, Flame, RefreshCw, X,
  CalendarClock,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import {
  getDashboardMetricsFiltered,
  getBranches,
  exportReport,
  type DashboardMetrics as BaseDashboardMetrics,
  type Transaction as BaseTransaction,
} from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency as formatCurrencyValue } from "@/lib/localization";
import { useWorkingPeriod } from "@/contexts/Workingperiodcontext";

// ─── Types ────────────────────────────────────────────────────────────────────

type Transaction = BaseTransaction;

type DashboardMetrics = BaseDashboardMetrics & {
  total_expenses?:      number;
  total_purchases?:     number;
  cogs?:                number;
  gross_profit?:        number;
  recent_transactions:  Transaction[];
  sales_change?:        number | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const NO_PRIOR_PERIOD_SENTINEL = 100;

// ─── Utilities ────────────────────────────────────────────────────────────────

function resolveChange(metrics: DashboardMetrics | null): number | undefined {
  if (!metrics) return undefined;
  if (metrics.sales_change == null) return undefined;
  if (metrics.sales_change === NO_PRIOR_PERIOD_SENTINEL && metrics.total_sales > 0) return undefined;
  return metrics.sales_change;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MetricCardProps {
  title:       string;
  value:       string | number;
  change?:     number;
  subtext?:    string;
  icon:        React.ReactNode;
  loading?:    boolean;
  accent?:     "default" | "warning" | "danger" | "success";
  valueColor?: string;
}

function MetricCard({
  title, value, change, subtext, icon, loading, accent = "default", valueColor,
}: MetricCardProps) {
  const accentBorder = {
    default: "",
    warning: "border-t-2 border-t-amber-500",
    danger:  "border-t-2 border-t-red-500",
    success: "border-t-2 border-t-emerald-500",
  }[accent];

  return (
    <Card className={`p-5 relative overflow-hidden transition-all hover:shadow-sm hover:border-border/60 ${accentBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest truncate">
            {title}
          </p>
          {loading ? (
            <div className="h-7 bg-muted/50 rounded mt-2.5 animate-pulse w-3/4" />
          ) : (
            <>
              <p className={`text-[22px] font-semibold mt-1.5 tabular-nums tracking-tight ${valueColor ?? "text-foreground"}`}>
                {value}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5 min-h-[20px]">
                {change !== undefined ? (
                  <>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                      change >= 0
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    }`}>
                      {change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {change >= 0 ? "+" : ""}{change}%
                    </span>
                    <span className="text-[11px] text-muted-foreground">vs prior period</span>
                  </>
                ) : subtext ? (
                  <span className="text-[11px] text-muted-foreground">{subtext}</span>
                ) : null}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center text-muted-foreground">
          {icon}
        </div>
      </div>
    </Card>
  );
}

interface TxRowProps {
  tx:             Transaction;
  formatCurrency: (n: number) => string;
}

const TX_TYPE_COLORS: Record<string, string> = {
  sale:       "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  purchase:   "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  expense:    "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  adjustment: "bg-muted text-muted-foreground",
};

function TxRow({ tx, formatCurrency }: TxRowProps) {
  const typeColor = TX_TYPE_COLORS[tx.type ?? "adjustment"];
  const isApproved = tx.status === "approved";
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/40 transition-colors">
      <div className="shrink-0">
        {isApproved
          ? <CheckCircle className="w-4 h-4 text-emerald-500" />
          : <Clock className="w-4 h-4 text-amber-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{tx.description}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{tx.date}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {tx.type && (
          <span className={`hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeColor}`}>
            {tx.type}
          </span>
        )}
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatCurrency(tx.amount)}
        </span>
      </div>
    </div>
  );
}

function AlertBanner({ pendingApprovals, t }: { pendingApprovals: number; t: (k: string) => string }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [pendingApprovals]);
  if (dismissed || !pendingApprovals) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
          {t("dashboard.attentionRequired")}
        </p>
        <p className="text-[11px] text-amber-600/70 dark:text-amber-500/70 mt-0.5">
          {t("dashboard.pendingItems").replace("{count}", String(pendingApprovals))}
        </p>
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function InventoryWarning({ value }: { value: number }) {
  if (value >= 0) return null;
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20">
      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">Negative Inventory Value</p>
        <p className="text-[11px] text-red-600/70 dark:text-red-400/70 mt-0.5">
          Inventory value is {value.toLocaleString()} EGP. Check for movement sign errors — quantity_out may exceed quantity_in.
        </p>
      </div>
    </div>
  );
}

// ─── Period banner — shown when working period ≠ current month ────────────────

function PeriodBanner({
  workingPeriodLabel,
  isCurrentPeriod,
  periodStatus,
}: {
  workingPeriodLabel: string;
  isCurrentPeriod:    boolean;
  periodStatus:       "open" | "closed" | "locked" | null;
}) {
  if (isCurrentPeriod && (!periodStatus || periodStatus === "open")) return null;

  // Past period — always show
  if (!isCurrentPeriod) {
    const statusNote =
      periodStatus === "locked" ? "· Hard locked — read only" :
      periodStatus === "closed" ? "· Soft closed" : "";

    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <CalendarClock className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-[12px] text-amber-700 dark:text-amber-400 flex-1">
          Viewing <span className="font-semibold">{workingPeriodLabel}</span> {statusNote}.
          Data below reflects this period only. Change the period in the topbar.
        </p>
      </div>
    );
  }

  // Current period but closed/locked
  if (periodStatus === "closed" || periodStatus === "locked") {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
        <p className="text-[12px] text-red-700 dark:text-red-400 flex-1">
          Current period <span className="font-semibold">{workingPeriodLabel}</span> is{" "}
          <span className="font-semibold">{periodStatus}</span>. New entries are blocked.
        </p>
      </div>
    );
  }

  return null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const { t } = useLanguage();
  const { workingPeriod, workingPeriodLabel, isCurrentPeriod } = useWorkingPeriod();

  // Branch filter — dashboard-specific, period comes from context
  const [branchId,    setBranchId]    = useState("");
  const [exporting,   setExporting]   = useState<"csv" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Derive date range from working period (YYYY-MM → first/last day)
  const { dateFrom, dateTo } = useMemo(() => {
    const [y, m] = workingPeriod.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last  = new Date(y, m, 0);                          // last day of month
    const fmt   = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { dateFrom: fmt(first), dateTo: fmt(last) };
  }, [workingPeriod]);

  const { data: branches } = useApi(getBranches);

  const { data: rawMetrics, loading, error, refetch } = useApi(
    () => getDashboardMetricsFiltered(branchId, dateFrom, dateTo),
    { refetchInterval: 30000, deps: [branchId, dateFrom, dateTo] }
  );
  const metrics = rawMetrics as DashboardMetrics | undefined;

  // Fetch period status so we can show the right warning banner
  const [periodStatus, setPeriodStatus] = useState<"open" | "closed" | "locked" | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/period/status?period=${workingPeriod}`, {
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    })
      .then((r) => r.json())
      .then((r) => { if (!cancelled) setPeriodStatus(r?.data?.status ?? "open"); })
      .catch(() => { if (!cancelled) setPeriodStatus(null); });
    return () => { cancelled = true; };
  }, [workingPeriod]);

  // Clear export error when period or branch changes
  useEffect(() => { setExportError(null); }, [workingPeriod, branchId]);

  const handleExport = useCallback(async (format: "csv" | "pdf") => {
    if (!branchId) { setExportError(t("dashboard.selectBranch")); return; }
    setExportError(null);
    setExporting(format);
    try {
      await exportReport(Number(branchId), dateFrom, dateTo, format);
    } catch {
      setExportError(t("dashboard.exportFailed"));
    } finally {
      setExporting(null);
    }
  }, [branchId, dateFrom, dateTo, t]);

  const formatCurrency = useCallback(
    (value: number) => formatCurrencyValue(value, { maximumFractionDigits: 0 }),
    []
  );

  const quickStats = useMemo(() => {
    const safeCount = Math.max(metrics?.branch_count ?? 1, 1);
    return [
      { label: t("dashboard.activeBranches"),  value: metrics?.branch_count ?? 0,                                 color: "s-green"  },
      { label: t("dashboard.pendingApprovals"), value: metrics?.pending_approvals ?? 0,                           color: "s-amber"  },
      { label: t("dashboard.avgSalesBranch"),   value: formatCurrency((metrics?.total_sales ?? 0) / safeCount),  color: "s-blue"   },
      { label: t("dashboard.totalRevenue"),     value: formatCurrency(metrics?.total_sales ?? 0),                 color: "s-purple" },
    ];
  }, [metrics, formatCurrency, t]);

  const salesChange    = resolveChange(metrics ?? null);
  const inventoryValue = metrics?.inventory_value ?? 0;
  const grossProfit    = metrics?.gross_profit ?? 0;

  const inputClass =
    "px-3 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  const STAT_CLASSES: Record<string, string> = {
    "s-green":  "bg-emerald-500/10 border border-emerald-500/20",
    "s-amber":  "bg-amber-500/10 border border-amber-500/20",
    "s-blue":   "bg-blue-500/10 border border-blue-500/20",
    "s-purple": "bg-violet-500/10 border border-violet-500/20",
  };
  const STAT_LABEL_CLASSES: Record<string, string> = {
    "s-green":  "text-emerald-700 dark:text-emerald-400",
    "s-amber":  "text-amber-700 dark:text-amber-400",
    "s-blue":   "text-blue-700 dark:text-blue-400",
    "s-purple": "text-violet-700 dark:text-violet-400",
  };
  const STAT_VALUE_CLASSES: Record<string, string> = {
    "s-green":  "text-emerald-900 dark:text-emerald-300",
    "s-amber":  "text-amber-900 dark:text-amber-300",
    "s-blue":   "text-blue-900 dark:text-blue-300",
    "s-purple": "text-violet-900 dark:text-violet-300",
  };

  // Export disabled if period is locked (read-only — export still allowed)
  // Export disabled only if no branch selected
  const exportDisabled = !!exporting || !branchId;

  return (
    <div className="space-y-4 pb-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {t("dashboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {workingPeriodLabel}
            {!isCurrentPeriod && (
              <span className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                Past period
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={refetch} disabled={loading} aria-label="Refresh data">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm" variant="outline"
            onClick={() => handleExport("csv")}
            disabled={exportDisabled}
            title={!branchId ? t("dashboard.selectBranch") : undefined}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {exporting === "csv" ? t("dashboard.exporting") : "CSV"}
          </Button>
          <Button
            size="sm"
            onClick={() => handleExport("pdf")}
            disabled={exportDisabled}
            title={!branchId ? t("dashboard.selectBranch") : undefined}
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {exporting === "pdf" ? t("dashboard.exporting") : "PDF"}
          </Button>
        </div>
      </div>

      {/* ── Period banner ── */}
      <PeriodBanner
        workingPeriodLabel={workingPeriodLabel}
        isCurrentPeriod={isCurrentPeriod}
        periodStatus={periodStatus}
      />

      {/* ── Export error ── */}
      {exportError && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {exportError}
          <button onClick={() => setExportError(null)} className="ml-auto" aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Branch filter (only branch — period comes from topbar) ── */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <select
            value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setExportError(null); }}
            className={inputClass}
          >
            <option value="">{t("dashboard.allBranches")}</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">
            Period: <span className="font-medium text-foreground">{workingPeriodLabel}</span>
            {" · "}
            <span className="text-muted-foreground">Change from topbar</span>
          </span>
        </div>
      </Card>

      {/* ── API error ── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Inventory warning ── */}
      {!loading && <InventoryWarning value={inventoryValue} />}

      {/* ── Alert banner ── */}
      {/*
        Only show pending approvals banner when on current period.
        Past period data is read-only so approvals there are historical.
      */}
      {isCurrentPeriod && (
        <AlertBanner pendingApprovals={metrics?.pending_approvals ?? 0} t={t} />
      )}

      {/* ── Primary metrics ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          title={t("dashboard.totalSales")}
          value={formatCurrency(metrics?.total_sales ?? 0)}
          change={salesChange}
          icon={<DollarSign className="w-4 h-4" />}
          loading={loading}
          accent="success"
        />
        <MetricCard
          title={t("dashboard.inventoryValue")}
          value={formatCurrency(inventoryValue)}
          subtext={inventoryValue < 0 ? "Check movement records" : undefined}
          icon={<Package className="w-4 h-4" />}
          loading={loading}
          accent={inventoryValue < 0 ? "danger" : "default"}
          valueColor={inventoryValue < 0 ? "text-red-500 dark:text-red-400" : undefined}
        />
        <MetricCard
          title={t("dashboard.pendingApprovals")}
          value={metrics?.pending_approvals ?? 0}
          icon={<Clock className="w-4 h-4" />}
          loading={loading}
          accent={(metrics?.pending_approvals ?? 0) > 0 ? "warning" : "default"}
        />
        <MetricCard
          title={t("dashboard.branchCount")}
          value={metrics?.branch_count ?? 0}
          icon={<Building2 className="w-4 h-4" />}
          loading={loading}
        />
      </div>

      {/* ── Secondary metrics ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          title={t("dashboard.totalExpenses")}
          value={formatCurrency(metrics?.total_expenses ?? 0)}
          icon={<Flame className="w-4 h-4" />}
          loading={loading}
          accent="danger"
        />
        <MetricCard
          title={t("dashboard.totalPurchases")}
          value={formatCurrency(metrics?.total_purchases ?? 0)}
          icon={<ShoppingCart className="w-4 h-4" />}
          loading={loading}
        />
        <MetricCard
          title={t("dashboard.cogs")}
          value={formatCurrency(metrics?.cogs ?? 0)}
          icon={<Package className="w-4 h-4" />}
          loading={loading}
        />
        <MetricCard
          title={t("dashboard.grossProfit")}
          value={formatCurrency(grossProfit)}
          icon={<TrendingUp className="w-4 h-4" />}
          loading={loading}
          accent={grossProfit > 0 ? "success" : grossProfit < 0 ? "danger" : "default"}
          valueColor={
            grossProfit > 0 ? "text-emerald-600 dark:text-emerald-400" :
            grossProfit < 0 ? "text-red-500 dark:text-red-400" : undefined
          }
        />
      </div>

      {/* ── Main content grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent transactions */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-foreground">{t("dashboard.recentTransactions")}</h2>
            <span className="text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
              {metrics?.recent_transactions?.length ?? 0} entries
            </span>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-11 bg-muted/40 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : metrics?.recent_transactions?.length ? (
            <div className="-mx-1">
              {metrics.recent_transactions.map((tx, i) => (
                <TxRow key={`${tx.date}-${i}`} tx={tx} formatCurrency={formatCurrency} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">{t("dashboard.noRecentTx")}</p>
            </div>
          )}
        </Card>

        {/* Quick stats */}
        <Card className="p-5">
          <h2 className="text-sm font-medium text-foreground mb-4">{t("dashboard.quickStats")}</h2>
          <div className="space-y-2">
            {quickStats.map((stat) => (
              <div
                key={stat.label}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg ${STAT_CLASSES[stat.color]}`}
              >
                <span className={`text-xs font-medium ${STAT_LABEL_CLASSES[stat.color]}`}>
                  {stat.label}
                </span>
                <span className={`text-sm font-semibold tabular-nums ${STAT_VALUE_CLASSES[stat.color]}`}>
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </Card>

      </div>
    </div>
  );
}