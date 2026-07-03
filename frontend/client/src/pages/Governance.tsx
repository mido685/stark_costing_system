import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  CheckCircle, XCircle, Loader2, RefreshCw, AlertTriangle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Search, Filter, Download, Clock, ShieldCheck, Calendar,
  TrendingUp, ShoppingCart, History, Package, BadgeCheck,
  Ban, Eye, User, DollarSign,
} from "lucide-react";
import { apiCall } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApprovalStatus = "pending" | "approved" | "rejected";
type CategoryType   = "expense" | "inventory" | "asset" | "service";

type ExpenseCategory = { id: number; name: string; type: CategoryType };

type ApprovalItem = {
  id:               string;
  purchaseId?:      number;
  typeKey:          string;
  desc:             string;
  submitted_by:     string;
  date:             string;
  status:           ApprovalStatus;
  amount?:          number;
  currency?:        string;
  priority?:        "high" | "medium" | "low";
  fromProcurement?: boolean;
  ingredientName?: string;
  supplierName?:   string;
  priceType?:      string;
  previousCost?: number;
  priceChangePct?: number;
};

type GovernanceHistoryRow = {
  id:               number;
  item_id:          string;
  entity_type:      string;
  action:           "approve" | "reject";
  action_date:      string;
  actor_name?:      string;
  actor_id?:        number;
  description?:     string;
  submitted_by?:    string;
  original_date?:   string;
  amount?:          number;
  currency?:        string;
  from_procurement: boolean;
  branch_id?:       number;
  supplier_name?:   string;
  ingredient_name?: string;
};

type PurchaseHistoryRow = {
  id:              number;
  branch_name:     string;
  supplier_name:   string;
  ingredient_name: string;
  unit:            string;
  entry_date:      string;
  quantity:        number;
  unit_cost:       number;
  gross_amount?:   number;
  tax_amount?:     number;
  payable_amount?: number;
  status:          string;
  notes?:          string;
};

type ActiveTab = "approvals" | "gov-history" | "po-history";
type SortField = "date" | "typeKey" | "submitted_by" | "priority";
type SortDir   = "asc" | "desc";
type ToastMessage = { id: string; type: "success" | "error" | "warning"; message: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE         = 20;
const HISTORY_PAGE_SIZE = 25;
export const PROCUREMENT_PO_EVENT = "procurement:po-created";

const CATEGORY_TYPES: { value: CategoryType; label: string }[] = [
  { value: "expense",   label: "Expense"   },
  { value: "inventory", label: "Inventory" },
  { value: "asset",     label: "Asset"     },
  { value: "service",   label: "Service"   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTypeKey(row: any): string {
  const src = String(row.table_name ?? row.type ?? row.record_type ?? row.kind ?? row.entity_type ?? "").toLowerCase();
  if (src.includes("price_history") || src.includes("price history")) return "gov.approvalType.priceHistory";
  if (src.includes("purchase") || src.includes("po")) return "gov.approvalType.purchase";
  if (src.includes("expense"))                         return "gov.approvalType.expense";
  if (src.includes("transfer"))                        return "gov.approvalType.transfer";
  if (src.includes("adjustment") || src.includes("adj")) return "gov.approvalType.stockAdj";
  if (src.includes("sale"))                            return "gov.approvalType.sale";
  return "gov.approvalType.other";
}

function normalizeStatus(raw: unknown): ApprovalStatus {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "pending";
}

function toPriority(row: any): "high" | "medium" | "low" {
  const p = String(row.priority ?? "").toLowerCase();
  if (p === "high" || p === "urgent") return "high";
  if (p === "low")                    return "low";
  return "medium";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(dateStr));
  } catch { return dateStr; }
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(dateStr));
  } catch { return dateStr; }
}

function formatCurrency(amount?: number, currency?: string): string | null {
  if (amount == null) return null;
  const cur = currency ?? "EGP";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(amount);
  } catch { return `${cur} ${amount.toLocaleString()}`; }
}

function formatNumber(n?: number, decimals = 3): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function generateToastId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ─── HTML Viewer ──────────────────────────────────────────────────────────────

const SHARED_HTML_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;background:#f8fafc}
  .page{max-width:800px;margin:0 auto;background:#fff;min-height:100vh;padding:40px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:20px;margin-bottom:28px}
  .brand{font-size:10px;font-weight:800;letter-spacing:4px;color:#1e3a5f;text-transform:uppercase;margin-bottom:6px}
  .doc-title{font-size:24px;font-weight:800;color:#0f172a;margin-bottom:4px}
  .doc-sub{font-size:12px;color:#64748b}
  .meta{text-align:right;font-size:11px;color:#94a3b8;line-height:1.8}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:80px;font-weight:900;opacity:0.04;color:#dc2626;pointer-events:none;z-index:0;letter-spacing:8px;text-transform:uppercase}
  @media print{.watermark{opacity:0.06}}
  .section{margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f1f5f9}
  .section:last-of-type{border-bottom:none}
  .section-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:10px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .info-block.full{grid-column:1/-1}
  .info-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
  .info-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:4px}
  .info-value{font-size:13px;font-weight:600;color:#0f172a}
  .info-value.up{color:#dc2626}
  .info-value.down{color:#16a34a}
  .info-value.neutral{color:#64748b}
  .totals{margin-left:auto;width:100%;max-width:320px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px}
  .totals-row{display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px}
  .totals-row.highlight{border-bottom:none;background:#1e3a5f;color:#fff;font-weight:700;font-size:14px}
  .totals-row.highlight span{color:#93c5fd}
  .notes-box{background:#fffbeb;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:8px;padding:14px;font-size:12px;color:#475569;line-height:1.6}
  .notes-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#92400e;margin-bottom:6px;display:flex;align-items:center;gap:4px}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
  .footer-brand{font-size:10px;font-weight:700;letter-spacing:2px;color:#1e3a5f;text-transform:uppercase}
  .footer-note{font-size:10px;color:#94a3b8}
  .print-btn{position:fixed;top:20px;right:20px;padding:10px 20px;background:#1e3a5f;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2)}
  .print-btn:hover{background:#1e40af}
  @media print{
  .print-btn{display:none}
  body{background:#fff}
  .page{padding:20px;max-width:100%;box-shadow:none}
  .info-block{break-inside:avoid}
  .section{break-inside:avoid}
  .totals{margin-left:0;max-width:100%}
  .header{break-after:avoid}
  .footer{break-before:avoid}
  @page{margin:1.5cm;size:A4}
}
`;

interface HtmlViewerParams {
  title: string; subtitle: string; ref: string;
  badge?: { label: string; color: string; bg: string };
  sections: { heading: string; rows: { label: string; value: string }[] }[];
  totals?: { label: string; value: string; highlight?: boolean }[];
  notes?: string;
}

function openRecordAsHtml(params: HtmlViewerParams): void {
  const { title, subtitle, ref, badge, sections, totals, notes } = params;
  const now       = new Date().toLocaleDateString();
  const badgeHtml = badge ? `<span class="status-badge" style="background:${badge.bg};color:${badge.color}">${badge.label}</span>` : "";
  const sectionsHtml = sections.map(sec => `
    <div class="section"><div class="section-title">${sec.heading}</div><div class="info-grid">
    ${sec.rows.map((r, idx, arr) => {
      const val        = r.value ?? "";
      const colorClass = val.startsWith("▲") ? " up" : val.startsWith("▼") ? " down" : "";
      const fullClass  = arr.length % 2 !== 0 && idx === arr.length - 1 ? " full" : "";
      return `<div class="info-block${fullClass}"><div class="info-label">${r.label}</div><div class="info-value${colorClass}">${val}</div></div>`;
    }).join("")}
    </div></div>`).join("");
  const totalsHtml = totals?.length ? `<div class="totals">${totals.map(t => `<div class="totals-row${t.highlight ? " highlight" : ""}"><span>${t.label}</span><span>${t.value}</span></div>`).join("")}</div>` : "";
  const notesHtml = notes
  ? `<div class="section">
       <div class="section-title">Notes</div>
       <div class="notes-box">
         <div class="notes-label">📝 Additional Information</div>
         ${notes}
       </div>
     </div>`
  : "";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>${ref} — STARK AI</title><style>${SHARED_HTML_STYLES}</style></head>
<body><button class="print-btn" onclick="window.print()">🖨 Save as PDF</button>
<div class="page">
  ${badge?.label === "REJECTED" ? `<div class="watermark">REJECTED</div>` : ""}
  <div class="header">
    <div><div class="brand">STARK AI — Costing Platform</div><div class="doc-title">${title}</div><div class="doc-sub">${subtitle}</div></div>
    <div class="meta">${badgeHtml ? `<div>${badgeHtml}</div>` : ""}<div style="margin-top:8px">Generated: ${now}</div><div>Ref: ${ref}</div></div>
  </div>
  ${sectionsHtml}${totalsHtml}${notesHtml}
  <div class="footer"><div class="footer-brand">STARK AI · ${title}</div><div class="footer-note">Confidential · ${now} · ${ref}</div></div>
</div></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function statusBadgeColors(status: string) {
  const s = status.toLowerCase();
  if (s === "approved")                   return { color: "#16a34a", bg: "#dcfce7" };
  if (s === "rejected" || s === "reject") return { color: "#dc2626", bg: "#fee2e2" };
  return { color: "#d97706", bg: "#fef3c7" };
}

function openPurchaseOrderHtml(row: PurchaseHistoryRow): void {
  const gross = row.gross_amount ?? row.quantity * row.unit_cost;
  const tax   = row.tax_amount ?? 0;
  const pay   = row.payable_amount ?? gross + tax;
  const bc    = statusBadgeColors(row.status);
  openRecordAsHtml({
    title: "Purchase Order", subtitle: `PO-${String(row.id).padStart(5,"0")} · ${String(row.entry_date).slice(0,10)}`,
    ref: `PO-${String(row.id).padStart(5,"0")}`, badge: { label: row.status.toUpperCase(), color: bc.color, bg: bc.bg },
    sections: [{ heading: "Order Details", rows: [
      { label: "Branch", value: row.branch_name ?? "—" }, { label: "Supplier", value: row.supplier_name ?? "—" },
      { label: "Ingredient", value: `${row.ingredient_name ?? "—"}${row.unit ? ` (${row.unit})` : ""}` },
      { label: "Date", value: String(row.entry_date).slice(0,10) },
      { label: "Quantity", value: Number(row.quantity).toFixed(3) }, { label: "Unit Cost", value: formatNumber(row.unit_cost, 2) },
    ]}],
    totals: [
      { label: "Gross Amount", value: formatNumber(gross, 2) }, { label: "Tax", value: formatNumber(tax, 2) },
      { label: "Total Payable", value: formatNumber(pay, 2), highlight: true },
    ],
    notes: row.notes,
  });
}

function openApprovalHtml(a: ApprovalItem, t: (k: string) => string): void {
  const bc  = statusBadgeColors(a.status);
  const ref = a.fromProcurement && a.purchaseId
    ? `PO-${String(a.purchaseId).padStart(5, "0")}`
    : `APR-${String(a.id).padStart(5, "0")}`;

  const isPriceHistory = a.typeKey === "gov.approvalType.priceHistory";

  const detailRows = isPriceHistory
    ? [
        { label: "Type",          value: t(a.typeKey)                          },
        { label: "Ingredient",    value: a.ingredientName  ?? "—"              },
        { label: "Supplier",      value: a.supplierName    ?? "—"              },
        { label: "Price Type",    value: a.priceType       ?? "—"              },
        { label: "Submitted By",  value: a.submitted_by    || "—"              },
        { label: "Date",          value: formatDate(a.date)                    },
        { label: "Priority",      value: (a.priority ?? "medium").toUpperCase()},
        { label: "Source",        value: a.fromProcurement ? "Procurement" : "System" },
        { label: "Price Before",  value: a.previousCost != null ? formatCurrency(a.previousCost, a.currency) ?? "—" : "—" },
        { label: "Price After",   value: a.amount       != null ? formatCurrency(a.amount,       a.currency) ?? "—" : "—" },
        { label: "Change",        value: a.priceChangePct != null ? `${a.priceChangePct > 0 ? "▲" : "▼"} ${Math.abs(a.priceChangePct).toFixed(2)}%` : "—" },
      ]
    : [
        { label: "Type",          value: t(a.typeKey)                          },
        { label: "Submitted By",  value: a.submitted_by    || "—"              },
        { label: "Date",          value: formatDate(a.date)                    },
        { label: "Priority",      value: (a.priority ?? "medium").toUpperCase()},
        { label: "Source",        value: a.fromProcurement ? "Procurement" : "System" },
      ];

  openRecordAsHtml({
    title:    t(a.typeKey),
    subtitle: `${ref} · ${formatDateShort(a.date)}`,
    ref,
    badge: { label: a.status.toUpperCase(), color: bc.color, bg: bc.bg },
    sections: [{
  heading: isPriceHistory
    ? "Price Change Details"
    : a.fromProcurement
    ? "Purchase Order Details"
    : "Approval Details",
  rows: detailRows,
}],
  totals: a.amount != null
  ? isPriceHistory
    ? [
        { label: "Previous Price", value: formatCurrency(a.previousCost, a.currency) ?? "—"  },
        { label: "New Unit Price",  value: formatCurrency(a.amount,       a.currency) ?? "—", highlight: true },
      ]
    : [{ label: "Amount", value: formatCurrency(a.amount, a.currency) ?? "—", highlight: true }]
    : undefined,
    notes: isPriceHistory ? undefined : a.desc,
  });
}
function openGovernanceHistoryHtml(row: GovernanceHistoryRow): void {
  const bc = statusBadgeColors(row.action === "approve" ? "approved" : "rejected");
  openRecordAsHtml({
    title: "Governance Action", subtitle: `${row.item_id} · ${formatDateShort(row.action_date)}`,
    ref: `GOV-${String(row.id).padStart(5,"0")}`,
    badge: { label: row.action === "approve" ? "APPROVED" : "REJECTED", color: bc.color, bg: bc.bg },
    sections: [{ heading: "Action Details", rows: [
      { label: "Item", value: row.item_id }, { label: "Entity Type", value: row.entity_type },
      { label: "Actor", value: row.actor_name ?? "—" }, { label: "Submitted By", value: row.submitted_by ?? "—" },
      { label: "Supplier", value: row.supplier_name ?? "—" }, { label: "Ingredient", value: row.ingredient_name ?? "—" },
      { label: "Date", value: formatDate(row.action_date) }, { label: "Source", value: row.from_procurement ? "Procurement" : "System" },
    ]}],
    totals: row.amount != null ? [{ label: "Amount", value: formatCurrency(row.amount, row.currency ?? undefined) ?? "—", highlight: true }] : undefined,
    notes: row.description,
  });
}

// ─── Animation styles ─────────────────────────────────────────────────────────

const ANIMATION_STYLES = `
  @keyframes gov-fade-in { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
  @keyframes gov-slide-right { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
  @keyframes gov-pop { 0%{transform:scale(0.95);opacity:0} 60%{transform:scale(1.03)} 100%{transform:scale(1);opacity:1} }
  .gov-fade-in     { animation: gov-fade-in   0.2s ease both; }
  .gov-slide-right { animation: gov-slide-right 0.2s ease both; }
  .gov-pop         { animation: gov-pop       0.25s ease both; }
  .gov-btn-press:active { transform: scale(0.96); }
  .gov-btn-press   { transition: transform 0.1s ease, box-shadow 0.1s ease; }
  .gov-ripple      { position: relative; overflow: hidden; }
  .gov-ripple::after { content:""; position:absolute; inset:0; background:white; opacity:0; border-radius:inherit; transition:opacity 0.3s ease; }
  .gov-ripple:active::after { opacity: 0.15; }
  .gov-row-hover   { transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .gov-row-hover:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
`;

function useInjectStyles() {
  useEffect(() => {
    const id = "gov-animations";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id; el.textContent = ANIMATION_STYLES;
    document.head.appendChild(el);
    return () => { document.getElementById(id)?.remove(); };
  }, []);
}

// ─── Small shared components ──────────────────────────────────────────────────

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  useEffect(() => { const t = setTimeout(() => onDismiss(toast.id), 4000); return () => clearTimeout(t); }, [toast.id, onDismiss]);
  const colors = {
    success: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/50 dark:border-green-800 dark:text-green-300",
    error:   "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300",
    warning: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300",
  };
  const Icon = toast.type === "success" ? CheckCircle : toast.type === "error" ? XCircle : AlertTriangle;
  return (
    <div className={`gov-slide-right flex items-start gap-2.5 px-4 py-3 rounded-lg border shadow-sm text-sm ${colors[toast.type]}`}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="flex-1">{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0" aria-label="Dismiss">
        <XCircle className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function SkeletonRow() { return <div className="h-11 bg-muted/40 rounded-lg animate-pulse" />; }

function PriorityBadge({ priority }: { priority: "high" | "medium" | "low" }) {
  const styles = {
    high:   "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800",
    medium: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800",
    low:    "bg-muted text-muted-foreground ring-1 ring-border",
  };
  return <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wide ${styles[priority]}`}>{priority}</span>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="gov-fade-in py-16 text-center space-y-3">
      <div className="w-12 h-12 bg-muted/60 rounded-xl flex items-center justify-center mx-auto">
        <ShieldCheck className="w-6 h-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold text-foreground">{message}</p>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="gov-fade-in flex items-center justify-between gap-3 px-4 py-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
      <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{message}</span></div>
      <Button size="sm" variant="ghost" onClick={onRetry} className="gov-btn-press h-7 text-xs text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 flex-shrink-0">
        <RefreshCw className="w-3 h-3 me-1" /> Retry
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "approved")
    return <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md capitalize bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800">approved</span>;
  if (s === "rejected" || s === "reject")
    return <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md capitalize bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800">rejected</span>;
  return <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md capitalize bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800">pending</span>;
}

function EyeBtn({ onClick, loading = false }: { onClick: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} title="View record"
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 bg-background text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40">
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
    </button>
  );
}
function PriceChangePill({ pct }: { pct: number }) {
    const isUp      = pct > 0;
    const isNeutral = Math.abs(pct) < 0.01;
    if (isNeutral) return null;
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded ${
        isUp
          ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
          : "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
      }`}>
        {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
      </span>
    );
  }

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, totalItems, pageSize, onPage }: {
  page: number; totalPages: number; totalItems: number; pageSize: number; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, totalItems);
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "…")[]>((acc, p, idx, arr) => {
      if (idx > 0 && typeof arr[idx - 1] === "number" && (p as number) - (arr[idx - 1] as number) > 1) acc.push("…");
      acc.push(p); return acc;
    }, []);
  return (
    <div className="flex items-center justify-between pt-3 border-t border-border mt-3">
      <p className="text-xs text-muted-foreground">{start}–{end} of {totalItems}</p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="gov-btn-press h-7 w-7 p-0" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="w-3.5 h-3.5" /></Button>
        {pageNumbers.map((p, idx) =>
          p === "…" ? <span key={`e-${idx}`} className="text-xs text-muted-foreground px-1">…</span>
          : <Button key={p} variant={p === page ? "default" : "ghost"} size="sm" className="gov-btn-press h-7 w-7 p-0 text-xs" onClick={() => onPage(p as number)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}>{p}</Button>
        )}
        <Button variant="ghost" size="sm" className="gov-btn-press h-7 w-7 p-0" disabled={page === totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}

// ─── PO PDF download ──────────────────────────────────────────────────────────

function downloadPOPdf(row: PurchaseHistoryRow, addToast: (type: ToastMessage["type"], message: string) => void) {
  const gross = row.gross_amount ?? row.quantity * row.unit_cost;
  const tax   = row.tax_amount ?? 0;
  const pay   = row.payable_amount ?? gross + tax;
  const html  = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>PO-${row.id}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;display:flex;justify-content:center;padding:40px 20px}.card{background:#fff;width:480px;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12)}.header{background:#1e3a5f;color:#f8fafc;padding:24px 28px}.header h1{font-size:20px;font-weight:700}.header p{font-size:12px;color:#94a3b8;margin-top:4px}.meta{display:flex;justify-content:space-between;margin-top:14px}.meta .id{font-size:13px;font-weight:600;color:#e2e8f0}.meta .status{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#16a34a22;color:#16a34a;border:1px solid #16a34a55}.section{padding:20px 28px;border-bottom:1px solid #f1f5f9}.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.item label{font-size:10px;color:#94a3b8;display:block;margin-bottom:2px}.item span{font-size:13px;font-weight:600;color:#1e293b}.line{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9}.line.total{font-size:15px;font-weight:700;color:#1e3a5f;padding-top:12px;margin-top:4px;border-top:2px solid #e2e8f0;border-bottom:none}.footer{padding:16px 28px;text-align:center;background:#f8fafc}.footer p{font-size:10px;color:#94a3b8}.print-btn{display:block;margin:0 auto 20px;padding:9px 22px;background:#1e3a5f;color:#fff;border:none;border-radius:7px;font-size:12px;cursor:pointer;font-family:inherit}@media print{.print-btn{display:none}body{background:#fff;padding:0}.card{box-shadow:none;width:100%;border-radius:0}@page{margin:0;size:A5}}</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<div class="card">
  <div class="header"><h1>Purchase Order</h1><p>STARK AI Enterprise Costing System</p>
    <div class="meta"><span class="id">PO #${row.id}</span><span class="status">${row.status.toUpperCase()}</span></div>
  </div>
  <div class="section"><div class="section-title">Details</div><div class="grid">
    <div class="item"><label>Branch</label><span>${row.branch_name ?? "—"}</span></div>
    <div class="item"><label>Supplier</label><span>${row.supplier_name ?? "—"}</span></div>
    <div class="item"><label>Item</label><span>${row.ingredient_name ?? "—"}</span></div>
    <div class="item"><label>Date</label><span>${String(row.entry_date).slice(0,10)}</span></div>
    <div class="item"><label>Quantity</label><span>${Number(row.quantity).toFixed(3)} ${row.unit ?? ""}</span></div>
    <div class="item"><label>Unit Cost</label><span>${Number(row.unit_cost).toFixed(2)}</span></div>
  </div></div>
  <div class="section"><div class="section-title">Amounts</div>
    <div class="line"><span>Gross Amount</span><span>${gross.toFixed(2)}</span></div>
    <div class="line"><span>Tax</span><span>${tax.toFixed(2)}</span></div>
    <div class="line total"><span>Total Payable</span><span>${pay.toFixed(2)}</span></div>
  </div>
  <div class="footer"><p>Generated ${new Date().toLocaleString()} · STARK AI</p></div>
</div></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `PO-${row.id}.html`;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); URL.revokeObjectURL(url);
  addToast("success", `PO #${row.id} downloaded.`);
}

// ─── New Expense Category Modal ───────────────────────────────────────────────

function NewExpenseCategoryModal({ onClose, onCreated }: {
  onClose:   () => void;
  onCreated: (cat: ExpenseCategory) => void;
}) {
  const [name,   setName]   = useState("");
  const [type,   setType]   = useState<CategoryType>("expense");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Category name is required"); return; }
    setSaving(true); setError(null);
    try {
      const data = await apiCall<ExpenseCategory>("/api/expense-categories", {
        method: "POST", body: JSON.stringify({ name: trimmed, type }),
      });
      onCreated(data); onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create category");
    } finally { setSaving(false); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter")  handleCreate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [name, type]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="gov-pop w-[340px] rounded-xl border border-border bg-background shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-cyan-500 dark:text-cyan-400">
            Expense Category
          </p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Close">
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-label */}
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs font-semibold text-cyan-500 dark:text-cyan-400 uppercase tracking-wider">New Category</p>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            placeholder="Category name..."
            className={`w-full h-10 px-3 rounded-lg border bg-muted/30 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-all ${
              error ? "border-red-500 focus:ring-red-500/30" : "border-input focus:ring-cyan-500/40 focus:border-cyan-500"
            }`}
          />
          {error && <p className="text-xs text-red-500 -mt-2">{error}</p>}

          {/* 2×2 type toggle grid */}
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_TYPES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setType(value)}
                className={`h-9 rounded-lg text-sm font-medium border transition-all gov-btn-press flex items-center justify-center gap-1.5 ${
                  type === value
                    ? "bg-orange-600 border-orange-500 text-white"
                    : "bg-muted/30 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
              >
                {type === value && <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 pb-4">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1 gov-btn-press h-9 text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="flex-1 gov-btn-press h-9 text-xs bg-blue-600 hover:bg-blue-700 text-white border-transparent"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <span className="mr-1">+</span>}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Category Selector ────────────────────────────────────────────────────────

function CategorySelector({ value, onChange, categories, onCategoryCreated, className = "" }: {
  value:             number | null;
  onChange:          (id: number | null) => void;
  categories:        ExpenseCategory[];
  onCategoryCreated: (cat: ExpenseCategory) => void;
  className?:        string;
}) {
  const [showModal, setShowModal] = useState(false);
  

  const grouped = useMemo(() => {
    const groups: Record<string, ExpenseCategory[]> = {};
    for (const cat of categories) {
      if (!groups[cat.type]) groups[cat.type] = [];
      groups[cat.type].push(cat);
    }
    return groups;
  }, [categories]);

  return (
    <>
      <div className={`flex gap-2 ${className}`}>
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          className="flex-1 h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— select category —</option>
          {Object.entries(grouped).map(([type, cats]) => (
            <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
        <Button
          variant="outline" size="sm"
          onClick={() => setShowModal(true)}
          className="gov-btn-press h-8 px-3 text-xs text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800 hover:bg-cyan-50 dark:hover:bg-cyan-950/30 whitespace-nowrap"
        >
          + New
        </Button>
      </div>

      {showModal && (
        <NewExpenseCategoryModal
          onClose={() => setShowModal(false)}
          onCreated={(cat) => { onCategoryCreated(cat); onChange(cat.id); }}
        />
      )}
    </>
  );
}

// ─── Governance History Tab ───────────────────────────────────────────────────

function GovernanceHistoryTab({ branchId, addToast }: {
  branchId: number;
  addToast: (type: ToastMessage["type"], message: string) => void;
}) {
  const [rows,         setRows]         = useState<GovernanceHistoryRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [search,       setSearch]       = useState("");
  const [filterAction, setFilterAction] = useState<"all" | "approve" | "reject">("all");
  const [filterSource, setFilterSource] = useState<"all" | "procurement" | "system">("all");
  const [page,         setPage]         = useState(1);

  const fetchHistory = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (branchId)               params.set("branch_id", String(branchId));
      if (filterAction !== "all") params.set("action", filterAction);
      const data = await apiCall<GovernanceHistoryRow[]>(`/api/governance/history?${params.toString()}`);
      setRows(Array.isArray(data) ? data : []); setPage(1);
    } catch (err: any) {
      const msg = err?.message ?? "Failed to load governance history";
      setError(msg); addToast("error", msg);
    } finally { setLoading(false); }
  }, [branchId, filterAction, addToast]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filtered = useMemo(() => {
    let result = [...rows];
    if (filterSource === "procurement") result = result.filter((r) => r.from_procurement);
    if (filterSource === "system")      result = result.filter((r) => !r.from_procurement);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) =>
        r.item_id.toLowerCase().includes(q) || (r.entity_type ?? "").toLowerCase().includes(q) ||
        (r.actor_name ?? "").toLowerCase().includes(q) || (r.submitted_by ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) || (r.supplier_name ?? "").toLowerCase().includes(q) ||
        (r.ingredient_name ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, filterSource, search]);

  useEffect(() => { setPage(1); }, [search, filterSource]);

  const totalPages       = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const pageItems        = useMemo(() => filtered.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE), [filtered, page]);
  const approvedCount    = useMemo(() => rows.filter((r) => r.action === "approve").length, [rows]);
  const rejectedCount    = useMemo(() => rows.filter((r) => r.action === "reject").length,  [rows]);
  const procurementCount = useMemo(() => rows.filter((r) => r.from_procurement).length,     [rows]);

  const handleExportCSV = useCallback(() => {
    const headers = ["ID","Item ID","Entity Type","Action","Actor","Submitted By","Supplier","Item","Date","Amount","Source"];
    const csvRows = filtered.map((r) => [r.id,r.item_id,r.entity_type,r.action,r.actor_name??"",r.submitted_by??"",r.supplier_name??"",r.ingredient_name??"",r.action_date,r.amount??"",r.from_procurement?"Procurement":"System"]);
    const csv     = [headers,...csvRows].map((row) => row.join(",")).join("\n");
    const blob    = new Blob([csv], { type: "text/csv" });
    const url     = URL.createObjectURL(blob);
    const link    = document.createElement("a");
    link.href = url; link.download = `governance-history-${new Date().toISOString().split("T")[0]}.csv`;
    link.click(); URL.revokeObjectURL(url);
    addToast("success", "Governance history exported.");
  }, [filtered, addToast]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Actions",    value: rows.length,      color: "text-foreground",                    icon: History      },
          { label: "Approved",         value: approvedCount,    color: "text-green-600 dark:text-green-400", icon: BadgeCheck   },
          { label: "Rejected",         value: rejectedCount,    color: "text-red-600 dark:text-red-400",     icon: Ban          },
          { label: "From Procurement", value: procurementCount, color: "text-blue-600 dark:text-blue-400",   icon: ShoppingCart },
        ].map((s, i) => (
          <Card key={s.label} className="gov-fade-in p-4" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <s.icon className="w-3.5 h-3.5 text-muted-foreground opacity-50" />
            </div>
            <p className={`text-2xl font-semibold mt-1 ${s.color}`}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : s.value}
            </p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            Governance Action Log
            <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filtered.length}</span>
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search history…"
                className="h-8 ps-8 pe-3 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-44" />
            </div>
            <select value={filterAction} onChange={(e) => setFilterAction(e.target.value as any)}
              className="h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="all">All Actions</option>
              <option value="approve">Approved</option>
              <option value="reject">Rejected</option>
            </select>
            <select value={filterSource} onChange={(e) => setFilterSource(e.target.value as any)}
              className="h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="all">All Sources</option>
              <option value="procurement">Procurement</option>
              <option value="system">System</option>
            </select>
            <Button variant="outline" size="sm" className="gov-btn-press h-8 text-xs" onClick={handleExportCSV} disabled={filtered.length === 0}>
              <Download className="w-3.5 h-3.5 me-1.5" /> Export
            </Button>
            <Button variant="outline" size="sm" className="gov-btn-press h-8 w-8 p-0" onClick={fetchHistory} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && <div className="mb-4"><ErrorBanner message={error} onRetry={fetchHistory} /></div>}

        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map((i) => <SkeletonRow key={i} />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState message="No governance actions recorded yet." />
        ) : (
          <>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["#","Item","Entity","Action","Actor","Submitted By","Supplier","Item/Ingredient","Date","Amount","Source","View"].map((h) => (
                      <th key={h} className="text-left text-[11px] font-semibold text-muted-foreground pb-2 px-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((row) => (
                    <tr key={row.id} className="gov-row-hover border-b border-border/50">
                      <td className="py-2.5 px-2 text-muted-foreground font-mono">{row.id}</td>
                      <td className="py-2.5 px-2 font-medium text-foreground">{row.item_id}</td>
                      <td className="py-2.5 px-2"><span className="bg-muted px-1.5 py-0.5 rounded text-[11px] text-muted-foreground capitalize">{row.entity_type}</span></td>
                      <td className="py-2.5 px-2"><StatusBadge status={row.action} /></td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <span className="truncate max-w-[100px]">{row.actor_name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-muted-foreground truncate max-w-[100px]">{row.submitted_by || "—"}</td>
                      <td className="py-2.5 px-2 text-muted-foreground truncate max-w-[100px]">{row.supplier_name || "—"}</td>
                      <td className="py-2.5 px-2 text-muted-foreground truncate max-w-[100px]">{row.ingredient_name || "—"}</td>
                      <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{formatDate(row.action_date)}</td>
                      <td className="py-2.5 px-2 text-right font-medium">{row.amount != null ? formatCurrency(row.amount, row.currency ?? undefined) : "—"}</td>
                      <td className="py-2.5 px-2">
                        {row.from_procurement
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded"><ShoppingCart className="w-2.5 h-2.5" /> PO</span>
                          : <span className="text-[10px] text-muted-foreground">System</span>}
                      </td>
                      <td className="py-2.5 px-2"><EyeBtn onClick={() => openGovernanceHistoryHtml(row)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={HISTORY_PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// ─── PO History Tab ───────────────────────────────────────────────────────────

function POHistoryTab({ branchId, addToast }: {
  branchId: number;
  addToast: (type: ToastMessage["type"], message: string) => void;
}) {
  const [rows,         setRows]         = useState<PurchaseHistoryRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "approved" | "pending" | "rejected">("all");
  const [page,         setPage]         = useState(1);

  const fetchPOs = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (branchId) params.set("branch_id", String(branchId));
      const data = await apiCall<PurchaseHistoryRow[]>(`/api/purchases?${params.toString()}`);
      setRows(Array.isArray(data) ? data : []); setPage(1);
    } catch (err: any) {
      const msg = err?.message ?? "Failed to load purchase orders";
      setError(msg); addToast("error", msg);
    } finally { setLoading(false); }
  }, [branchId, addToast]);

  useEffect(() => { fetchPOs(); }, [fetchPOs]);

  const filtered = useMemo(() => {
    let result = [...rows];
    if (filterStatus !== "all") result = result.filter((r) => r.status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((r) =>
        String(r.id).includes(q) || (r.ingredient_name ?? "").toLowerCase().includes(q) ||
        (r.supplier_name ?? "").toLowerCase().includes(q) || (r.branch_name ?? "").toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [rows, filterStatus, search]);

  useEffect(() => { setPage(1); }, [search, filterStatus]);

  const totalPages   = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const pageItems    = useMemo(() => filtered.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE), [filtered, page]);
  const totalGross   = useMemo(() => rows.reduce((s, r) => s + (r.gross_amount ?? r.quantity * r.unit_cost), 0), [rows]);
  const approvedRows = useMemo(() => rows.filter((r) => r.status === "approved"), [rows]);
  const pendingRows  = useMemo(() => rows.filter((r) => r.status === "pending"),  [rows]);

  const handleExportCSV = useCallback(() => {
    const headers = ["ID","Branch","Supplier","Ingredient","Unit","Date","Qty","Unit Cost","Gross Amount","Tax","Payable","Status"];
    const csvRows = filtered.map((r) => [r.id,r.branch_name,r.supplier_name,r.ingredient_name,r.unit,r.entry_date,r.quantity,r.unit_cost,r.gross_amount??"",r.tax_amount??"",r.payable_amount??"",r.status]);
    const csv     = [headers,...csvRows].map((row) => row.join(",")).join("\n");
    const blob    = new Blob([csv], { type: "text/csv" });
    const url     = URL.createObjectURL(blob);
    const link    = document.createElement("a");
    link.href = url; link.download = `purchase-orders-${new Date().toISOString().split("T")[0]}.csv`;
    link.click(); URL.revokeObjectURL(url);
    addToast("success", "Purchase orders exported.");
  }, [filtered, addToast]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total POs",   value: rows.length,                      color: "text-foreground",                    icon: Package,    isText: false },
          { label: "Approved",    value: approvedRows.length,               color: "text-green-600 dark:text-green-400", icon: BadgeCheck, isText: false },
          { label: "Pending",     value: pendingRows.length,                color: "text-amber-600 dark:text-amber-400", icon: Clock,      isText: false },
          { label: "Total Value", value: formatCurrency(totalGross) ?? "—", color: "text-blue-600 dark:text-blue-400",  icon: DollarSign, isText: true  },
        ].map((s, i) => (
          <Card key={s.label} className="gov-fade-in p-4" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <s.icon className="w-3.5 h-3.5 text-muted-foreground opacity-50" />
            </div>
            <p className={`font-semibold mt-1 ${s.isText ? "text-lg" : "text-2xl"} ${s.color}`}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : s.value}
            </p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            Purchase Order History
            <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filtered.length}</span>
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search POs…"
                className="h-8 ps-8 pe-3 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-44" />
            </div>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}
              className="h-8 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <Button variant="outline" size="sm" className="gov-btn-press h-8 text-xs" onClick={handleExportCSV} disabled={filtered.length === 0}>
              <Download className="w-3.5 h-3.5 me-1.5" /> Export
            </Button>
            <Button variant="outline" size="sm" className="gov-btn-press h-8 w-8 p-0" onClick={fetchPOs} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {error && <div className="mb-4"><ErrorBanner message={error} onRetry={fetchPOs} /></div>}

        {loading ? (
          <div className="space-y-2">{[1,2,3,4,5].map((i) => <SkeletonRow key={i} />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState message="No purchase orders found." />
        ) : (
          <>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      { h: "PO #", cls: "text-left" }, { h: "Branch", cls: "text-left" }, { h: "Supplier", cls: "text-left" },
                      { h: "Ingredient", cls: "text-left" }, { h: "Date", cls: "text-left" },
                      { h: "Qty", cls: "text-right" }, { h: "Unit Cost", cls: "text-right" },
                      { h: "Gross", cls: "text-right" }, { h: "Tax", cls: "text-right" }, { h: "Payable", cls: "text-right" },
                      { h: "Status", cls: "text-center" }, { h: "Actions", cls: "text-center" },
                    ].map(({ h, cls }) => (
                      <th key={h} scope="col" className={`px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${cls}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pageItems.map((row) => {
                    const gross = row.gross_amount ?? row.quantity * row.unit_cost;
                    return (
                      <tr key={row.id} className="hover:bg-muted/30 transition-colors group">
                        <td className="px-3 py-3 text-sm font-mono font-semibold text-foreground">PO-{String(row.id).padStart(5,"0")}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{row.branch_name}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{row.supplier_name}</td>
                        <td className="px-3 py-3 text-sm font-medium text-foreground">{row.ingredient_name}</td>
                        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateShort(row.entry_date)}</td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums text-muted-foreground">{formatNumber(row.quantity)} <span className="text-xs">{row.unit}</span></td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums text-muted-foreground">{formatNumber(row.unit_cost, 2)}</td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums font-semibold text-foreground">{formatNumber(gross, 2)}</td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums text-muted-foreground">{row.tax_amount != null ? formatNumber(row.tax_amount, 2) : "—"}</td>
                        <td className="px-3 py-3 text-sm text-right tabular-nums font-bold text-foreground">{row.payable_amount != null ? formatNumber(row.payable_amount, 2) : "—"}</td>
                        <td className="px-3 py-3 text-center"><StatusBadge status={row.status} /></td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <EyeBtn onClick={() => openPurchaseOrderHtml(row)} />
                            <button onClick={() => downloadPOPdf(row, addToast)} title={`Download PO-${String(row.id).padStart(5,"0")}`}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 bg-background text-muted-foreground hover:text-foreground hover:border-border transition-colors">
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td colSpan={7} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total ({filtered.length} records)</td>
                    <td className="px-3 py-2.5 text-right font-bold text-foreground tabular-nums text-sm">{formatNumber(filtered.reduce((s, r) => s + (r.gross_amount ?? r.quantity * r.unit_cost), 0), 2)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums text-xs">{formatNumber(filtered.reduce((s, r) => s + (r.tax_amount ?? 0), 0), 2)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-foreground tabular-nums text-sm">{formatNumber(filtered.reduce((s, r) => s + (r.payable_amount ?? 0), 0), 2)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={HISTORY_PAGE_SIZE} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Governance() {
  const { t }         = useLanguage();
  const currentUserId = Number(localStorage.getItem("user_id") ?? 1);
  const branchId      = Number(localStorage.getItem("branch_id") ?? 0);
  const todayStr      = new Date().toISOString().split("T")[0];
  const currentMonth  = todayStr.slice(0, 7);

  // ── State ─────────────────────────────────────────────────────────────────

  const [activeTab,        setActiveTab]        = useState<ActiveTab>("approvals");
  const [toasts,           setToasts]           = useState<ToastMessage[]>([]);
  const [approvals,        setApprovals]        = useState<ApprovalItem[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError,   setApprovalsError]   = useState<string | null>(null);
  const [loadingIds,       setLoadingIds]       = useState<Set<string>>(new Set());
  const [search,           setSearch]           = useState("");
  const [filterType,       setFilterType]       = useState<string>("all");
  const [filterStatus,     setFilterStatus]     = useState<ApprovalStatus | "all">("pending");
  const [sortField,        setSortField]        = useState<SortField>("date");
  const [sortDir,          setSortDir]          = useState<SortDir>("desc");
  const [showFilters,      setShowFilters]      = useState(false);
  const [page,             setPage]             = useState(1);
  const [confirmAction,    setConfirmAction]    = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [newPOCount,       setNewPOCount]       = useState(0);
  const [periodClosed,     setPeriodClosed]     = useState(false);
  const [periodLoading,    setPeriodLoading]    = useState(true);
  const [periodError,      setPeriodError]      = useState<string | null>(null);
  const [closingPeriod,    setClosingPeriod]    = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // ── Expense categories (for CategorySelector) ─────────────────────────────
  // ── Toast helpers ─────────────────────────────────────────────────────────

  const addToast = useCallback((type: ToastMessage["type"], message: string) => {
    setToasts((prev) => [...prev.slice(-4), { id: generateToastId(), type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Fetch approvals ───────────────────────────────────────────────────────

  const fetchApprovals = useCallback(async () => {
    setApprovalsLoading(true); setApprovalsError(null);
    try {
      const data = await apiCall<any[]>("/api/approvals/pending");
      const serverItems: ApprovalItem[] = (Array.isArray(data) ? data : []).map((row) => {
        const typeKey = toTypeKey(row);
        const desc    = row.entity_type === "purchase"
          ? [row.ingredient_name, row.supplier_name, row.branch_name,
              row.quantity  != null ? `Qty: ${row.quantity} ${row.unit ?? ""}` : null,
              row.unit_cost != null ? `@ ${Number(row.unit_cost).toFixed(2)} ${row.currency ?? ""}`.trim() : null,
            ].filter(Boolean).join(" · ")
          : row.entity_type === "price_history"
          ? [
              row.ingredient_name ? `${row.ingredient_name}` : null,
              row.supplier_name   ? `from ${row.supplier_name}` : null,
              row.unit_cost != null ? `@ ${Number(row.unit_cost).toFixed(2)}` : null,
              row.price_type ? row.price_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : null
            ].filter(Boolean).join(" · ")
          : String(row.description ?? row.notes ?? "");
        return {
          id:              String(row.id),
          purchaseId:      row.entity_type === "purchase" ? Number(row.entity_id) : undefined,
          typeKey, desc,
          submitted_by:    String(row.submitted_by ?? row.requested_by_name ?? ""),
          date:            String(row.requested_at  ?? row.entry_date ?? ""),
          status:          normalizeStatus(row.status),
          amount: row.entity_type === "price_history"
          ? (row.unit_cost != null ? Number(row.unit_cost) : undefined)
          : row.payable_amount != null ? Number(row.payable_amount) : row.amount != null ? Number(row.amount) : undefined,
          currency:        row.currency ?? undefined,
          priority:        toPriority(row),
          fromProcurement: typeKey === "gov.approvalType.purchase",
          ingredientName:  row.ingredient_name ?? undefined,
          supplierName:    row.supplier_name   ?? undefined,
          priceType:       row.price_type
            ? row.price_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
            : undefined,
          previousCost:   row.previous_price != null ? Number(row.previous_price) : undefined,
          priceChangePct: row.previous_price != null && row.unit_cost != null && Number(row.previous_price) > 0
            ? ((Number(row.unit_cost) - Number(row.previous_price)) / Number(row.previous_price)) * 100
            : undefined,
        };
      });
      setApprovals(serverItems); setPage(1);
    } catch (err: any) {
      const msg = err?.message ?? t("gov.error.fetchApprovals");
      setApprovalsError(msg); addToast("error", msg);
    } finally { setApprovalsLoading(false); }
  }, [addToast, t]);

  useEffect(() => {
    function handleNewPO(event: Event) {
      const po = (event as CustomEvent).detail;
      if (!po) return;
      setNewPOCount((c) => c + 1);
      addToast("warning", `New PO #${po.id} added to approval queue.`);
      fetchApprovals();
    }
    window.addEventListener(PROCUREMENT_PO_EVENT, handleNewPO);
    return () => window.removeEventListener(PROCUREMENT_PO_EVENT, handleNewPO);
  }, [addToast, fetchApprovals]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  // ── Approve / Reject ──────────────────────────────────────────────────────

  const handleAction = useCallback(async (id: string, action: "approve" | "reject") => {
    setConfirmAction(null);
    setLoadingIds((prev) => new Set(prev).add(id));
    const newStatus: ApprovalStatus = action === "approve" ? "approved" : "rejected";
    setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)));
    try {
      await apiCall(`/api/approvals/${id}/${action}`, { method: "POST", body: JSON.stringify({ user_id: currentUserId }) });
      addToast("success", action === "approve" ? t("gov.toast.approved") : t("gov.toast.rejected"));
      fetchApprovals();
    } catch (err: any) {
      setApprovals((prev) => prev.map((a) => (a.id === id ? { ...a, status: "pending" } : a)));
      addToast("error", err?.message ?? t("gov.error.action"));
    } finally {
      setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [currentUserId, addToast, t, fetchApprovals]);

  // ── Bulk approve ──────────────────────────────────────────────────────────

  // ── Period closure ────────────────────────────────────────────────────────

  const fetchPeriodStatus = useCallback(async () => {
    if (!branchId) { setPeriodLoading(false); return; }
    setPeriodLoading(true); setPeriodError(null);
    try {
      const data = await apiCall<{ is_closed: boolean }>(`/api/period/is-closed?branch_id=${branchId}&entry_date=${todayStr}`);
      setPeriodClosed(data?.is_closed ?? false);
    } catch (err: any) { setPeriodError(err?.message ?? t("gov.error.fetchPeriod")); }
    finally { setPeriodLoading(false); }
  }, [branchId, todayStr, t]);

  useEffect(() => { fetchPeriodStatus(); }, [fetchPeriodStatus]);

  const handleClosePeriod = useCallback(async () => {
    if (!branchId) return;
    setShowCloseConfirm(false); setClosingPeriod(true);
    try {
      await apiCall("/api/period/close", { method: "POST", body: JSON.stringify({ branch_id: branchId, closed_to: todayStr, notes: "", user_id: currentUserId }) });
      await fetchPeriodStatus();
      addToast("success", t("gov.toast.periodClosed"));
    } catch (err: any) { addToast("error", err?.message ?? t("gov.error.closePeriod")); }
    finally { setClosingPeriod(false); }
  }, [branchId, todayStr, currentUserId, fetchPeriodStatus, addToast, t]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const pendingCount   = useMemo(() => approvals.filter((a) => a.status === "pending").length,   [approvals]);
  const approvedCount  = useMemo(() => approvals.filter((a) => a.status === "approved").length,  [approvals]);
  const rejectedCount  = useMemo(() => approvals.filter((a) => a.status === "rejected").length,  [approvals]);
  const pendingPOCount = useMemo(() => approvals.filter((a) => a.status === "pending" && a.fromProcurement).length, [approvals]);
  const typeOptions    = useMemo(() => Array.from(new Set(approvals.map((a) => a.typeKey))), [approvals]);
  const openPeriods    = periodLoading ? "…" : periodClosed ? "0" : "1";
  const priceAlertCount = useMemo(
  () => approvals.filter((a) => a.typeKey === "gov.approvalType.priceHistory" && a.status === "pending").length,
  [approvals]
  );

  const filteredAndSorted = useMemo(() => {
    let result = [...approvals];
    if (filterStatus !== "all") result = result.filter((a) => a.status === filterStatus);
    if (filterType   !== "all") result = result.filter((a) => a.typeKey === filterType);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((a) => a.id.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q) || a.submitted_by.toLowerCase().includes(q) || t(a.typeKey).toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      let va: string, vb: string;
      if (sortField === "date")     { va = a.date; vb = b.date; }
      else if (sortField === "priority") { const o = { high: 0, medium: 1, low: 2 }; va = String(o[a.priority ?? "medium"]); vb = String(o[b.priority ?? "medium"]); }
      else { va = (a as any)[sortField] ?? ""; vb = (b as any)[sortField] ?? ""; }
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return result;
  }, [approvals, filterStatus, filterType, search, sortField, sortDir, t]);

  useEffect(() => { setPage(1); }, [search, filterStatus, filterType, sortField, sortDir]);

  const totalPages       = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const currentPageItems = useMemo(() => filteredAndSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredAndSorted, page]);

  const byType = useMemo(() => {
    const groups: Record<string, { pending: number; approved: number }> = {};
    for (const a of approvals) {
      if (!groups[a.typeKey]) groups[a.typeKey] = { pending: 0, approved: 0 };
      if (a.status === "pending")  groups[a.typeKey].pending++;
      if (a.status === "approved") groups[a.typeKey].approved++;
    }
    return groups;
  }, [approvals]);

  const approvalStatusRows = useMemo(() =>
    [
      "gov.approvalType.priceHistory",
      "gov.approvalType.purchase",
      "gov.approvalType.expense",
      "gov.approvalType.stockAdj",
      "gov.approvalType.transfer",
    ].map((k) => ({
      typeKey: k, pending: byType[k]?.pending ?? 0, approved: byType[k]?.approved ?? 0,
    })), [byType]);
  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  // ── Export CSV ────────────────────────────────────────────────────────────

  const handleExportCSV = useCallback(() => {
    const headers = ["ID","Type","Description","Submitted By","Date","Status","Priority","Source"];
    const rows    = filteredAndSorted.map((a) => [a.id,t(a.typeKey),`"${a.desc.replace(/"/g,'""')}"`,a.submitted_by,a.date,a.status,a.priority??"medium",a.fromProcurement?"Procurement":"System"]);
    const csv     = [headers,...rows].map((r) => r.join(",")).join("\n");
    const blob    = new Blob([csv], { type: "text/csv" });
    const url     = URL.createObjectURL(blob);
    const link    = document.createElement("a");
    link.href = url; link.download = `approvals-${todayStr}.csv`;
    link.click(); URL.revokeObjectURL(url);
    addToast("success", t("gov.toast.exported"));
  }, [filteredAndSorted, t, todayStr, addToast]);

  // ── Tab definitions ───────────────────────────────────────────────────────
  
  const tabs: { id: ActiveTab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "approvals",   label: "Approvals",         icon: ShieldCheck, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: "gov-history", label: "Governance History", icon: History },
    { id: "po-history",  label: "Purchase Orders",    icon: Package },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────


  return (
    <>
      {/* Toast container */}
      <div className="fixed bottom-4 end-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto"><Toast toast={toast} onDismiss={dismissToast} /></div>
        ))}
      </div>

      {/* Approve / Reject confirm modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="gov-pop bg-background border border-border rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${confirmAction.action === "approve" ? "bg-green-100 dark:bg-green-950/50" : "bg-red-100 dark:bg-red-950/50"}`}>
                {confirmAction.action === "approve" ? <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" /> : <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{confirmAction.action === "approve" ? t("gov.confirm.approveTitle") : t("gov.confirm.rejectTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("gov.confirm.subtitle")} #{confirmAction.id}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{confirmAction.action === "approve" ? t("gov.confirm.approveBody") : t("gov.confirm.rejectBody")}</p>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setConfirmAction(null)} className="gov-btn-press text-xs">{t("gov.confirm.cancel")}</Button>
              <Button size="sm" onClick={() => handleAction(confirmAction.id, confirmAction.action)}
                className={`gov-btn-press gov-ripple text-xs text-white ${confirmAction.action === "approve" ? "bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600" : "bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"}`}>
                {confirmAction.action === "approve" ? t("gov.confirm.approve") : t("gov.confirm.reject")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Period close confirm */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="gov-pop bg-background border border-border rounded-xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-950/50">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t("gov.period.confirmTitle")}</p>
                <p className="text-xs text-muted-foreground">{currentMonth}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{t("gov.period.confirmBody")}</p>
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {t("gov.period.pendingWarning").replace("{count}", String(pendingCount))}
              </div>
            )}
            {pendingPOCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-400">
                <ShoppingCart className="w-3.5 h-3.5 flex-shrink-0" />
                {pendingPOCount} unapproved Purchase Order{pendingPOCount !== 1 ? "s" : ""} from Procurement.
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowCloseConfirm(false)} className="gov-btn-press text-xs">{t("gov.confirm.cancel")}</Button>
              <Button size="sm" onClick={handleClosePeriod} className="gov-btn-press gov-ripple text-xs bg-amber-600 hover:bg-amber-700 text-white">{t("gov.period.close")}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t("gov.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("gov.subtitle")}</p>
          </div>
          {activeTab === "approvals" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={approvalsLoading || approvals.length === 0} className="gov-btn-press text-xs">
                <Download className="w-3.5 h-3.5 me-1.5" />{t("gov.action.export")}
              </Button>
              <Button variant="outline" size="sm" onClick={fetchApprovals} disabled={approvalsLoading} className="gov-btn-press">
                <RefreshCw className={`w-4 h-4 ${approvalsLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 border-b border-border">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none ${activeTab === tab.id ? "text-foreground border-b-2 border-foreground -mb-px" : "text-muted-foreground hover:text-foreground"}`}>
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.badge != null && tab.badge > 0 && (
                <span className="text-[10px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* New PO banner */}
        {activeTab === "approvals" && newPOCount > 0 && (
          <div className="gov-fade-in flex items-center gap-3 px-4 py-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-sm text-blue-800 dark:text-blue-300">
            <ShoppingCart className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1"><strong>{newPOCount} new Purchase Order{newPOCount !== 1 ? "s" : ""}</strong> added from Procurement this session — review and approve before closing the period.</span>
            <button onClick={() => { setFilterType("gov.approvalType.purchase"); setFilterStatus("pending"); setNewPOCount(0); }} className="text-xs underline underline-offset-2 hover:no-underline whitespace-nowrap">View POs</button>
          </div>
        )}

        {/* Sub-tabs */}
        {activeTab === "gov-history" && <GovernanceHistoryTab branchId={branchId} addToast={addToast} />}
        {activeTab === "po-history"  && <POHistoryTab         branchId={branchId} addToast={addToast} />}

        {/* Approvals tab */}
        {activeTab === "approvals" && (
          <>
            {/* Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: t("gov.metric.pendingApprovals"),  value: pendingCount,    color: "text-amber-500 dark:text-amber-400",   icon: Clock,        sub: t("gov.metric.pendingApprovalsSub")  },
                { label: t("gov.metric.approvedThisMonth"), value: approvedCount,   color: "text-green-600 dark:text-green-400",   icon: CheckCircle,  sub: t("gov.metric.approvedThisMonthSub") },
                { label: t("gov.metric.rejected"),          value: rejectedCount,   color: "text-red-600 dark:text-red-400",       icon: XCircle,      sub: t("gov.metric.rejectedSub")          },
                { label: "Price Alerts",                    value: priceAlertCount, color: "text-orange-600 dark:text-orange-400", icon: TrendingUp,   sub: "Pending price changes"              },
                { label: t("gov.metric.openPeriods"),       value: openPeriods,     color: "text-foreground",                      icon: Calendar,     sub: periodClosed ? t("gov.metric.openPeriodsClosed") : t("gov.metric.openPeriodsSub") },
              ].map((s, i) => (
                <Card key={s.label} className="gov-fade-in p-5" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="flex items-start justify-between">
                    <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                    <s.icon className="w-3.5 h-3.5 text-muted-foreground opacity-50" />
                  </div>
                  <p className={`text-3xl font-semibold mt-1.5 ${s.color}`}>
                    {approvalsLoading || (s.label === t("gov.metric.openPeriods") && periodLoading)
                      ? <Loader2 className="w-6 h-6 animate-spin" />
                      : s.value}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
                </Card>
              ))}
            </div>
            {/* Approval status + quick actions */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="lg:col-span-2 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-foreground">{t("gov.approvalStatus.title")}</h2>
                  <TrendingUp className="w-4 h-4 text-muted-foreground opacity-60" />
                </div>
                {approvalsLoading ? (
                  <div className="space-y-5">{[1,2,3,4].map((i) => <div key={i} className="h-8 bg-muted rounded animate-pulse" />)}</div>
                ) : (
                  <div className="space-y-4">
                    {approvalStatusRows.map((s) => {
                      const total = s.approved + s.pending;
                      const pct   = total > 0 ? Math.round((s.approved / total) * 100) : 0;
                      return (
                        <div key={s.typeKey}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium text-foreground">{t(s.typeKey)}</p>
                              {s.typeKey === "gov.approvalType.purchase" && pendingPOCount > 0 && (
                                <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <ShoppingCart className="w-2.5 h-2.5" />{pendingPOCount} from Procurement
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {s.pending > 0 && <span className="text-[11px] bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded">{s.pending} {t("gov.approvalStatus.pending")}</span>}
                              <span className="text-[11px] text-muted-foreground">{pct}%</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 dark:bg-green-400 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-foreground whitespace-nowrap">{s.approved} {t("gov.approvalStatus.approved")}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="text-sm font-semibold text-foreground mb-3">Review controls</h2>
                <div className="space-y-2">
                  {pendingPOCount > 0 && (
                    <Button variant="outline" size="sm" onClick={() => { setFilterType("gov.approvalType.purchase"); setFilterStatus("pending"); }}
                      className="w-full justify-start text-xs h-9">
                      <ShoppingCart className="w-3.5 h-3.5 me-2" />Purchase orders awaiting review
                    </Button>
                  )}
                  {priceAlertCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFilterType("gov.approvalType.priceHistory");
                        setFilterStatus("pending");
                      }}
                      className="w-full justify-start text-xs h-9"
                    >
                      <TrendingUp className="w-3.5 h-3.5 me-2" />
                      Price changes awaiting review
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={fetchApprovals} disabled={approvalsLoading} className="w-full justify-start text-xs h-9">
                    <RefreshCw className={`w-3.5 h-3.5 me-2 ${approvalsLoading ? "animate-spin" : ""}`} />Refresh queue
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={approvals.length === 0} className="w-full justify-start text-xs h-9">
                    <Download className="w-3.5 h-3.5 me-2" />Export current view
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab("gov-history")} className="w-full justify-start text-xs h-9 text-muted-foreground">
                    <History className="w-3.5 h-3.5 me-2" />Governance history
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab("po-history")} className="w-full justify-start text-xs h-9 text-muted-foreground">
                    <Package className="w-3.5 h-3.5 me-2" />Purchase order history
                  </Button>
                </div>

                {/* ── Expense Category Selector ── */}
                <div className="mt-5 pt-4 border-t border-border space-y-2">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Workload summary</p>
                  {[
                    { label: t("gov.summary.total"),    value: approvals.length, color: "text-foreground" },
                    { label: t("gov.summary.pending"),  value: pendingCount,     color: "text-amber-600 dark:text-amber-400" },
                    { label: "From Procurement",         value: pendingPOCount,   color: "text-blue-600 dark:text-blue-400" },
                    { label: t("gov.summary.approved"), value: approvedCount,    color: "text-green-600 dark:text-green-400" },
                    { label: t("gov.summary.rejected"), value: rejectedCount,    color: "text-red-600 dark:text-red-400" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{s.label}</span>
                      <span className={`text-xs font-semibold ${s.color}`}>{s.value}</span>
                    </div>
                  ))}
                </div>

                {false && (
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">Keyboard: </span>
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">↑↓</kbd> navigate ·{" "}
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">A</kbd> approve ·{" "}
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">R</kbd> reject ·{" "}
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Esc</kbd> clear
                    </p>
                  </div>
                )}
              </Card>
            </div>

            {/* Approvals list */}
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("gov.pending.title")}
                  {pendingCount > 0 && <span className="ms-2 text-xs font-normal text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full">{pendingCount}</span>}
                  {pendingPOCount > 0 && <span className="ms-1.5 text-xs font-normal text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">{pendingPOCount} PO</span>}
                </h2>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("gov.search.placeholder")}
                      className="h-8 ps-8 pe-3 text-xs rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-44 transition-shadow focus:shadow-sm" />
                  </div>
                  <Button variant="outline" size="sm" className="gov-btn-press h-8 text-xs px-2.5" onClick={() => setShowFilters((v) => !v)}>
                    <Filter className="w-3.5 h-3.5 me-1" />{t("gov.action.filter")}
                    {showFilters ? <ChevronUp className="w-3 h-3 ms-1" /> : <ChevronDown className="w-3 h-3 ms-1" />}
                  </Button>
                </div>
              </div>

              {showFilters && (
                <div className="gov-fade-in flex items-center gap-3 mb-4 pb-4 border-b border-border flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">{t("gov.filter.status")}:</label>
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as ApprovalStatus | "all")}
                      className="h-7 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="all">{t("gov.filter.all")}</option>
                      <option value="pending">{t("gov.filter.pending")}</option>
                      <option value="approved">{t("gov.filter.approved")}</option>
                      <option value="rejected">{t("gov.filter.rejected")}</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">{t("gov.filter.type")}:</label>
                    <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
                      className="h-7 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="all">{t("gov.filter.all")}</option>
                      {typeOptions.map((k) => <option key={k} value={k}>{t(k)}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">{t("gov.filter.sortBy")}:</label>
                    <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)}
                      className="h-7 px-2 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="date">{t("gov.sort.date")}</option>
                      <option value="typeKey">{t("gov.sort.type")}</option>
                      <option value="submitted_by">{t("gov.sort.submittedBy")}</option>
                      <option value="priority">{t("gov.sort.priority")}</option>
                    </select>
                    <Button variant="ghost" size="sm" className="gov-btn-press h-7 w-7 p-0" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
                      {sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  <span className="text-xs text-muted-foreground ms-auto">{filteredAndSorted.length} {t("gov.filter.results")}</span>
                </div>
              )}

              {approvalsError && <div className="mb-4"><ErrorBanner message={approvalsError} onRetry={fetchApprovals} /></div>}

              {approvalsLoading ? (
                <div className="space-y-2">{[1,2,3].map((i) => <SkeletonRow key={i} />)}</div>
              ) : filteredAndSorted.length === 0 ? (
                <EmptyState message={t("gov.pending.allReviewed")} />
              ) : (
                <>
                  <div className="space-y-2">
                    {currentPageItems.map((a) => {
                      const isLoading       = loadingIds.has(a.id);
                      const formattedAmount = formatCurrency(a.amount, a.currency);
                      const formattedDate   = formatDate(a.date);
                      if (a.status !== "pending") {
                        return (
                          <div key={a.id} className="gov-fade-in flex items-center gap-2 px-4 py-2.5 bg-muted/30 border border-border rounded-md opacity-60">
                            {a.status === "approved"
                              ? <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                              : <XCircle    className="w-3.5 h-3.5 text-red-500   flex-shrink-0" />}

                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-muted-foreground">{t(a.typeKey)}</span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {a.fromProcurement && a.purchaseId
                                  ? `PO-${String(a.purchaseId).padStart(5, "0")}`
                                  : `#${a.id}`}
                              </span>

                              {/* Price history inline summary */}
                              {a.typeKey === "gov.approvalType.priceHistory" ? (
                                <>
                                  {a.ingredientName && (
                                    <span className="text-xs text-muted-foreground font-medium truncate">
                                      {a.ingredientName}
                                    </span>
                                  )}
                                  {a.supplierName && (
                                    <span className="text-xs text-muted-foreground truncate">
                                      from {a.supplierName}
                                    </span>
                                  )}
                                  {a.priceType && (
                                    <span className="text-[10px] bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 px-1.5 py-0.5 rounded">
                                      {a.priceType}
                                    </span>
                                  )}
                                  {a.previousCost != null && (
                                    <span className="text-[11px] text-muted-foreground line-through">
                                      {formatCurrency(a.previousCost, a.currency)}
                                    </span>
                                  )}
                                  {a.priceChangePct != null && (
                                    <PriceChangePill pct={a.priceChangePct} />
                                  )}
                                </>
                              ) : (
                                a.desc && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    — {a.desc}
                                  </span>
                                )
                              )}
                            </div>

                            {/* Source badges */}
                            {a.fromProcurement && (
                              <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded flex items-center gap-0.5 flex-shrink-0">
                                <ShoppingCart className="w-2.5 h-2.5" /> PO
                              </span>
                            )}
                            {a.typeKey === "gov.approvalType.priceHistory" && (
                              <span className="text-[10px] font-medium text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded flex items-center gap-0.5 flex-shrink-0">
                                <TrendingUp className="w-2.5 h-2.5" /> Price
                              </span>
                            )}

                            <EyeBtn onClick={() => openApprovalHtml(a, t)} />
                            <span className={`text-xs font-semibold flex-shrink-0 ${
                              a.status === "approved"
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}>
                              {a.status === "approved" ? t("gov.pending.approved") : t("gov.pending.rejected")}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div key={a.id}
                          className="flex items-center justify-between px-4 py-3 border border-border rounded-md gap-3 bg-card hover:bg-muted/30 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.fromProcurement ? "bg-blue-500 dark:bg-blue-400" : "bg-amber-500 dark:bg-amber-400"}`} />
                              <p className="text-sm font-medium text-foreground">{t(a.typeKey)}</p>
                              <span className="text-xs text-muted-foreground font-mono">{a.fromProcurement && a.purchaseId ? `PO-${String(a.purchaseId).padStart(5,"0")}` : `#${a.id}`}</span>
                              {a.fromProcurement && (
                                <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <ShoppingCart className="w-2.5 h-2.5" /> Procurement
                                </span>
                              )}
                              {a.priority && <PriorityBadge priority={a.priority} />}
                              {formattedAmount && <span className="text-xs font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">{formattedAmount}</span>}
                            </div>
                            {a.typeKey === "gov.approvalType.priceHistory" ? (
                              <div className="flex items-center gap-2 mt-0.5 ms-3.5 flex-wrap">
                                {a.ingredientName && (
                                  <span className="text-xs text-foreground font-medium">{a.ingredientName}</span>
                                )}
                                {a.supplierName && (
                                  <span className="text-xs text-muted-foreground">from {a.supplierName}</span>
                                )}
                                {a.priceType && (
                                  <span className="text-[11px] bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 px-1.5 py-0.5 rounded">
                                    {a.priceType}
                                  </span>
                                )}
                                {a.amount != null && (
                                  <span className="text-xs font-semibold text-foreground">
                                    {formatCurrency(a.amount, a.currency)}
                                  </span>
                                )}
                                {a.previousCost != null && (
                                  <span className="text-[11px] text-muted-foreground line-through">
                                    {formatCurrency(a.previousCost, a.currency)}
                                  </span>
                                )}
                                {a.priceChangePct != null && (
                                  <PriceChangePill pct={a.priceChangePct} />
                                )}
                                </div>
                            ) : (
                              a.desc && <p className="text-xs text-muted-foreground mt-0.5 ms-3.5 line-clamp-1">{a.desc}</p>
                            )}
                            <p className="text-[11px] text-muted-foreground mt-0.5 ms-3.5">
                              {a.submitted_by ? `${t("gov.pending.submittedBy")} ${a.submitted_by} · ` : ""}{formattedDate}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <EyeBtn onClick={(e?: any) => { e?.stopPropagation?.(); openApprovalHtml(a, t); }} />
                            <Button size="sm" variant="outline" disabled={isLoading}
                              onClick={(e) => { e.stopPropagation(); setConfirmAction({ id: a.id, action: "reject" }); }}
                              className="gov-btn-press gov-ripple h-7 text-xs px-3 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300">
                              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : t("gov.pending.reject")}
                            </Button>
                            <Button size="sm" disabled={isLoading}
                              onClick={(e) => { e.stopPropagation(); setConfirmAction({ id: a.id, action: "approve" }); }}
                              className="gov-btn-press gov-ripple h-7 text-xs px-3 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white">
                              {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : t("gov.pending.approve")}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Pagination page={page} totalPages={totalPages} totalItems={filteredAndSorted.length} pageSize={PAGE_SIZE}
                    onPage={setPage} />
                </>
              )}
            </Card>

            {/* Period banner */}
            <Card className={`p-5 border-s-2 rounded-s-none transition-colors ${periodClosed ? "border-s-muted-foreground/40" : "border-s-primary"}`}>
              {periodError && <div className="mb-3"><ErrorBanner message={periodError} onRetry={fetchPeriodStatus} /></div>}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {periodLoading ? "…" : periodClosed ? t("gov.period.closed") : `${t("gov.period.current")}: ${currentMonth}`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{periodClosed ? t("gov.period.closedNote") : t("gov.period.note")}</p>
                  {!branchId && !periodLoading && <p className="text-xs text-red-500 dark:text-red-400 mt-1">{t("gov.period.noBranch")}</p>}
                </div>
                {periodClosed ? (
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-3 py-1.5 rounded-md flex-shrink-0">🔒 {t("gov.period.closedBadge")}</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={closingPeriod || periodLoading || !branchId} onClick={() => setShowCloseConfirm(true)} className="gov-btn-press flex-shrink-0 text-xs">
                    {closingPeriod && <Loader2 className="w-3 h-3 animate-spin me-1" />}
                    {t("gov.period.close")}
                  </Button>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
