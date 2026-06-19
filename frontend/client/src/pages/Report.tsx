import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Loader2, X, Search, Clock } from "lucide-react";
import { generateReport, getBranches, exportReport, apiCall } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  formatCurrency as formatCurrencyValue,
  formatDate,
  getCurrencyLabel,
} from "@/lib/localization";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Branch { id: number; name: string; }

interface MenuEngItem {
  product_name: string;
  total_qty_sold: number;
  total_revenue: number;
  raw_cost: number;
  margin: number;
  food_cost_pct: number;
  classification: "Star" | "Plow Horse" | "Puzzle" | "Dog";
}

interface RecentEntry {
  name: string;
  icon: string;
  modal: ModalType;
  openedAt: Date;
}

type ModalType =
  | "menu" | "stock" | "branch-compare" | "export"
  | "finance" | "dashboard" | "budget" | "losses"
  | "sales-mix" | "price-history" | "audit" | "neg-stock" | "reorder"
  | null;

type CategoryTab = "all" | "financial" | "operational" | "audit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CLASS_CONFIG = {
  Star:        { emoji: "⭐", bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200"  },
  "Plow Horse":{ emoji: "🐴", bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200" },
  Puzzle:      { emoji: "🧩", bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200"   },
  Dog:         { emoji: "🐕", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200"    },
};

function formatCurrency(n: number) {
  return formatCurrencyValue(n, { maximumFractionDigits: 2 });
}
function currentPeriod() { return new Date().toISOString().slice(0, 7); }
function today()         { return new Date().toISOString().split("T")[0]; }

const inputClass =
  "text-sm border border-input rounded-md px-3 py-1.5 bg-background focus:outline-none focus:ring-2 focus:ring-ring";

// ─── All report definitions (single source of truth) ─────────────────────────

const ALL_REPORTS: {
  name: string; desc: string; icon: string;
  modal: ModalType; category: "financial" | "operational" | "audit";
}[] = [
  { name: "Finance Report",          desc: "P&L statement by branch and period",    icon: "📊", modal: "finance",        category: "financial"    },
  { name: "Dashboard Summary",       desc: "Key metrics and KPIs overview",          icon: "📈", modal: "dashboard",      category: "financial"    },
  { name: "Budget vs Actual",        desc: "Budget performance analysis",            icon: "💰", modal: "budget",         category: "financial"    },
  { name: "Top Losses Analysis",     desc: "Waste and damage breakdown",             icon: "⚠️",  modal: "losses",         category: "financial"    },
  { name: "Stock Balances",          desc: "Current inventory across branches",      icon: "📦", modal: "stock",          category: "operational"  },
  { name: "Sales Mix Analysis",      desc: "Product performance and trends",         icon: "📊", modal: "sales-mix",      category: "operational"  },
  { name: "Supplier Price History",  desc: "Track pricing changes over time",        icon: "📉", modal: "price-history",  category: "operational"  },
  { name: "Menu Engineering",        desc: "Recipe profitability classification",    icon: "🍽️",  modal: "menu",           category: "operational"  },
  { name: "Branch Comparison",       desc: "Compare metrics across branches",        icon: "🏢", modal: "branch-compare", category: "audit"        },
  { name: "Audit Trail",             desc: "Complete transaction history",           icon: "📋", modal: "audit",          category: "audit"        },
  { name: "Negative Stock Alerts",   desc: "Items with negative inventory balance",  icon: "⚠️",  modal: "neg-stock",      category: "audit"        },
  { name: "Reorder Alerts",          desc: "Items below their reorder level",        icon: "🔔", modal: "reorder",        category: "audit"        },
  { name: "Export Sales CSV",        desc: "Download sales data as CSV",             icon: "📥", modal: "export",         category: "operational"  },
];

// ─── Generic Modal Shell ──────────────────────────────────────────────────────

function ReportModal({
  title, description, children, onClose, wide,
}: {
  title: string; description: string; children: React.ReactNode;
  onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`bg-background rounded-xl shadow-2xl w-full ${wide ? "max-w-6xl" : "max-w-5xl"} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
        <div className="px-6 py-3 border-t border-border flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty / Loading states ───────────────────────────────────────────────────

function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
      <span className="text-4xl mb-3">{emoji}</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function BranchPeriodControls({
  branches, branchId, setBranchId, period, setPeriod, onGenerate, loading, requireBranch,
}: {
  branches: Branch[]; branchId: string; setBranchId: (v: string) => void;
  period?: string; setPeriod?: (v: string) => void;
  onGenerate: () => void; loading: boolean; requireBranch?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-secondary/30 flex-wrap">
      <select className={inputClass} value={branchId} onChange={e => setBranchId(e.target.value)}>
        <option value="">{requireBranch ? "Select Branch *" : "All Branches"}</option>
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      {period !== undefined && setPeriod && (
        <input type="month" className={inputClass} value={period} onChange={e => setPeriod(e.target.value)} />
      )}
      <Button size="sm" onClick={onGenerate} disabled={loading || (requireBranch ? !branchId : false)}>
        {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        {loading ? "Loading..." : "Generate"}
      </Button>
    </div>
  );
}

// ─── Menu Engineering Modal ───────────────────────────────────────────────────

function MenuEngineeringModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data,     setData]     = useState<MenuEngItem[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params = branchId ? `?branch_id=${branchId}` : "";
      const result = await generateReport(`menu${params}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  const counts = data.reduce((acc, item) => {
    acc[item.classification] = (acc[item.classification] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <ReportModal title="🍽️ Menu Engineering" description="Classify menu items by popularity and profitability" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} onGenerate={handleGenerate} loading={loading} />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="🍽️" text="Select a branch and click Generate" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No sales data found" />}
        {fetched && data.length > 0 && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["Star", "Plow Horse", "Puzzle", "Dog"] as const).map(cls => {
                const cfg = CLASS_CONFIG[cls];
                return (
                  <div key={cls} className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span>{cfg.emoji}</span>
                      <span className={`text-xs font-semibold ${cfg.text}`}>{cls}</span>
                    </div>
                    <p className={`text-2xl font-bold ${cfg.text}`}>{counts[cls] ?? 0}</p>
                    <p className={`text-xs ${cfg.text} opacity-70`}>items</p>
                  </div>
                );
              })}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Item</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Qty Sold</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Revenue</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Cost</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Margin</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Food Cost %</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-foreground">Class</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item, i) => {
                    const cfg = CLASS_CONFIG[item.classification] ?? CLASS_CONFIG["Dog"];
                    return (
                      <tr key={i} className="border-t border-border hover:bg-secondary/40">
                        <td className="px-4 py-3 font-medium text-foreground">{item.product_name}</td>
                        <td className="px-4 py-3 text-right">{Number(item.total_qty_sold).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(Number(item.total_revenue))}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(Number(item.raw_cost))}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(Number(item.margin))}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${item.food_cost_pct <= 30 ? "bg-green-100 text-green-700" : item.food_cost_pct <= 40 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                            {Number(item.food_cost_pct).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                            {cfg.emoji} {item.classification}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><span>⭐</span><span><b>Star</b> — High popularity, high margin</span></div>
              <div className="flex items-center gap-1.5"><span>🐴</span><span><b>Plow Horse</b> — High popularity, low margin</span></div>
              <div className="flex items-center gap-1.5"><span>🧩</span><span><b>Puzzle</b> — Low popularity, high margin</span></div>
              <div className="flex items-center gap-1.5"><span>🐕</span><span><b>Dog</b> — Low popularity, low margin</span></div>
            </div>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Stock Balances Modal ─────────────────────────────────────────────────────

function StockBalancesModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data,     setData]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    if (!branchId) return;
    setLoading(true);
    try {
      const result = await apiCall<any[]>(`/api/stock/${branchId}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  const totalValue = data.reduce((s, r) => s + Math.abs(Number(r.movement_value ?? 0)), 0);

  return (
    <ReportModal title="📦 Stock Balances" description="Current inventory levels by branch" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} onGenerate={handleGenerate} loading={loading} requireBranch />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="📦" text="Select a branch and click Generate" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No stock data for this branch" />}
        {fetched && data.length > 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border bg-blue-50 border-blue-200 text-center">
                <p className="text-xs text-blue-600 font-medium">Total Items</p>
                <p className="text-xl font-bold text-blue-700">{data.length}</p>
              </div>
              <div className="p-3 rounded-lg border bg-red-50 border-red-200 text-center">
                <p className="text-xs text-red-600 font-medium">Negative Stock</p>
                <p className="text-xl font-bold text-red-700">{data.filter(r => r.negative_alert).length}</p>
              </div>
              <div className="p-3 rounded-lg border bg-green-50 border-green-200 text-center">
                <p className="text-xs text-green-600 font-medium">Total Value</p>
                <p className="text-xl font-bold text-green-700">{formatCurrency(totalValue)}</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Ingredient</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Unit</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Balance</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Reorder</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Value</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={i} className="border-t border-border hover:bg-secondary/40">
                      <td className="px-4 py-3 font-medium text-foreground">{row.ingredient_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.unit}</td>
                      <td className={`px-4 py-3 text-right font-mono ${row.negative_alert ? "text-red-600 font-bold" : ""}`}>{Number(row.balance_qty).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">{Number(row.reorder_level).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(Math.abs(Number(row.movement_value ?? 0)))}</td>
                      <td className="px-4 py-3 text-center">
                        {row.negative_alert
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">Negative</span>
                          : row.reorder_alert
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold">Reorder</span>
                            : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Branch Comparison Modal ──────────────────────────────────────────────────

function BranchComparisonModal({ onClose }: { onClose: () => void }) {
  const [period,  setPeriod]  = useState(currentPeriod());
  const [data,    setData]    = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      const result = await generateReport(`branch-compare&period=${period}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  return (
    <ReportModal title="🏢 Branch Comparison" description="Side-by-side metrics across all branches" onClose={onClose}>
      <BranchPeriodControls branches={[]} branchId="" setBranchId={() => {}} period={period} setPeriod={setPeriod} onGenerate={handleGenerate} loading={loading} />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="🏢" text="Select a period and click Generate" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No data for this period" />}
        {fetched && data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Branch</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Food Cost</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Gross Profit</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Net Profit</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Food Cost %</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-border hover:bg-secondary/40">
                    <td className="px-4 py-3 font-medium text-foreground">{row.branch_name}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(row.revenue))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(row.food_cost))}</td>
                    <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(Number(row.gross_profit))}</td>
                    <td className={`px-4 py-3 text-right font-bold ${Number(row.net_profit) >= 0 ? "text-green-700" : "text-red-600"}`}>{formatCurrency(Number(row.net_profit))}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${Number(row.food_cost_pct) <= 30 ? "bg-green-100 text-green-700" : Number(row.food_cost_pct) <= 40 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                        {Number(row.food_cost_pct).toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Finance / P&L Report Modal ───────────────────────────────────────────────

function FinanceReportModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [period,   setPeriod]   = useState(currentPeriod());
  const [data,     setData]     = useState<any>(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    if (!branchId) return;
    setLoading(true);
    try {
      const result = await apiCall<any>(`/api/reports/pl?branch_id=${branchId}&period=${period}`);
      setData(result);
    } finally { setLoading(false); }
  }

  const branch = branches.find(b => String(b.id) === branchId);

  return (
    <ReportModal title="📊 Finance Report" description="P&L summary for selected branch and period" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} period={period} setPeriod={setPeriod} onGenerate={handleGenerate} loading={loading} requireBranch />
      <div className="px-6 py-4">
        {!data && !loading && <EmptyState emoji="📊" text="Select branch and period then click Generate" />}
        {data && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Revenue",          value: formatCurrency(data.revenue),          color: "bg-blue-50 border-blue-200 text-blue-700"   },
                { label: "COGS",             value: formatCurrency(data.cogs),             color: "bg-red-50 border-red-200 text-red-700"      },
                { label: "Gross Profit",     value: formatCurrency(data.gross_profit),     color: "bg-green-50 border-green-200 text-green-700" },
                { label: "Operating Profit", value: formatCurrency(data.operating_profit), color: data.operating_profit >= 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700" },
              ].map(card => (
                <div key={card.label} className={`rounded-lg border p-4 ${card.color}`}>
                  <p className="text-xs font-semibold opacity-70">{card.label}</p>
                  <p className="text-xl font-bold mt-1">{card.value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-5 py-3 bg-secondary font-semibold text-sm text-foreground">
                Income Statement — {branch?.name} · {period}
              </div>
              <div className="divide-y divide-border">
                {[
                  { label: "Revenue",              value: data.revenue,             color: "text-blue-600",  indent: false, bold: false },
                  { label: "− Food Cost (COGS)",   value: -data.cogs,               color: "text-red-500",   indent: true,  bold: false },
                  { label: "− Waste Cost",         value: -data.waste_cost,         color: "text-red-400",   indent: true,  bold: false },
                  { label: "Gross Profit",         value: data.gross_profit,        color: data.gross_profit >= 0 ? "text-green-600" : "text-red-600", indent: false, bold: true  },
                  { label: "− Payroll",            value: -data.total_payroll,      color: "text-amber-600", indent: true,  bold: false },
                  { label: "− Operating Expenses", value: -data.total_expenses,     color: "text-amber-500", indent: true,  bold: false },
                  { label: "− Depreciation",       value: -data.total_depreciation, color: "text-amber-400", indent: true,  bold: false },
                  { label: "− Accruals",           value: -data.total_accruals,     color: "text-amber-400", indent: true,  bold: false },
                  { label: "− Prepayments",        value: -data.total_prepayments,  color: "text-amber-400", indent: true,  bold: false },
                  { label: "Operating Profit",     value: data.operating_profit,    color: data.operating_profit >= 0 ? "text-green-600" : "text-red-600", indent: false, bold: true  },
                ].map((row, i) => (
                  <div key={i} className={`flex justify-between items-center px-5 py-3 ${row.bold ? "bg-secondary/50" : ""}`}>
                    <span className={`text-sm ${row.bold ? "font-bold" : "font-medium"} ${row.indent ? "pl-4 text-muted-foreground" : "text-foreground"}`}>
                      {row.label}
                    </span>
                    <span className={`text-sm font-bold font-mono ${row.color}`}>
                      {row.value < 0 ? `(${formatCurrency(Math.abs(row.value))})` : formatCurrency(row.value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 bg-secondary/30 grid grid-cols-2 gap-4 text-xs border-t border-border">
                <div><span className="text-muted-foreground">Food Cost %: </span><span className={`font-bold ${data.food_cost_pct > 35 ? "text-red-600" : "text-green-600"}`}>{Number(data.food_cost_pct).toFixed(1)}%</span></div>
                <div><span className="text-muted-foreground">Labor Cost %: </span><span className={`font-bold ${data.labor_cost_pct > 30 ? "text-red-600" : "text-green-600"}`}>{Number(data.labor_cost_pct).toFixed(1)}%</span></div>
                <div><span className="text-muted-foreground">Gross Margin %: </span><span className={`font-bold ${data.gross_margin_pct < 50 ? "text-amber-600" : "text-green-600"}`}>{Number(data.gross_margin_pct).toFixed(1)}%</span></div>
                <div><span className="text-muted-foreground">Net Margin %: </span><span className={`font-bold ${data.net_margin_pct < 10 ? "text-red-600" : "text-green-600"}`}>{Number(data.net_margin_pct).toFixed(1)}%</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Budget vs Actual Modal ───────────────────────────────────────────────────

function BudgetModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [period,   setPeriod]   = useState(currentPeriod());
  const [data,     setData]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    if (!branchId) return;
    setLoading(true);
    try {
      const result = await apiCall<any[]>(`/api/budgets/${branchId}/${period}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  return (
    <ReportModal title="💰 Budget vs Actual" description="Compare budgeted amounts against real spending" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} period={period} setPeriod={setPeriod} onGenerate={handleGenerate} loading={loading} requireBranch />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="💰" text="Select branch and period then click Generate" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No budget set for this period" />}
        {fetched && data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Budget</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Actual</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Variance</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Used %</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Progress</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => {
                  const pct  = Math.min(100, Number(row.pct_used));
                  const over = Number(row.pct_used) > 100;
                  return (
                    <tr key={i} className="border-t border-border hover:bg-secondary/40">
                      <td className="px-4 py-3 font-medium text-foreground capitalize">{String(row.category).replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(row.budget_amount))}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(row.actual_amount))}</td>
                      <td className={`px-4 py-3 text-right font-bold ${Number(row.variance) >= 0 ? "text-green-600" : "text-red-600"}`}>{formatCurrency(Number(row.variance))}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${over ? "text-red-600" : Number(row.pct_used) > 80 ? "text-amber-600" : "text-green-600"}`}>{Number(row.pct_used).toFixed(1)}%</td>
                      <td className="px-4 py-3 min-w-32">
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${over ? "bg-red-500" : Number(row.pct_used) > 80 ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Top Losses Modal ─────────────────────────────────────────────────────────

function TopLossesModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data,     setData]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params = branchId ? `?branch_id=${branchId}` : "";
      const result = await apiCall<any[]>(`/api/waste/summary${params}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  const totalLoss = data.reduce((s, r) => s + Number(r.total_cost ?? 0), 0);

  return (
    <ReportModal title="⚠️ Top Losses Analysis" description="Waste and damage cost breakdown by reason" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} onGenerate={handleGenerate} loading={loading} />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="⚠️" text="Click Generate to see loss analysis" />}
        {fetched && data.length === 0 && <EmptyState emoji="✅" text="No waste or damage recorded" />}
        {fetched && data.length > 0 && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg border bg-red-50 border-red-200">
              <p className="text-xs text-red-600 font-medium">Total Loss Value</p>
              <p className="text-2xl font-bold text-red-700">{formatCurrency(totalLoss)}</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Reason</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Incidents</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Total Qty</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-foreground">Total Cost</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-foreground">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => {
                    const pct = totalLoss > 0 ? (Number(row.total_cost) / totalLoss) * 100 : 0;
                    return (
                      <tr key={i} className="border-t border-border hover:bg-secondary/40">
                        <td className="px-4 py-3 font-medium text-foreground capitalize">{String(row.reason).replace(/_/g, " ")}</td>
                        <td className="px-4 py-3 text-right">{row.incidents}</td>
                        <td className="px-4 py-3 text-right font-mono">{Number(row.total_qty).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(Number(row.total_cost))}</td>
                        <td className="px-4 py-3 min-w-32">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                              <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Sales Mix Modal ──────────────────────────────────────────────────────────

function SalesMixModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [period,   setPeriod]   = useState(currentPeriod());
  const [data,     setData]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branch_id", branchId);
      params.set("period", period);
      const result = await apiCall<any[]>(`/api/sales?${params}&limit=200`);
      const map = new Map<string, { name: string; qty: number; revenue: number }>();
      (result ?? []).forEach((row: any) => {
        const name = row.item_name ?? row.product_name ?? `Product #${row.product_id}`;
        const ex = map.get(name) ?? { name, qty: 0, revenue: 0 };
        map.set(name, { name, qty: ex.qty + Number(row.quantity), revenue: ex.revenue + Number(row.net_amount ?? 0) });
      });
      setData(Array.from(map.values()).sort((a, b) => b.revenue - a.revenue));
      setFetched(true);
    } finally { setLoading(false); }
  }

  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);

  return (
    <ReportModal title="📊 Sales Mix Analysis" description="Product revenue and quantity breakdown" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} period={period} setPeriod={setPeriod} onGenerate={handleGenerate} loading={loading} />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="📊" text="Select filters and click Generate" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No sales data for this period" />}
        {fetched && data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Product</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Qty Sold</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Revenue</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Revenue Share</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => {
                  const pct = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
                  return (
                    <tr key={i} className="border-t border-border hover:bg-secondary/40">
                      <td className="px-4 py-3 font-medium text-foreground">{row.name}</td>
                      <td className="px-4 py-3 text-right">{Number(row.qty).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-bold text-primary">{formatCurrency(row.revenue)}</td>
                      <td className="px-4 py-3 min-w-40">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-primary/60 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-12">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Supplier Price History Modal ─────────────────────────────────────────────

function PriceHistoryModal({ onClose }: { onClose: () => void }) {
  const [ingredients,  setIngredients]  = useState<any[]>([]);
  const [ingredientId, setIngredientId] = useState("");
  const [data,         setData]         = useState<any[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [fetched,      setFetched]      = useState(false);

  useEffect(() => { apiCall<any[]>("/api/ingredients").then(setIngredients).catch(() => {}); }, []);

  async function handleGenerate() {
    if (!ingredientId) return;
    setLoading(true);
    try {
      const result = await apiCall<any[]>(`/api/suppliers/price-history/${ingredientId}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  return (
    <ReportModal title="📉 Supplier Price History" description="Track ingredient pricing changes over time" onClose={onClose}>
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-secondary/30 flex-wrap">
        <select className={inputClass} value={ingredientId} onChange={e => setIngredientId(e.target.value)}>
          <option value="">Select Ingredient *</option>
          {ingredients.map((i: any) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
        </select>
        <Button size="sm" onClick={handleGenerate} disabled={loading || !ingredientId}>
          {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {loading ? "Loading..." : "Generate"}
        </Button>
      </div>
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="📉" text="Select an ingredient to see price history" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No price history for this ingredient" />}
        {fetched && data.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Date</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Supplier</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-foreground">Price ({getCurrencyLabel()})</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-foreground">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} className="border-t border-border hover:bg-secondary/40">
                    <td className="px-4 py-3 text-foreground">{row.entry_date}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{row.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-bold text-primary">{formatCurrency(Number(row.price ?? row.unit_cost ?? 0))}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{row.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Audit Trail Modal ────────────────────────────────────────────────────────

function AuditTrailModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data,     setData]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (branchId) params.set("branch_id", branchId);
      const result = await apiCall<any[]>(`/api/audit-log?${params}`);
      setData(result ?? []);
      setFetched(true);
    } finally { setLoading(false); }
  }

  return (
    <ReportModal title="📋 Audit Trail" description="Complete transaction history and system changes" onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} onGenerate={handleGenerate} loading={loading} />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji="📋" text="Click Generate to load audit trail" />}
        {fetched && data.length === 0 && <EmptyState emoji="📭" text="No audit entries found" />}
        {fetched && data.length > 0 && (
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {data.map((log, i) => (
              <div key={i} className="flex items-start gap-4 px-4 py-3 hover:bg-secondary/30">
                <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold capitalize">{String(log.action).replace(/_/g, " ")}</span>
                    <span className="text-sm font-medium text-foreground capitalize">{String(log.entity_type).replace(/_/g, " ")}</span>
                  </div>
                  {log.details   && <p className="text-xs text-muted-foreground truncate">{log.details}</p>}
                  {log.user_name && <p className="text-xs text-muted-foreground mt-0.5">by <span className="font-medium text-foreground">{log.user_name}</span></p>}
                </div>
                <p className="text-xs text-muted-foreground flex-shrink-0">{log.created_at ? formatDate(log.created_at) : "—"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Stock Alerts Modal ───────────────────────────────────────────────────────

function StockAlertsModal({ onClose, type }: { onClose: () => void; type: "negative" | "reorder" }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [data,     setData]     = useState<any[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [fetched,  setFetched]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    if (!branchId) return;
    setLoading(true);
    try {
      const result = await apiCall<any[]>(`/api/stock/${branchId}`);
      const filtered = (result ?? []).filter((r: any) =>
        type === "negative" ? r.negative_alert : r.reorder_alert && !r.negative_alert
      );
      setData(filtered);
      setFetched(true);
    } finally { setLoading(false); }
  }

  const title = type === "negative" ? "⚠️ Negative Stock Alerts" : "🔔 Reorder Alerts";
  const desc  = type === "negative" ? "Items with negative inventory balance" : "Items below their reorder level";

  return (
    <ReportModal title={title} description={desc} onClose={onClose}>
      <BranchPeriodControls branches={branches} branchId={branchId} setBranchId={setBranchId} onGenerate={handleGenerate} loading={loading} requireBranch />
      <div className="px-6 py-4">
        {!fetched && <EmptyState emoji={type === "negative" ? "⚠️" : "🔔"} text="Select a branch and click Generate" />}
        {fetched && data.length === 0 && <EmptyState emoji="✅" text={type === "negative" ? "No negative stock — all good!" : "No items below reorder level!"} />}
        {fetched && data.length > 0 && (
          <div className="space-y-2">
            {data.map((row, i) => (
              <div key={i} className={`p-4 rounded-lg border ${type === "negative" ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}`}>
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground">{row.ingredient_name}</p>
                  <span className={`text-sm font-bold font-mono ${type === "negative" ? "text-red-600" : "text-yellow-700"}`}>
                    {Number(row.balance_qty).toFixed(3)} {row.unit}
                  </span>
                </div>
                {type === "reorder" && (
                  <p className="text-xs text-muted-foreground mt-1">Reorder level: {Number(row.reorder_level).toFixed(3)} {row.unit}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function ExportModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState(today());
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleExport() {
    if (!branchId) return;
    setLoading(true);
    try { await exportReport(Number(branchId), dateFrom, dateTo, "csv"); }
    finally { setLoading(false); }
  }

  return (
    <ReportModal title="📥 Export Sales Report" description="Download sales data as CSV" onClose={onClose}>
      <div className="px-6 py-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">Branch *</label>
          <select className={`${inputClass} w-full`} value={branchId} onChange={e => setBranchId(e.target.value)}>
            <option value="">Select Branch</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date From</label>
            <input type="date" className={`${inputClass} w-full`} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date To</label>
            <input type="date" className={`${inputClass} w-full`} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>
        <Button className="w-full" onClick={handleExport} disabled={loading || !branchId}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
          {loading ? "Downloading..." : "Download CSV"}
        </Button>
      </div>
    </ReportModal>
  );
}

// ─── Dashboard Summary Modal ──────────────────────────────────────────────────

function DashboardSummaryModal({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState(today());
  const [data,     setData]     = useState<any>(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => { getBranches().then(setBranches); }, []);

  async function handleGenerate() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branch_id", branchId);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo)   params.set("date_to",   dateTo);
      const result = await apiCall<any>(`/api/dashboard?${params}`);
      setData(result);
    } finally { setLoading(false); }
  }

  return (
    <ReportModal title="📈 Dashboard Summary" description="Key metrics and KPIs overview" onClose={onClose}>
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border bg-secondary/30 flex-wrap">
        <select className={inputClass} value={branchId} onChange={e => setBranchId(e.target.value)}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" className={inputClass} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <input type="date" className={inputClass} value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        <Button size="sm" onClick={handleGenerate} disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {loading ? "Loading..." : "Generate"}
        </Button>
      </div>
      <div className="px-6 py-4">
        {!data && !loading && <EmptyState emoji="📈" text="Click Generate to load dashboard summary" />}
        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Sales",       value: formatCurrency(data.total_sales ?? 0), color: "bg-blue-50 border-blue-200 text-blue-700"    },
                { label: "Pending Approvals", value: String(data.pending_approvals ?? 0),   color: "bg-amber-50 border-amber-200 text-amber-700" },
                { label: "Branch Count",      value: String(data.branch_count ?? 0),        color: "bg-green-50 border-green-200 text-green-700" },
                { label: "Sales Change",      value: `${data.sales_change ?? 0}%`,          color: Number(data.sales_change) >= 0 ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700" },
              ].map(card => (
                <div key={card.label} className={`rounded-lg border p-4 ${card.color}`}>
                  <p className="text-xs font-semibold opacity-70">{card.label}</p>
                  <p className="text-xl font-bold mt-1">{card.value}</p>
                </div>
              ))}
            </div>
            {data.recent_transactions?.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-secondary font-semibold text-sm text-foreground">Recent Transactions</div>
                <div className="divide-y divide-border">
                  {data.recent_transactions.slice(0, 8).map((tx: any, i: number) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-secondary/30">
                      <div>
                        <p className="text-sm font-medium text-foreground">{tx.description}</p>
                        <p className="text-xs text-muted-foreground">{tx.date}</p>
                      </div>
                      <span className="font-bold text-primary">{formatCurrency(tx.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </ReportModal>
  );
}

// ─── Main Report Page ─────────────────────────────────────────────────────────

export default function Report() {
  const [modal,       setModal]       = useState<ModalType>(null);
  const [search,      setSearch]      = useState("");
  const [activeTab,   setActiveTab]   = useState<CategoryTab>("all");
  const [recentlyOpened, setRecentlyOpened] = useState<RecentEntry[]>([]);

  function openModal(m: ModalType) {
    if (!m) return;
    setModal(m);
    const def = ALL_REPORTS.find(r => r.modal === m);
    if (def) {
      setRecentlyOpened(prev => {
        const filtered = prev.filter(r => r.modal !== m);
        return [{ name: def.name, icon: def.icon, modal: m, openedAt: new Date() }, ...filtered].slice(0, 5);
      });
    }
  }

  const close = () => setModal(null);

  const tabs: { key: CategoryTab; label: string }[] = [
    { key: "all",         label: "All Reports"   },
    { key: "financial",   label: "Financial"     },
    { key: "operational", label: "Operational"   },
    { key: "audit",       label: "Audit"         },
  ];

  const visibleReports = ALL_REPORTS.filter(r => {
    const matchesTab    = activeTab === "all" || r.category === activeTab;
    const matchesSearch = !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.desc.toLowerCase().includes(search.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const countFor = (cat: "financial" | "operational" | "audit") =>
    ALL_REPORTS.filter(r => r.category === cat).length;

  function timeAgo(date: Date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60)   return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  return (
    <div className="space-y-6">

      {/* ── Modals ── */}
      {modal === "menu"           && <MenuEngineeringModal  onClose={close} />}
      {modal === "stock"          && <StockBalancesModal    onClose={close} />}
      {modal === "branch-compare" && <BranchComparisonModal onClose={close} />}
      {modal === "export"         && <ExportModal           onClose={close} />}
      {modal === "finance"        && <FinanceReportModal    onClose={close} />}
      {modal === "dashboard"      && <DashboardSummaryModal onClose={close} />}
      {modal === "budget"         && <BudgetModal           onClose={close} />}
      {modal === "losses"         && <TopLossesModal        onClose={close} />}
      {modal === "sales-mix"      && <SalesMixModal         onClose={close} />}
      {modal === "price-history"  && <PriceHistoryModal     onClose={close} />}
      {modal === "audit"          && <AuditTrailModal       onClose={close} />}
      {modal === "neg-stock"      && <StockAlertsModal      onClose={close} type="negative" />}
      {modal === "reorder"        && <StockAlertsModal      onClose={close} type="reorder"  />}

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary">Reports</h1>
          <p className="text-muted-foreground mt-1">
            {ALL_REPORTS.length} reports across financial, operational and audit categories
          </p>
        </div>
        <Button size="sm" className="gap-2 self-start sm:self-auto" onClick={() => openModal("export")}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* ── Search + Tabs ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* category tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto pb-px">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.label}
              {tab.key !== "all" && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                }`}>
                  {countFor(tab.key as any)}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* search */}
        <div className="relative flex-shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search reports…"
            className={`${inputClass} pl-8 w-52`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Report Grid ── */}
      {visibleReports.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground text-sm">No reports match your search.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSearch(""); setActiveTab("all"); }}>
            Clear filters
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleReports.map(report => (
            <div
              key={report.modal}
              className="group p-4 bg-background rounded-xl border border-border hover:border-primary/40 hover:shadow-sm transition-all flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0 text-xl group-hover:scale-105 transition-transform">
                  {report.icon}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{report.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{report.desc}</p>
                  <span className={`mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                    report.category === "financial"   ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"     :
                    report.category === "operational" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" :
                                                        "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  }`}>
                    {report.category}
                  </span>
                </div>
              </div>
              <Button size="sm" variant="outline" className="flex-shrink-0 gap-1" onClick={() => openModal(report.modal)}>
                <FileText className="w-3.5 h-3.5" /> Open
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ── Recently Opened ── */}
      {recentlyOpened.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Recently Opened</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentlyOpened.map(entry => (
              <button
                key={entry.modal}
                onClick={() => openModal(entry.modal)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/40 hover:bg-secondary/80 hover:border-primary/30 transition-all text-left"
              >
                <span className="text-base">{entry.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-foreground leading-tight">{entry.name}</p>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(entry.openedAt)}</p>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}