/**
 * Procurement.tsx — STARK AI Costing
 * Enterprise Purchase Order & Returns Management
 * Tabs: Standard POs · Cash Purchases · Petty Cash · Invoices · PO Fulfillment
 */

import { PROCUREMENT_PO_EVENT } from "./Governance";

import {
  useState, useMemo, useEffect, useCallback,
  useReducer, useRef,
} from "react";
import { Card }   from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, X, Loader2, AlertCircle, RefreshCw,
  ShoppingCart, RotateCcw, TrendingUp, Package,
  FileDown, Filter, ChevronRight, ArrowUpRight,
  ArrowDownRight, Lock, Wallet, Banknote, Receipt,
  Upload, FileText, Eye, Download, Zap, Check,
  ClipboardList, CheckCircle, XCircle, Clock,
} from "lucide-react";
import { useApi }         from "@/hooks/useApi";
import { getBranches, getSuppliers, addPurchase, apiCall, getPeriodStatus } from "@/lib/api";
import type { PeriodStatusRow } from "@/lib/api";
import { useLanguage }    from "@/contexts/LanguageContext";
import { formatCurrency as formatCurrencyValue, getCurrencyLabel } from "@/lib/localization";

// ─── Domain types ─────────────────────────────────────────────────────────────

type PurchaseStatus  = "pending" | "approved" | "rejected";
type PurchaseType    = "branch_cash" | "emergency";
type PurchaseMode    = "ingredient" | "expense";
type TabKey          = "po" | "cash" | "petty" | "invoices" | "fulfillment";
type InvoiceRefTable = "cash_purchases" | "expenses" | "inventory_movements";
type CategoryType    = "inventory" | "expense" | "asset" | "service";

interface Purchase {
  id: number;
  branch_id: number;      branch_name?: string;
  supplier_id: number;    supplier_name?: string;
  ingredient_id?: number; ingredient_name?: string;
  item_name?: string;     item_id?: number;
  entry_date: string;
  quantity: number;       unit_cost: number;
  tax_amount: number;     payable_amount: number;
  gross_amount: number;   notes: string;
  status: PurchaseStatus;
}

interface CashPurchase {
  id: number;
  branch_id: number;      branch_name?: string;
  supplier_id?: number;   supplier_name?: string;
  ingredient_id?: number; ingredient_name?: string;
  category_id?: number;   category_name?: string;
  category_type?: string;
  purchase_type: PurchaseType;
  entry_date: string;
  quantity: number;       unit_cost: number;
  gross_amount: number;   tax_amount: number;
  payable_amount: number; petty_cash_used: boolean;
  status: PurchaseStatus; notes: string;
}

interface PettyCashEntry {
  id: number;
  branch_id: number;      branch_name?: string;
  entry_date: string;
  txn_type: "top_up" | "spend" | "adjustment";
  amount: number;         balance_after: number;
  ref_table?: string;     ref_id?: number;
  notes: string;
}

interface Invoice {
  id: number;
  file_name: string;      mime_type: string;
  file_size_kb: number;   notes: string;
  uploaded_at: string;
  invoice_number?: string;
  invoice_date?: string;
  amount?: number;
  supplier_name?: string;
  branch_name?: string;
  ref_table?: InvoiceRefTable | string;
}

interface FulfillmentRow {
  po_id: number;
  po_date: string;
  branch_id: number;
  branch_name: string;
  supplier_id: number;
  supplier_name: string;
  ingredient_id: number;
  ingredient_name: string;
  unit: string;
  po_qty: number;
  po_unit_cost: number;
  po_value: number;
  total_received: number;
  pending_qty: number;
  grn_count: number;
  last_grn_date: string | null;
  fulfillment_status: "not_received" | "partially_received" | "fully_received";
  avg_grn_unit_cost: number;
  cost_variance: number;
  cost_variance_pct: number;
}

interface Branch          { id: number; name: string; }
interface Supplier        { id: number; name: string; phone?: string; }
interface Ingredient      { id: number; name: string; unit: string; }
interface ExpenseCategory { id: number; name: string; type: string; }

type ModalType = "purchase" | "return" | "cash" | "petty_topup" | "invoice_upload" | null;

// ─── Form state types ─────────────────────────────────────────────────────────

interface PurchaseForm {
  branch_id: number; supplier_id: number; item_id: number;
  entry_date: string; quantity: number; unit_cost: number;
  tax_amount: number; payable_amount: number; notes: string;
}
interface ReturnForm {
  branch_id: number; supplier_id: number; item_id: number;
  entry_date: string; quantity: number; unit_cost: number;
  refund_amount: number; notes: string;
}
interface CashForm {
  branch_id: number; supplier_id: number; item_id: number;
  category_id: number; purchase_mode: PurchaseMode;
  purchase_type: PurchaseType; entry_date: string;
  quantity: number; unit_cost: number; tax_amount: number;
  payable_amount: number; petty_cash_used: boolean; notes: string;
}
interface PettyTopUpForm {
  branch_id: number; amount: number; entry_date: string; notes: string;
}
interface InvoiceForm {
  ref_table:       InvoiceRefTable;
  ref_id:          number;
  notes:           string;
  file:            File | null;
  branch_id?:      number;
  supplier_id?:    number;
  invoice_number?: string;
  invoice_date?:   string;
  amount?:         number;
}
interface NewCategoryForm { name: string; type: CategoryType; }

type PurchaseFormAction = { type: "SET"; field: keyof PurchaseForm; value: number | string } | { type: "RESET" };
type ReturnFormAction   = { type: "SET"; field: keyof ReturnForm;   value: number | string } | { type: "RESET" };
type CashFormAction     = { type: "SET"; field: keyof CashForm;     value: number | string | boolean } | { type: "RESET" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayISO      = (): string => new Date().toISOString().split("T")[0];
const currentPeriod = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };

const initPurchaseForm   = (): PurchaseForm   => ({ branch_id:0,supplier_id:0,item_id:0,entry_date:todayISO(),quantity:0,unit_cost:0,tax_amount:0,payable_amount:0,notes:"" });
const initReturnForm     = (): ReturnForm     => ({ branch_id:0,supplier_id:0,item_id:0,entry_date:todayISO(),quantity:0,unit_cost:0,refund_amount:0,notes:"" });
const initCashForm       = (): CashForm       => ({ branch_id:0,supplier_id:0,item_id:0,category_id:0,purchase_mode:"ingredient",purchase_type:"branch_cash",entry_date:todayISO(),quantity:0,unit_cost:0,tax_amount:0,payable_amount:0,petty_cash_used:false,notes:"" });
const initPettyTopUpForm = (): PettyTopUpForm => ({ branch_id:0,amount:0,entry_date:todayISO(),notes:"" });
const initInvoiceForm    = (): InvoiceForm    => ({ ref_table:"cash_purchases",ref_id:0,notes:"",file:null,branch_id:undefined,supplier_id:undefined,invoice_number:"",invoice_date:"",amount:undefined });
const initNewCategoryForm= (): NewCategoryForm=> ({ name:"",type:"expense" });

function purchaseFormReducer(s: PurchaseForm, a: PurchaseFormAction): PurchaseForm {
  if (a.type === "RESET") return initPurchaseForm();
  const n = { ...s, [a.field]: a.value };
  n.payable_amount = Number(n.quantity)*Number(n.unit_cost)+Number(n.tax_amount);
  return n;
}
function returnFormReducer(s: ReturnForm, a: ReturnFormAction): ReturnForm {
  if (a.type === "RESET") return initReturnForm();
  const n = { ...s, [a.field]: a.value };
  n.refund_amount = Number(n.quantity)*Number(n.unit_cost);
  return n;
}
function cashFormReducer(s: CashForm, a: CashFormAction): CashForm {
  if (a.type === "RESET") return initCashForm();
  const n = { ...s, [a.field]: a.value } as CashForm;
  if (a.field === "purchase_mode") { n.item_id = 0; n.category_id = 0; }
  n.payable_amount = Number(n.quantity)*Number(n.unit_cost)+Number(n.tax_amount);
  return n;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmt      = (n: number | string) => formatCurrencyValue(Number(n), { maximumFractionDigits: 2 });
const fmtBytes = (kb: number) => kb < 1024 ? `${kb} KB` : `${(kb/1024).toFixed(1)} MB`;

// ─── PDF bulk export ──────────────────────────────────────────────────────────

interface ExportStats { total: number; thisMonth: number; }

async function exportPurchasesToPDF(
  purchases: Purchase[],
  stats: ExportStats,
  branchLabel: string,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const PRIMARY:  [number,number,number] = [17, 24, 39];
  const ACCENT:   [number,number,number] = [59, 130, 246];
  const SURFACE:  [number,number,number] = [249, 250, 251];
  const INK:      [number,number,number] = [17, 24, 39];
  const MUTED:    [number,number,number] = [107, 114, 128];
  const GREEN:    [number,number,number] = [21, 128, 61];
  const GREEN_BG: [number,number,number] = [220, 252, 231];
  const AMBER:    [number,number,number] = [161, 98, 7];
  const AMBER_BG: [number,number,number] = [254, 243, 199];
  const RED:      [number,number,number] = [185, 28, 28];
  const RED_BG:   [number,number,number] = [254, 226, 226];

  const doc   = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 26, "F");
  doc.setFillColor(...ACCENT);
  doc.rect(0, 23, pageW, 3, "F");
  doc.setTextColor(255,255,255);
  doc.setFont("helvetica","bold"); doc.setFontSize(14);
  doc.text("Purchase Orders Report", 14, 12);
  doc.setFont("helvetica","normal"); doc.setFontSize(8);
  doc.text(`Branch: ${branchLabel}`, 14, 19);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageW-14, 19, { align:"right" });

  const cardY = 34;
  [
    { label:"Total (All Time)",                        value:fmt(stats.total) },
    { label:`This Month (${todayISO().slice(0,7)})`,   value:fmt(stats.thisMonth) },
    { label:"Total Records",                           value:String(purchases.length) },
  ].forEach((kpi,i) => {
    const x = 14 + i*80;
    doc.setFillColor(...SURFACE); doc.setDrawColor(229,231,235);
    doc.roundedRect(x, cardY, 75, 20, 2, 2, "FD");
    doc.setTextColor(...MUTED); doc.setFont("helvetica","normal"); doc.setFontSize(7);
    doc.text(kpi.label, x+5, cardY+7);
    doc.setTextColor(...INK); doc.setFont("helvetica","bold"); doc.setFontSize(12);
    doc.text(kpi.value, x+5, cardY+15);
  });

  autoTable(doc, {
    startY: cardY+26,
    head:   [["Date","Branch","Ingredient","Supplier","Qty","Unit Cost","Total","Status"]],
    body:   purchases.slice(0,500).map(r => [
      r.entry_date ?? "",
      r.branch_name ?? `Branch #${r.branch_id}`,
      r.ingredient_name ?? r.item_name ?? `Item #${r.item_id}`,
      r.supplier_name ?? `Supplier #${r.supplier_id}`,
      Number(r.quantity).toFixed(3),
      fmt(Number(r.unit_cost)),
      fmt(Number(r.gross_amount)),
      (r.status ?? "").toUpperCase(),
    ]),
    styles:             { fontSize:8, cellPadding:{top:3,bottom:3,left:4,right:4}, textColor:INK, lineColor:[229,231,235] as [number,number,number], lineWidth:0.2 },
    headStyles:         { fillColor:PRIMARY, textColor:[255,255,255] as [number,number,number], fontStyle:"bold", fontSize:8 },
    alternateRowStyles: { fillColor:SURFACE },
    columnStyles:       { 4:{halign:"right"},5:{halign:"right"},6:{halign:"right",fontStyle:"bold"},7:{halign:"center"} },
    didParseCell(data) {
      if (data.column.index===7 && data.section==="body") {
        const v = String(data.cell.raw??"").toLowerCase();
        if (v==="approved") { data.cell.styles.textColor=GREEN; data.cell.styles.fillColor=GREEN_BG; }
        else if (v==="pending") { data.cell.styles.textColor=AMBER; data.cell.styles.fillColor=AMBER_BG; }
        else { data.cell.styles.textColor=RED; data.cell.styles.fillColor=RED_BG; }
      }
    },
    foot:       [["","","","TOTAL","","",fmt(purchases.reduce((s,r)=>s+Number(r.gross_amount||0),0)),""]],
    footStyles: { fillColor:[239,246,255] as [number,number,number], textColor:ACCENT, fontStyle:"bold", fontSize:9 },
    margin: { left:14, right:14 },
  });

  const totalPages = (doc as any).internal.getNumberOfPages();
  const pageH      = doc.internal.pageSize.getHeight();
  for (let i=1;i<=totalPages;i++) {
    doc.setPage(i);
    doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...MUTED);
    doc.text(`Page ${i} of ${totalPages}`, pageW/2, pageH-5, { align:"center" });
  }

  doc.save(`purchase-orders-${branchLabel.replace(/\s+/g,"-").toLowerCase()}-${todayISO()}.pdf`);
}

// ─── PO HTML Export (open in browser → save as PDF) ──────────────────────────

function openPoAsHtml(purchase: Purchase, currencyLabel: string): void {
  const qty      = Number(purchase.quantity ?? 0);
  const unitCost = Number(purchase.unit_cost ?? 0);
  const gross    = qty * unitCost;
  const tax      = Number(purchase.tax_amount ?? 0);
  const payable  = Number(purchase.payable_amount ?? gross + tax);
  const now      = new Date().toLocaleDateString();

  const statusColor =
    purchase.status === "approved" ? "#16a34a" :
    purchase.status === "rejected" ? "#dc2626" : "#d97706";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>PO-${purchase.id} — STARK AI</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;background:#f8fafc;padding:0}
    .page{max-width:800px;margin:0 auto;background:#fff;min-height:100vh;padding:40px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;
            border-bottom:3px solid #1e3a5f;padding-bottom:20px;margin-bottom:28px}
    .brand{font-size:10px;font-weight:800;letter-spacing:4px;color:#1e3a5f;
           text-transform:uppercase;margin-bottom:6px}
    .doc-title{font-size:24px;font-weight:800;color:#0f172a;margin-bottom:4px}
    .doc-sub{font-size:12px;color:#64748b}
    .meta{text-align:right;font-size:11px;color:#94a3b8;line-height:1.8}
    .status-badge{display:inline-block;padding:3px 12px;border-radius:6px;
                  font-size:11px;font-weight:700;letter-spacing:.5px;
                  background:${purchase.status==="approved"?"#dcfce7":purchase.status==="rejected"?"#fee2e2":"#fef3c7"};
                  color:${statusColor}}
    .section{margin-bottom:24px}
    .section-title{font-size:9px;font-weight:700;text-transform:uppercase;
                   letter-spacing:2px;color:#94a3b8;margin-bottom:10px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .info-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
    .info-label{font-size:10px;font-weight:600;text-transform:uppercase;
                letter-spacing:.5px;color:#94a3b8;margin-bottom:4px}
    .info-value{font-size:13px;font-weight:600;color:#0f172a}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    thead tr{background:#1e3a5f}
    thead th{color:#fff;padding:10px 14px;text-align:left;font-size:11px;
             font-weight:700;text-transform:uppercase;letter-spacing:.5px}
    thead th.right{text-align:right}
    tbody tr{border-bottom:1px solid #f1f5f9}
    tbody tr:nth-child(even){background:#f8fafc}
    tbody td{padding:12px 14px;font-size:13px;color:#334155}
    tbody td.right{text-align:right;font-weight:600;color:#0f172a}
    .totals{margin-left:auto;width:280px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
    .totals-row{display:flex;justify-content:space-between;padding:10px 16px;
                border-bottom:1px solid #f1f5f9;font-size:13px}
    .totals-row:last-child{border-bottom:none;background:#1e3a5f;color:#fff;font-weight:700;font-size:14px}
    .totals-row:last-child span{color:#93c5fd}
    .notes-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
               padding:14px;font-size:12px;color:#475569;line-height:1.6}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;
            display:flex;justify-content:space-between;align-items:center}
    .footer-brand{font-size:10px;font-weight:700;letter-spacing:2px;color:#1e3a5f;text-transform:uppercase}
    .footer-note{font-size:10px;color:#94a3b8}
    .print-btn{position:fixed;top:20px;right:20px;padding:10px 20px;
               background:#1e3a5f;color:#fff;border:none;border-radius:8px;
               font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);
               display:flex;align-items:center;gap:8px}
    .print-btn:hover{background:#1e40af}
    @media print{
      .print-btn{display:none}
      body{background:#fff}
      .page{padding:20px;max-width:100%}
    }
  </style>
</head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Save as PDF</button>
<div class="page">

  <div class="header">
    <div>
      <div class="brand">STARK AI — Costing Platform</div>
      <div class="doc-title">Purchase Order</div>
      <div class="doc-sub">PO #${String(purchase.id).padStart(6,"0")} &nbsp;·&nbsp; ${purchase.entry_date}</div>
    </div>
    <div class="meta">
      <div><span class="status-badge">${(purchase.status ?? "PENDING").toUpperCase()}</span></div>
      <div style="margin-top:8px">Generated: ${now}</div>
      <div>Ref: PO-${purchase.id}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Order Details</div>
    <div class="info-grid">
      <div class="info-block">
        <div class="info-label">Branch</div>
        <div class="info-value">${purchase.branch_name ?? `Branch #${purchase.branch_id}`}</div>
      </div>
      <div class="info-block">
        <div class="info-label">Supplier</div>
        <div class="info-value">${purchase.supplier_name ?? `Supplier #${purchase.supplier_id}`}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Line Items</div>
    <table>
      <thead>
        <tr>
          <th>Ingredient / Item</th>
          <th class="right">Quantity</th>
          <th class="right">Unit Cost (${currencyLabel})</th>
          <th class="right">Gross Amount (${currencyLabel})</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${purchase.ingredient_name ?? purchase.item_name ?? `Item #${purchase.item_id}`}</td>
          <td class="right">${qty.toFixed(3)}</td>
          <td class="right">${fmt(unitCost)}</td>
          <td class="right">${fmt(gross)}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Gross Amount</span><span>${fmt(gross)}</span>
      </div>
      <div class="totals-row">
        <span>Tax</span><span>${fmt(tax)}</span>
      </div>
      <div class="totals-row">
        <span>Total Payable</span><span>${fmt(payable)}</span>
      </div>
    </div>
  </div>

  ${purchase.notes ? `
  <div class="section">
    <div class="section-title">Notes</div>
    <div class="notes-box">${purchase.notes}</div>
  </div>` : ""}

  <div class="footer">
    <div class="footer-brand">STARK AI</div>
    <div class="footer-note">Confidential · ${now} · PO-${purchase.id}</div>
  </div>

</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ─── Fulfillment status helpers ───────────────────────────────────────────────

function FulfillmentBadge({ status }: { status: FulfillmentRow["fulfillment_status"] }) {
  const map = {
    fully_received:     { cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800", icon: <CheckCircle className="w-3 h-3"/>, label: "Fully Received" },
    partially_received: { cls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800",             icon: <Clock className="w-3 h-3"/>,        label: "Partial" },
    not_received:       { cls: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800",                         icon: <XCircle className="w-3 h-3"/>,      label: "Not Received" },
  };
  const { cls, icon, label } = map[status] ?? map.not_received;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ─── UI Primitives ────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground transition-colors";

function Field({ label, htmlFor, children }: { label:string; htmlFor?:string; children:React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value, highlight=false }: { label:string; value:string; highlight?:boolean }) {
  return (
    <div className={`flex items-center justify-between ${highlight ? "border-t border-border pt-2 mt-1" : ""}`}>
      <span className={`text-sm ${highlight ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm font-medium tabular-nums ${highlight ? "text-primary font-bold text-base" : ""}`}>{value}</span>
    </div>
  );
}

function Modal({ title, subtitle, onClose, onSave, saving, children, cancelLabel, saveLabel }: {
  title:string; subtitle?:string; onClose:()=>void; onSave:()=>void;
  saving:boolean; children:React.ReactNode; cancelLabel:string; saveLabel:string;
}) {
  useEffect(() => {
    const h = (e:KeyboardEvent) => { if (e.key==="Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
        role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-lg border border-border/60 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[68vh] overflow-y-auto">{children}</div>
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>{cancelLabel}</Button>
          <Button size="sm" onClick={onSave} disabled={saving} className="min-w-[80px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status:PurchaseStatus }) {
  const cls: Record<PurchaseStatus,string> = {
    approved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800",
    pending:  "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800",
    rejected: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800",
  };
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md capitalize ${cls[status] ?? cls.pending}`}>
      {status}
    </span>
  );
}

function PurchaseTypeBadge({ type }: { type:PurchaseType }) {
  return type === "emergency" ? (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800">
      <Zap className="w-3 h-3"/>Emergency
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-900/20 dark:text-violet-400 dark:ring-violet-800">
      <Banknote className="w-3 h-3"/>Branch Cash
    </span>
  );
}

function LedgerTypeBadge({ type }: { type:"top_up"|"spend"|"adjustment" }) {
  const cls = {
    top_up:     "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800",
    spend:      "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800",
    adjustment: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:ring-blue-800",
  };
  const labels = { top_up:"Top-Up", spend:"Spend", adjustment:"Adjustment" };
  return <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md ${cls[type]}`}>{labels[type]}</span>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, trend, loading }: {
  label:string; value:string|number; sub?:string; trend?:number; loading?:boolean;
}) {
  return (
    <Card className="p-5 border border-border/60">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      {loading
        ? <div className="h-7 w-28 bg-muted/60 rounded animate-pulse" />
        : <p className="text-2xl font-bold text-foreground tracking-tight">{value}</p>
      }
      {(sub || trend !== undefined) && !loading && (
        <div className="flex items-center gap-1.5 mt-2">
          {trend !== undefined && (
            <span className={`flex items-center text-xs font-semibold ${trend>=0?"text-emerald-600":"text-red-500"}`}>
              {trend>=0 ? <ArrowUpRight className="w-3 h-3"/> : <ArrowDownRight className="w-3 h-3"/>}
              {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      )}
    </Card>
  );
}

function SkeletonRows({ count=4 }: { count?:number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length:count },(_,i) => (
        <div key={i} className="h-11 bg-muted/40 rounded-lg animate-pulse" style={{ animationDelay:`${i*60}ms` }} />
      ))}
    </div>
  );
}

function FormError({ message }: { message:string }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2.5">
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>{message}
    </div>
  );
}

// ─── Inline Category Creator ──────────────────────────────────────────────────

const CATEGORY_TYPES: { value:CategoryType; label:string; cls:string }[] = [
  { value:"expense",   label:"Expense",   cls:"border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:border-orange-700 dark:text-orange-400" },
  { value:"inventory", label:"Inventory", cls:"border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-400" },
  { value:"asset",     label:"Asset",     cls:"border-purple-300 bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:border-purple-700 dark:text-purple-400" },
  { value:"service",   label:"Service",   cls:"border-teal-300 bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:border-teal-700 dark:text-teal-400" },
];

interface InlineCategoryCreatorProps { onCreated:(cat:ExpenseCategory)=>void; onCancel:()=>void; }

function InlineCategoryCreator({ onCreated, onCancel }: InlineCategoryCreatorProps) {
  const [form,   setForm]   = useState<NewCategoryForm>(initNewCategoryForm);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  async function handleCreate() {
    const name = form.name.trim();
    if (!name) { setError("Category name is required."); return; }
    setSaving(true); setError("");
    try {
      const result = await apiCall<{ category: ExpenseCategory }>("/api/expense-categories", {
        method: "POST",
        body: JSON.stringify({ name, type:form.type }),
      });
      onCreated(result.category);
    } catch (e:any) { setError(e?.message ?? "Failed to create category."); }
    finally { setSaving(false); }
  }

  function handleKeyDown(e:React.KeyboardEvent) {
    if (e.key==="Enter") handleCreate();
    if (e.key==="Escape") onCancel();
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-primary uppercase tracking-wider">New Category</p>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5"/>
        </button>
      </div>
      {error && <FormError message={error}/>}
      <input
        ref={nameRef} type="text" className={inputCls}
        placeholder="Category name…" value={form.name}
        onChange={e => setForm(f=>({...f,name:e.target.value}))}
        onKeyDown={handleKeyDown}
      />
      <div className="grid grid-cols-2 gap-1.5">
        {CATEGORY_TYPES.map(ct => (
          <button key={ct.value} type="button"
            onClick={() => setForm(f=>({...f,type:ct.value}))}
            className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              form.type===ct.value ? ct.cls : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}>
            {form.type===ct.value && <Check className="w-3 h-3"/>}
            {ct.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving} className="flex-1">Cancel</Button>
        <Button size="sm" onClick={handleCreate} disabled={saving} className="flex-1 gap-1.5">
          {saving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Plus className="w-3 h-3"/>}
          Create
        </Button>
      </div>
    </div>
  );
}

// ─── Category Selector ────────────────────────────────────────────────────────

interface CategorySelectorProps {
  categories:ExpenseCategory[]; value:number;
  onChange:(id:number)=>void; onCategoryAdded:(cat:ExpenseCategory)=>void;
}

function CategorySelector({ categories, value, onChange, onCategoryAdded }: CategorySelectorProps) {
  const [showCreator, setShowCreator] = useState(false);

  function handleCreated(cat:ExpenseCategory) {
    onCategoryAdded(cat);
    onChange(cat.id);
    setShowCreator(false);
  }

  if (showCreator) return <InlineCategoryCreator onCreated={handleCreated} onCancel={()=>setShowCreator(false)}/>;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select id="cash-category" className={inputCls} value={value||""} onChange={e=>onChange(Number(e.target.value))}>
          <option value="">Select category…</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
          ))}
        </select>
        <button type="button" onClick={()=>setShowCreator(true)} title="Add new category"
          className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-dashed border-primary/40 bg-primary/[0.03] text-primary hover:bg-primary/10 hover:border-primary transition-colors">
          <Plus className="w-4 h-4"/>
        </button>
      </div>
      {categories.length===0 && !showCreator && (
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3"/>No categories yet — click <strong>+</strong> to create one.
        </p>
      )}
    </div>
  );
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

interface TabDef { key:TabKey; label:string; icon:React.ReactNode; }
const TABS: TabDef[] = [
  { key:"po",          label:"Purchase Orders", icon:<ShoppingCart  className="w-4 h-4"/> },
  { key:"cash",        label:"Cash Purchases",  icon:<Banknote      className="w-4 h-4"/> },
  { key:"petty",       label:"Petty Cash",      icon:<Wallet        className="w-4 h-4"/> },
  { key:"invoices",    label:"Invoices",        icon:<FileText      className="w-4 h-4"/> },
  { key:"fulfillment", label:"PO Fulfillment",  icon:<ClipboardList className="w-4 h-4"/> },
];

const INVOICE_REF_OPTIONS: { value:InvoiceRefTable; label:string }[] = [
  { value:"cash_purchases",      label:"Cash Purchase" },
  { value:"expenses",            label:"Expense" },
  { value:"inventory_movements", label:"Inventory Movement" },
];

const FILTER_KEY = "proc_filter_branch";

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, action }: { title:string; action?:React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
      {action}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon, title, desc, cta }: { icon:React.ReactNode; title:string; desc:string; cta?:React.ReactNode }) {
  return (
    <div className="py-16 text-center space-y-3">
      <div className="w-12 h-12 bg-muted/60 rounded-xl flex items-center justify-center mx-auto">
        {icon}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-xs mx-auto">{desc}</p>
      {cta}
    </div>
  );
}

// ─── Table wrapper ────────────────────────────────────────────────────────────

function TableWrap({ children }: { children:React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right=false, center=false }: { children:React.ReactNode; right?:boolean; center?:boolean }) {
  return (
    <th scope="col" className={`px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap ${right?"text-right":center?"text-center":"text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children, right=false, center=false, muted=false, mono=false, className="" }: {
  children:React.ReactNode; right?:boolean; center?:boolean; muted?:boolean; mono?:boolean; className?:string;
}) {
  return (
    <td className={`px-3 py-3 text-sm ${right?"text-right":center?"text-center":""} ${muted?"text-muted-foreground text-xs":""} ${mono?"tabular-nums":""} ${className}`}>
      {children}
    </td>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Procurement() {
  const { language, t } = useLanguage();

  const currentUserId   = Number(localStorage.getItem("user_id") ?? 1);
  const currentUserRole = (localStorage.getItem("role") ?? "clerk").trim().toLowerCase();
  const canApprove      = ["admin","manager","owner"].includes(currentUserRole);
  const currencyLabel   = getCurrencyLabel(language);

  // ── Active tab ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>("po");

  // ── Period status ──────────────────────────────────────────────────────────
  const [period, setPeriod] = useState(() => currentPeriod());
  const { data: companyPeriodStatus } = useApi<PeriodStatusRow>(() => getPeriodStatus(period), { deps:[period] });
  const selectedPeriodState  = companyPeriodStatus?.status ?? "open";
  const selectedPeriodClosed = selectedPeriodState==="closed" || selectedPeriodState==="locked";
  const selectedPeriodLocked = selectedPeriodState==="locked";
  const lockedTitle          = selectedPeriodClosed
    ? (selectedPeriodLocked ? "Period is locked — no changes allowed" : "Period is closed — no changes allowed")
    : undefined;

  // ── Reference data ─────────────────────────────────────────────────────────
  const { data:branchesRaw }          = useApi(getBranches);
  const { data:suppliersRaw }         = useApi(getSuppliers);
  const { data:ingredientsRaw }       = useApi(() => apiCall<Ingredient[]>("/api/ingredients"));
  const { data:expenseCategoriesRaw } = useApi(() => apiCall<ExpenseCategory[]>("/api/expense-categories"));

  const branches    = (branchesRaw    ?? []) as Branch[];
  const suppliers   = (suppliersRaw   ?? []) as Supplier[];
  const ingredients = (ingredientsRaw ?? []) as Ingredient[];

  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const categoriesInitialized = useRef(false);
  useEffect(() => {
    if (expenseCategoriesRaw != null && !categoriesInitialized.current) {
      setExpenseCategories(expenseCategoriesRaw as ExpenseCategory[]);
      categoriesInitialized.current = true;
    }
  }, [expenseCategoriesRaw]);

  function handleCategoryAdded(cat: ExpenseCategory) {
    setExpenseCategories(prev =>
      [...prev, cat].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    );
  }

  // ── Standard purchases ─────────────────────────────────────────────────────
  const [purchases,        setPurchases]        = useState<Purchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);
  const [exporting,        setExporting]        = useState(false);
  const [openingPoId,      setOpeningPoId]      = useState<number|null>(null);

  const [filterBranchId, setFilterBranchId] = useState<number>(() => {
    const saved = sessionStorage.getItem(FILTER_KEY);
    return saved ? Number(saved) : 0;
  });
  const updateFilter = useCallback((id:number) => {
    setFilterBranchId(id);
    sessionStorage.setItem(FILTER_KEY, String(id));
  }, []);

  const fetchPurchases = useCallback(async () => {
    setPurchasesLoading(true);
    try {
      const data = await apiCall<Purchase[]>("/api/purchases");
      setPurchases(data ?? []);
    } catch { setPurchases([]); }
    finally  { setPurchasesLoading(false); }
  }, []);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  // ── Open PO as printable HTML ──────────────────────────────────────────────
  const handleOpenPoHtml = useCallback(async (id: number) => {
    setOpeningPoId(id);
    try {
      const token = localStorage.getItem("token") ?? "";
      // Try to get full purchase details (with names) from API
      const resp = await fetch(`/api/purchases/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const json = await resp.json();
      const purchase: Purchase = json.purchase ?? json;
      openPoAsHtml(purchase, currencyLabel);
    } catch (err) {
      // Fallback: use local data already loaded
      const purchase = purchases.find(p => p.id === id);
      if (purchase) openPoAsHtml(purchase, currencyLabel);
      else console.error("PO open failed:", err);
    } finally {
      setOpeningPoId(null);
    }
  }, [purchases, currencyLabel]);

  // ── Cash purchases ─────────────────────────────────────────────────────────
  const [cashPurchases,        setCashPurchases]        = useState<CashPurchase[]>([]);
  const [cashPurchasesLoading, setCashPurchasesLoading] = useState(false);
  const [cashFilterBranchId,   setCashFilterBranchId]   = useState<number>(0);
  const [cashTypeFilter,       setCashTypeFilter]        = useState<string>("");
  const [approvingId,          setApprovingId]           = useState<number|null>(null);

  // ── Petty cash ─────────────────────────────────────────────────────────────
  const [pettyBranchId,    setPettyBranchId]    = useState<number>(0);
  const [pettyBalance,     setPettyBalance]     = useState<number|null>(null);
  const [pettyBalanceLoad, setPettyBalanceLoad] = useState(false);
  const [pettyLedger,      setPettyLedger]      = useState<PettyCashEntry[]>([]);
  const [pettyLedgerLoad,  setPettyLedgerLoad]  = useState(false);

  const fetchPettyBalance = useCallback(async (branchId:number) => {
    if (!branchId) { setPettyBalance(null); return; }
    setPettyBalanceLoad(true);
    try {
      const data = await apiCall<{ balance:number }>(`/api/petty-cash/balance?branch_id=${branchId}`);
      setPettyBalance(data?.balance ?? 0);
    } catch { setPettyBalance(null); }
    finally { setPettyBalanceLoad(false); }
  }, []);

  const fetchPettyLedger = useCallback(async (branchId:number) => {
    if (!branchId) { setPettyLedger([]); return; }
    setPettyLedgerLoad(true);
    try {
      const data = await apiCall<PettyCashEntry[]>(`/api/petty-cash/ledger?branch_id=${branchId}&limit=50`);
      setPettyLedger(data ?? []);
    } catch { setPettyLedger([]); }
    finally { setPettyLedgerLoad(false); }
  }, []);

  const fetchCashPurchases = useCallback(async () => {
    setCashPurchasesLoading(true);
    try {
      const params = new URLSearchParams();
      if (cashFilterBranchId) params.set("branch_id", String(cashFilterBranchId));
      if (cashTypeFilter)     params.set("purchase_type", cashTypeFilter);
      params.set("limit","100");
      const data = await apiCall<CashPurchase[]>(`/api/cash-purchases?${params}`);
      setCashPurchases(data ?? []);
    } catch { setCashPurchases([]); }
    finally { setCashPurchasesLoading(false); }
  }, [cashFilterBranchId, cashTypeFilter]);

  useEffect(() => { if (activeTab==="cash")  fetchCashPurchases(); }, [activeTab, fetchCashPurchases]);
  useEffect(() => {
    if (activeTab==="petty" && pettyBranchId) {
      fetchPettyBalance(pettyBranchId);
      fetchPettyLedger(pettyBranchId);
    }
  }, [activeTab, pettyBranchId, fetchPettyBalance, fetchPettyLedger]);

  const handleApproveCash = useCallback(async (id:number) => {
    setApprovingId(id);
    try {
      await apiCall(`/api/cash-purchases/${id}/approve`, { method:"POST" });
      await fetchCashPurchases();
      if (pettyBranchId) { await fetchPettyBalance(pettyBranchId); await fetchPettyLedger(pettyBranchId); }
    } catch (e) {
      console.error("Failed to approve cash purchase:", e);
      alert("Failed to approve cash purchase. Please try again.");
    }
    finally { setApprovingId(null); }
  }, [fetchCashPurchases, pettyBranchId, fetchPettyBalance, fetchPettyLedger]);

  // ── PO Fulfillment ─────────────────────────────────────────────────────────
  const [fulfillment,          setFulfillment]          = useState<FulfillmentRow[]>([]);
  const [fulfillmentLoading,   setFulfillmentLoading]   = useState(false);
  const [fulfillBranchId,      setFulfillBranchId]      = useState<number>(0);
  const [fulfillIngredientId,  setFulfillIngredientId]  = useState<number>(0);
  const [fulfillStatusFilter,  setFulfillStatusFilter]  = useState<string>("");

  const fetchFulfillment = useCallback(async () => {
    setFulfillmentLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (fulfillBranchId)     params.set("branch_id",     String(fulfillBranchId));
      if (fulfillIngredientId) params.set("ingredient_id", String(fulfillIngredientId));
      const data = await apiCall<FulfillmentRow[]>(`/api/purchases/fulfillment?${params}`);
      setFulfillment(data ?? []);
    } catch { setFulfillment([]); }
    finally { setFulfillmentLoading(false); }
  }, [fulfillBranchId, fulfillIngredientId]);

  useEffect(() => {
    if (activeTab === "fulfillment") fetchFulfillment();
  }, [activeTab, fetchFulfillment]);

  const filteredFulfillment = useMemo(() => {
    if (!fulfillStatusFilter) return fulfillment;
    return fulfillment.filter(r => r.fulfillment_status === fulfillStatusFilter);
  }, [fulfillment, fulfillStatusFilter]);

  const fulfillStats = useMemo(() => ({
    total:      fulfillment.length,
    fully:      fulfillment.filter(r => r.fulfillment_status === "fully_received").length,
    partial:    fulfillment.filter(r => r.fulfillment_status === "partially_received").length,
    none:       fulfillment.filter(r => r.fulfillment_status === "not_received").length,
    totalValue: fulfillment.reduce((s, r) => s + Number(r.po_value ?? 0), 0),
    pendingQty: fulfillment.reduce((s, r) => s + Number(r.pending_qty ?? 0), 0),
  }), [fulfillment]);

  // ── Invoices ───────────────────────────────────────────────────────────────
  const [invoiceRefTable,          setInvoiceRefTable]          = useState<InvoiceRefTable | "">("");
  const [invoices,                 setInvoices]                 = useState<Invoice[]>([]);
  const [invoicesLoading,          setInvoicesLoading]          = useState(false);
  const [invoiceFilterBranchId,    setInvoiceFilterBranchId]    = useState<number>(0);
  const [invoiceFilterSupplierId,  setInvoiceFilterSupplierId]  = useState<number>(0);
  const [invoiceNumberFilter,      setInvoiceNumberFilter]      = useState<string>("");
  const [invoiceDateFrom,          setInvoiceDateFrom]          = useState<string>("");
  const [invoiceDateTo,            setInvoiceDateTo]            = useState<string>("");

  const handleSearchInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const params = new URLSearchParams();
      if (invoiceRefTable)              params.set("ref_table",      invoiceRefTable);
      if (invoiceFilterBranchId)        params.set("branch_id",      String(invoiceFilterBranchId));
      if (invoiceFilterSupplierId)      params.set("supplier_id",    String(invoiceFilterSupplierId));
      if (invoiceNumberFilter.trim())   params.set("invoice_number", invoiceNumberFilter.trim());
      if (invoiceDateFrom)              params.set("date_from",      invoiceDateFrom);
      if (invoiceDateTo)                params.set("date_to",        invoiceDateTo);
      params.set("limit", "100");
      const data = await apiCall<Invoice[]>(`/api/invoices/search?${params}`);
      setInvoices(data ?? []);
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }, [invoiceRefTable, invoiceFilterBranchId, invoiceFilterSupplierId,
      invoiceNumberFilter, invoiceDateFrom, invoiceDateTo]);

  function handleClearInvoiceFilters() {
    setInvoiceRefTable("");
    setInvoiceFilterBranchId(0);
    setInvoiceFilterSupplierId(0);
    setInvoiceNumberFilter("");
    setInvoiceDateFrom("");
    setInvoiceDateTo("");
    setInvoices([]);
  }

  // ── Modal & form state ─────────────────────────────────────────────────────
  const [modal,          setModal]          = useState<ModalType>(null);
  const [saving,         setSaving]         = useState(false);
  const [formError,      setFormError]      = useState("");
  const [uploadProgress, setUploadProgress] = useState(false);
  const errorRef     = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [purchaseForm, dispatchPurchase] = useReducer(purchaseFormReducer, initPurchaseForm());
  const [returnForm,   dispatchReturn]   = useReducer(returnFormReducer,   initReturnForm());
  const [cashForm,     dispatchCash]     = useReducer(cashFormReducer,     initCashForm());
  const [pettyForm,    setPettyForm]     = useState<PettyTopUpForm>(initPettyTopUpForm);
  const [invoiceForm,  setInvoiceForm]   = useState<InvoiceForm>(initInvoiceForm);

  function openModal(type:ModalType) {
    if (selectedPeriodClosed && type!=="invoice_upload" && type!=="petty_topup") return;
    setFormError("");
    setModal(type);
    if (type==="purchase")       dispatchPurchase({ type:"RESET" });
    if (type==="return")         dispatchReturn({ type:"RESET" });
    if (type==="cash")           dispatchCash({ type:"RESET" });
    if (type==="petty_topup")    setPettyForm(initPettyTopUpForm());
    if (type==="invoice_upload") setInvoiceForm(initInvoiceForm());
  }

  useEffect(() => {
    if (formError) errorRef.current?.scrollIntoView({ behavior:"smooth", block:"nearest" });
  }, [formError]);

  // ── Derived data ───────────────────────────────────────────────────────────
  const filteredPurchases = useMemo(
    () => filterBranchId===0 ? purchases : purchases.filter(p => Number(p.branch_id)===filterBranchId),
    [purchases, filterBranchId],
  );

  const stats = useMemo(() => {
    const thisMonth     = todayISO().slice(0,7);
    const prevMonthDate = new Date(); prevMonthDate.setMonth(prevMonthDate.getMonth()-1);
    const prevMonth     = prevMonthDate.toISOString().slice(0,7);
    const total         = filteredPurchases.reduce((s,p)=>s+Number(p.gross_amount||0),0);
    const thisMT        = filteredPurchases.filter(p=>String(p.entry_date).slice(0,7)===thisMonth).reduce((s,p)=>s+Number(p.gross_amount||0),0);
    const prevMT        = filteredPurchases.filter(p=>String(p.entry_date).slice(0,7)===prevMonth).reduce((s,p)=>s+Number(p.gross_amount||0),0);
    const trend         = prevMT>0 ? ((thisMT-prevMT)/prevMT)*100 : thisMT>0 ? 100 : 0;
    return { total, thisMonth:thisMT, trend };
  }, [filteredPurchases]);

  const cashStats = useMemo(() => ({
    total:   cashPurchases.reduce((s,p)=>s+Number(p.payable_amount||0),0),
    pending: cashPurchases.filter(p=>p.status==="pending").length,
  }), [cashPurchases]);

  const activeBranchLabel = useMemo(
    () => filterBranchId===0 ? "All Branches" : (branches.find(b=>b.id===filterBranchId)?.name ?? `Branch #${filterBranchId}`),
    [filterBranchId, branches],
  );

  const branchPurchaseCounts = useMemo(() => {
    const counts: Record<number,number> = {};
    for (const p of purchases) counts[p.branch_id] = (counts[p.branch_id]??0)+1;
    return counts;
  }, [purchases]);

  // ── Export ─────────────────────────────────────────────────────────────────
  async function handleExportPDF() {
    if (!filteredPurchases.length) return;
    setExporting(true);
    try { await exportPurchasesToPDF(filteredPurchases, { total:stats.total, thisMonth:stats.thisMonth }, activeBranchLabel); }
    catch (err) { console.error("PDF export failed:", err); }
    finally { setExporting(false); }
  }

  // ── Save handlers ──────────────────────────────────────────────────────────

  async function handleSavePurchase() {
    if (selectedPeriodClosed) return;
    if (!purchaseForm.branch_id)   { setFormError(t("proc.err.branch"));     return; }
    if (!purchaseForm.supplier_id) { setFormError(t("proc.err.supplier"));   return; }
    if (!purchaseForm.item_id)     { setFormError(t("proc.err.ingredient")); return; }
    if (!purchaseForm.quantity)    { setFormError(t("proc.err.quantity"));   return; }
    if (!purchaseForm.unit_cost)   { setFormError(t("proc.err.unitCost"));   return; }
    setSaving(true); setFormError("");
    try {
      const saved = await addPurchase({
        branch_id:purchaseForm.branch_id, supplier_id:purchaseForm.supplier_id,
        item_id:purchaseForm.item_id, entry_date:purchaseForm.entry_date,
        quantity:purchaseForm.quantity, unit_cost:purchaseForm.unit_cost,
        tax_amount:purchaseForm.tax_amount, payable_amount:purchaseForm.payable_amount,
        notes:purchaseForm.notes, user_id:currentUserId,
      });
      if (saved) {
        window.dispatchEvent(new CustomEvent(PROCUREMENT_PO_EVENT, {
          detail: {
            ...saved,
            gross_amount:    purchaseForm.quantity * purchaseForm.unit_cost,
            entry_date:      purchaseForm.entry_date,
            status:          "pending",
            branch_name:     branches.find(b=>b.id===purchaseForm.branch_id)?.name,
            supplier_name:   suppliers.find(s=>s.id===purchaseForm.supplier_id)?.name,
            ingredient_name: ingredients.find(i=>i.id===purchaseForm.item_id)?.name,
          },
        }));
      }
      setModal(null);
      await fetchPurchases();
    } catch { setFormError(t("proc.err.savePurchase")); }
    finally  { setSaving(false); }
  }

  async function handleSaveReturn() {
    if (selectedPeriodClosed) return;
    if (!returnForm.branch_id)   { setFormError(t("proc.err.branch"));     return; }
    if (!returnForm.supplier_id) { setFormError(t("proc.err.supplier"));   return; }
    if (!returnForm.item_id)     { setFormError(t("proc.err.ingredient")); return; }
    if (!returnForm.quantity)    { setFormError(t("proc.err.quantity"));   return; }
    if (!returnForm.unit_cost)   { setFormError(t("proc.err.unitCost"));   return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/purchases/returns", {
        method: "POST",
        body: JSON.stringify({
          branch_id:returnForm.branch_id, supplier_id:returnForm.supplier_id,
          item_id:returnForm.item_id, entry_date:returnForm.entry_date,
          quantity:returnForm.quantity, unit_cost:returnForm.unit_cost,
          refund_amount:returnForm.refund_amount, notes:returnForm.notes,
          user_id:currentUserId,
        }),
      });
      setModal(null);
      await fetchPurchases();
    } catch { setFormError(t("proc.err.saveReturn")); }
    finally  { setSaving(false); }
  }

  async function handleSaveCash() {
    if (selectedPeriodClosed) return;
    if (!cashForm.branch_id) { setFormError(t("proc.err.branch")); return; }
    if (cashForm.purchase_mode==="ingredient" && !cashForm.item_id)     { setFormError(t("proc.err.ingredient")); return; }
    if (cashForm.purchase_mode==="expense"    && !cashForm.category_id) { setFormError("Please select an expense category."); return; }
    if (!cashForm.quantity)  { setFormError(t("proc.err.quantity")); return; }
    if (!cashForm.unit_cost) { setFormError(t("proc.err.unitCost")); return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/cash-purchases", {
        method: "POST",
        body: JSON.stringify({
          branch_id:      cashForm.branch_id,
          supplier_id:    cashForm.supplier_id || undefined,
          ingredient_id:  cashForm.purchase_mode==="ingredient" ? cashForm.item_id     : undefined,
          category_id:    cashForm.purchase_mode==="expense"    ? cashForm.category_id : undefined,
          purchase_type:  cashForm.purchase_type,
          entry_date:     cashForm.entry_date,
          quantity:       cashForm.quantity,
          unit_cost:      cashForm.unit_cost,
          tax_amount:     cashForm.tax_amount,
          payable_amount: cashForm.payable_amount,
          petty_cash_used:cashForm.petty_cash_used,
          notes:          cashForm.notes,
          user_id:        currentUserId,
        }),
      });
      setModal(null);
      await fetchCashPurchases();
    } catch { setFormError("Failed to save cash purchase. Check petty cash balance if using petty cash."); }
    finally  { setSaving(false); }
  }

  async function handleSavePettyTopUp() {
    if (!pettyForm.branch_id)                       { setFormError("Please select a branch."); return; }
    if (!pettyForm.amount || pettyForm.amount <= 0) { setFormError("Amount must be greater than 0."); return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/petty-cash/top-up", {
        method: "POST",
        body: JSON.stringify({
          branch_id:pettyForm.branch_id, amount:pettyForm.amount,
          entry_date:pettyForm.entry_date, notes:pettyForm.notes, user_id:currentUserId,
        }),
      });
      setModal(null);
      await fetchPettyBalance(pettyForm.branch_id);
      await fetchPettyLedger(pettyForm.branch_id);
    } catch { setFormError("Failed to top up petty cash."); }
    finally  { setSaving(false); }
  }

  async function handleUploadInvoice() {
    if (!invoiceForm.file)   { setFormError("Please select a file to upload."); return; }
    if (!invoiceForm.ref_id) { setFormError("Please enter the reference ID (e.g. record #)."); return; }
    setUploadProgress(true); setSaving(true); setFormError("");
    try {
      const formData = new FormData();
      formData.append("file",      invoiceForm.file);
      formData.append("ref_table", invoiceForm.ref_table);
      formData.append("ref_id",    String(invoiceForm.ref_id));
      formData.append("notes",     invoiceForm.notes);
      if (invoiceForm.branch_id)      formData.append("branch_id",      String(invoiceForm.branch_id));
      if (invoiceForm.supplier_id)    formData.append("supplier_id",    String(invoiceForm.supplier_id));
      if (invoiceForm.invoice_number) formData.append("invoice_number", invoiceForm.invoice_number);
      if (invoiceForm.invoice_date)   formData.append("invoice_date",   invoiceForm.invoice_date);
      if (invoiceForm.amount)         formData.append("amount",         String(invoiceForm.amount));

      const token    = localStorage.getItem("token") ?? "";
      const API_BASE = import.meta.env.VITE_API_URL ?? "";
      const resp = await fetch(`${API_BASE}/api/invoices/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.detail?.error ?? err?.detail ?? "Upload failed");
      }
      setModal(null);
      await handleSearchInvoices();
      setActiveTab("invoices");
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to upload invoice.");
    } finally {
      setSaving(false);
      setUploadProgress(false);
    }
  }

  async function handleInvoiceDownload(inv: Invoice) {
    try {
      const token = localStorage.getItem("token") ?? "";
      const resp  = await fetch(`/api/invoices/file/${inv.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const blob      = await resp.blob();
      const typedBlob = blob.slice(0, blob.size, inv.mime_type);
      const url = URL.createObjectURL(typedBlob);
      const a   = document.createElement("a");
      a.href = url; a.download = inv.file_name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Invoice download failed:", err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ══ PURCHASE MODAL ═══════════════════════════════════════════════════ */}
      {modal === "purchase" && (
        <Modal title={t("proc.modal.newPurchase")} subtitle="Record an incoming inventory purchase from a supplier"
          onClose={()=>setModal(null)} onSave={handleSavePurchase} saving={saving}
          cancelLabel={t("proc.cancel")} saveLabel={t("proc.save")}>
          <div ref={errorRef as any}><FormError message={formError}/></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("proc.field.branch")} htmlFor="pur-branch">
              <select id="pur-branch" className={inputCls} value={purchaseForm.branch_id||""}
                onChange={e=>dispatchPurchase({type:"SET",field:"branch_id",value:Number(e.target.value)})}>
                <option value="">{t("proc.ph.selectBranch")}</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("proc.field.supplier")} htmlFor="pur-supplier">
              <select id="pur-supplier" className={inputCls} value={purchaseForm.supplier_id||""}
                onChange={e=>dispatchPurchase({type:"SET",field:"supplier_id",value:Number(e.target.value)})}>
                <option value="">{t("proc.ph.selectSupplier")}</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("proc.field.ingredient")} htmlFor="pur-ingredient">
            <select id="pur-ingredient" className={inputCls} value={purchaseForm.item_id||""}
              onChange={e=>dispatchPurchase({type:"SET",field:"item_id",value:Number(e.target.value)})}>
              <option value="">{t("proc.ph.selectIngredient")}</option>
              {ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("proc.field.date")} htmlFor="pur-date">
              <input id="pur-date" type="date" className={inputCls} value={purchaseForm.entry_date}
                onChange={e=>dispatchPurchase({type:"SET",field:"entry_date",value:e.target.value})}/>
            </Field>
            <Field label={t("proc.field.quantity")} htmlFor="pur-qty">
              <input id="pur-qty" type="number" min={0} step={0.001} className={inputCls} placeholder="0.000"
                value={purchaseForm.quantity||""}
                onChange={e=>dispatchPurchase({type:"SET",field:"quantity",value:Number(e.target.value)})}/>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("proc.field.unitCost").replace("{currency}",currencyLabel)} htmlFor="pur-cost">
              <input id="pur-cost" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
                value={purchaseForm.unit_cost||""}
                onChange={e=>dispatchPurchase({type:"SET",field:"unit_cost",value:Number(e.target.value)})}/>
            </Field>
            <Field label={t("proc.field.taxAmount").replace("{currency}",currencyLabel)} htmlFor="pur-tax">
              <input id="pur-tax" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
                value={purchaseForm.tax_amount||""}
                onChange={e=>dispatchPurchase({type:"SET",field:"tax_amount",value:Number(e.target.value)})}/>
            </Field>
          </div>
          <div className="bg-muted/30 rounded-xl p-4 space-y-1.5 border border-border/60">
            <SummaryRow label={t("proc.summary.gross")}   value={fmt(purchaseForm.quantity*purchaseForm.unit_cost)}/>
            <SummaryRow label={t("proc.summary.tax")}     value={fmt(purchaseForm.tax_amount)}/>
            <SummaryRow label={t("proc.summary.payable")} value={fmt(purchaseForm.payable_amount)} highlight/>
          </div>
          <Field label={t("proc.field.notes")} htmlFor="pur-notes">
            <textarea id="pur-notes" className={inputCls} rows={2} placeholder={t("proc.ph.notes")}
              value={purchaseForm.notes}
              onChange={e=>dispatchPurchase({type:"SET",field:"notes",value:e.target.value})}/>
          </Field>
        </Modal>
      )}

      {/* ══ RETURN MODAL ══════════════════════════════════════════════════════ */}
      {modal === "return" && (
        <Modal title={t("proc.modal.return")} subtitle="Record a purchase return to reduce inventory and issue a refund"
          onClose={()=>setModal(null)} onSave={handleSaveReturn} saving={saving}
          cancelLabel={t("proc.cancel")} saveLabel={t("proc.save")}>
          <div ref={errorRef as any}><FormError message={formError}/></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("proc.field.branch")} htmlFor="ret-branch">
              <select id="ret-branch" className={inputCls} value={returnForm.branch_id||""}
                onChange={e=>dispatchReturn({type:"SET",field:"branch_id",value:Number(e.target.value)})}>
                <option value="">{t("proc.ph.selectBranch")}</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("proc.field.supplier")} htmlFor="ret-supplier">
              <select id="ret-supplier" className={inputCls} value={returnForm.supplier_id||""}
                onChange={e=>dispatchReturn({type:"SET",field:"supplier_id",value:Number(e.target.value)})}>
                <option value="">{t("proc.ph.selectSupplier")}</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("proc.field.ingredient")} htmlFor="ret-ingredient">
            <select id="ret-ingredient" className={inputCls} value={returnForm.item_id||""}
              onChange={e=>dispatchReturn({type:"SET",field:"item_id",value:Number(e.target.value)})}>
              <option value="">{t("proc.ph.selectIngredient")}</option>
              {ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("proc.field.date")} htmlFor="ret-date">
              <input id="ret-date" type="date" className={inputCls} value={returnForm.entry_date}
                onChange={e=>dispatchReturn({type:"SET",field:"entry_date",value:e.target.value})}/>
            </Field>
            <Field label={t("proc.field.quantity")} htmlFor="ret-qty">
              <input id="ret-qty" type="number" min={0} step={0.001} className={inputCls} placeholder="0.000"
                value={returnForm.quantity||""}
                onChange={e=>dispatchReturn({type:"SET",field:"quantity",value:Number(e.target.value)})}/>
            </Field>
            <Field label={t("proc.field.unitCostShort")} htmlFor="ret-cost">
              <input id="ret-cost" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
                value={returnForm.unit_cost||""}
                onChange={e=>dispatchReturn({type:"SET",field:"unit_cost",value:Number(e.target.value)})}/>
            </Field>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 flex justify-between items-center">
            <span className="text-sm font-semibold text-foreground">{t("proc.summary.refund")}</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmt(returnForm.refund_amount)}</span>
          </div>
          <Field label={t("proc.field.notes")} htmlFor="ret-notes">
            <textarea id="ret-notes" className={inputCls} rows={2} placeholder={t("proc.ph.returnNotes")}
              value={returnForm.notes}
              onChange={e=>dispatchReturn({type:"SET",field:"notes",value:e.target.value})}/>
          </Field>
        </Modal>
      )}

      {/* ══ CASH PURCHASE MODAL ═══════════════════════════════════════════════ */}
      {modal === "cash" && (
        <Modal title="New Cash Purchase"
          subtitle="Record a branch cash or emergency purchase — inventory or expense"
          onClose={()=>setModal(null)} onSave={handleSaveCash} saving={saving}
          cancelLabel="Cancel" saveLabel="Save">
          <div ref={errorRef as any}><FormError message={formError}/></div>

          <Field label="Purchase Type">
            <div className="grid grid-cols-2 gap-2">
              {(["branch_cash","emergency"] as PurchaseType[]).map(pt => (
                <button key={pt} type="button"
                  onClick={()=>dispatchCash({type:"SET",field:"purchase_type",value:pt})}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    cashForm.purchase_type===pt
                      ? pt==="emergency"
                        ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400"
                        : "border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:border-violet-700 dark:text-violet-400"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  }`}>
                  {pt==="emergency" ? <Zap className="w-4 h-4"/> : <Banknote className="w-4 h-4"/>}
                  {pt==="branch_cash" ? "Branch Cash" : "Emergency"}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch" htmlFor="cash-branch">
              <select id="cash-branch" className={inputCls} value={cashForm.branch_id||""}
                onChange={e=>dispatchCash({type:"SET",field:"branch_id",value:Number(e.target.value)})}>
                <option value="">Select branch…</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Supplier (optional)" htmlFor="cash-supplier">
              <select id="cash-supplier" className={inputCls} value={cashForm.supplier_id||""}
                onChange={e=>dispatchCash({type:"SET",field:"supplier_id",value:Number(e.target.value)})}>
                <option value="">Walk-in / no supplier</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="What are you buying?">
            <div className="grid grid-cols-2 gap-2">
              {([
                { mode:"ingredient" as PurchaseMode, label:"Inventory Item", icon:<Package className="w-4 h-4"/>, active:"border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-400" },
                { mode:"expense"    as PurchaseMode, label:"Expense",        icon:<Receipt  className="w-4 h-4"/>, active:"border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:border-orange-700 dark:text-orange-400" },
              ]).map(({ mode,label,icon,active }) => (
                <button key={mode} type="button"
                  onClick={()=>dispatchCash({type:"SET",field:"purchase_mode",value:mode})}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    cashForm.purchase_mode===mode ? active : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  }`}>
                  {icon}{label}
                </button>
              ))}
            </div>
          </Field>

          {cashForm.purchase_mode==="ingredient" && (
            <Field label="Ingredient" htmlFor="cash-ingredient">
              <select id="cash-ingredient" className={inputCls} value={cashForm.item_id||""}
                onChange={e=>dispatchCash({type:"SET",field:"item_id",value:Number(e.target.value)})}>
                <option value="">Select ingredient…</option>
                {ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </Field>
          )}
          {cashForm.purchase_mode==="expense" && (
            <Field label="Expense Category" htmlFor="cash-category">
              <CategorySelector
                categories={expenseCategories}
                value={cashForm.category_id}
                onChange={id=>dispatchCash({type:"SET",field:"category_id",value:id})}
                onCategoryAdded={handleCategoryAdded}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="cash-date">
              <input id="cash-date" type="date" className={inputCls} value={cashForm.entry_date}
                onChange={e=>dispatchCash({type:"SET",field:"entry_date",value:e.target.value})}/>
            </Field>
            <Field label="Quantity" htmlFor="cash-qty">
              <input id="cash-qty" type="number" min={0} step={0.001} className={inputCls} placeholder="0.000"
                value={cashForm.quantity||""}
                onChange={e=>dispatchCash({type:"SET",field:"quantity",value:Number(e.target.value)})}/>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Unit Cost (${currencyLabel})`} htmlFor="cash-cost">
              <input id="cash-cost" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
                value={cashForm.unit_cost||""}
                onChange={e=>dispatchCash({type:"SET",field:"unit_cost",value:Number(e.target.value)})}/>
            </Field>
            <Field label={`Tax Amount (${currencyLabel})`} htmlFor="cash-tax">
              <input id="cash-tax" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
                value={cashForm.tax_amount||""}
                onChange={e=>dispatchCash({type:"SET",field:"tax_amount",value:Number(e.target.value)})}/>
            </Field>
          </div>

          <div className="bg-muted/30 rounded-xl p-4 space-y-1.5 border border-border/60">
            <SummaryRow label="Gross Amount" value={fmt(cashForm.quantity*cashForm.unit_cost)}/>
            <SummaryRow label="Tax"          value={fmt(cashForm.tax_amount)}/>
            <SummaryRow label="Payable"      value={fmt(cashForm.payable_amount)} highlight/>
          </div>

          <div onClick={()=>dispatchCash({type:"SET",field:"petty_cash_used",value:!cashForm.petty_cash_used})}
            className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-colors select-none ${
              cashForm.petty_cash_used
                ? "border-violet-300 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-700"
                : "border-border bg-muted/20 hover:bg-muted/40"
            }`}>
            <div className="flex items-center gap-2.5">
              <Wallet className={`w-4 h-4 ${cashForm.petty_cash_used ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`}/>
              <div>
                <p className={`text-sm font-semibold ${cashForm.petty_cash_used ? "text-violet-700 dark:text-violet-300" : "text-foreground"}`}>
                  Deduct from Petty Cash
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Deducted from branch balance on approval</p>
              </div>
            </div>
            <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${cashForm.petty_cash_used ? "bg-violet-500" : "bg-muted"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${cashForm.petty_cash_used ? "left-4" : "left-0.5"}`}/>
            </div>
          </div>

          <Field label="Notes" htmlFor="cash-notes">
            <textarea id="cash-notes" className={inputCls} rows={2} placeholder="Optional notes…"
              value={cashForm.notes}
              onChange={e=>dispatchCash({type:"SET",field:"notes",value:e.target.value})}/>
          </Field>
        </Modal>
      )}

      {/* ══ PETTY TOP-UP MODAL ════════════════════════════════════════════════ */}
      {modal === "petty_topup" && (
        <Modal title="Top Up Petty Cash" subtitle="Add funds to a branch petty cash box"
          onClose={()=>setModal(null)} onSave={handleSavePettyTopUp} saving={saving}
          cancelLabel="Cancel" saveLabel="Top Up">
          <div ref={errorRef as any}><FormError message={formError}/></div>
          <Field label="Branch" htmlFor="petty-branch">
            <select id="petty-branch" className={inputCls} value={pettyForm.branch_id||""}
              onChange={e=>setPettyForm(f=>({...f,branch_id:Number(e.target.value)}))}>
              <option value="">Select branch…</option>
              {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Amount (${currencyLabel})`} htmlFor="petty-amount">
              <input id="petty-amount" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
                value={pettyForm.amount||""}
                onChange={e=>setPettyForm(f=>({...f,amount:Number(e.target.value)}))}/>
            </Field>
            <Field label="Date" htmlFor="petty-date">
              <input id="petty-date" type="date" className={inputCls} value={pettyForm.entry_date}
                onChange={e=>setPettyForm(f=>({...f,entry_date:e.target.value}))}/>
            </Field>
          </div>
          {pettyForm.amount > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 flex justify-between items-center">
              <span className="text-sm font-semibold text-foreground">Amount to add</span>
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmt(pettyForm.amount)}</span>
            </div>
          )}
          <Field label="Notes" htmlFor="petty-notes">
            <textarea id="petty-notes" className={inputCls} rows={2} placeholder="Source of funds, authorised by…"
              value={pettyForm.notes}
              onChange={e=>setPettyForm(f=>({...f,notes:e.target.value}))}/>
          </Field>
        </Modal>
      )}

      {/* ══ INVOICE UPLOAD MODAL ══════════════════════════════════════════════ */}
      {modal === "invoice_upload" && (
        <Modal title="Upload Invoice" subtitle="Attach a document to any record"
          onClose={()=>setModal(null)} onSave={handleUploadInvoice} saving={saving}
          cancelLabel="Cancel" saveLabel={uploadProgress ? "Uploading…" : "Upload"}>
          <div ref={errorRef as any}><FormError message={formError}/></div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Reference Type" htmlFor="inv-reftable">
              <select id="inv-reftable" className={inputCls} value={invoiceForm.ref_table}
                onChange={e=>setInvoiceForm(f=>({...f,ref_table:e.target.value as InvoiceRefTable}))}>
                {INVOICE_REF_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Record ID (#)" htmlFor="inv-refid">
              <input id="inv-refid" type="number" min={1} step={1} className={inputCls} placeholder="e.g. 42"
                value={invoiceForm.ref_id||""}
                onChange={e=>setInvoiceForm(f=>({...f,ref_id:Number(e.target.value)}))}/>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Branch" htmlFor="inv-branch">
              <select id="inv-branch" className={inputCls} value={invoiceForm.branch_id||""}
                onChange={e=>setInvoiceForm(f=>({...f,branch_id:Number(e.target.value)||undefined} as any))}>
                <option value="">Select branch…</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Supplier" htmlFor="inv-supplier">
              <select id="inv-supplier" className={inputCls} value={invoiceForm.supplier_id||""}
                onChange={e=>setInvoiceForm(f=>({...f,supplier_id:Number(e.target.value)||undefined} as any))}>
                <option value="">Select supplier…</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice Number" htmlFor="inv-number">
              <input id="inv-number" type="text" className={inputCls} placeholder="e.g. INV-2024-001"
                value={invoiceForm.invoice_number||""}
                onChange={e=>setInvoiceForm(f=>({...f,invoice_number:e.target.value} as any))}/>
            </Field>
            <Field label="Invoice Date" htmlFor="inv-date">
              <input id="inv-date" type="date" className={inputCls}
                value={invoiceForm.invoice_date||""}
                onChange={e=>setInvoiceForm(f=>({...f,invoice_date:e.target.value} as any))}/>
            </Field>
          </div>

          <Field label={`Amount (${currencyLabel})`} htmlFor="inv-amount">
            <input id="inv-amount" type="number" min={0} step={0.01} className={inputCls} placeholder="0.00"
              value={invoiceForm.amount||""}
              onChange={e=>setInvoiceForm(f=>({...f,amount:Number(e.target.value)||undefined} as any))}/>
          </Field>

          <div onClick={()=>fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              invoiceForm.file ? "border-primary/50 bg-primary/[0.03]" : "border-border hover:border-primary/30 hover:bg-muted/30"
            }`}>
            <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
              onChange={e=>{ const file=e.target.files?.[0]??null; setInvoiceForm(f=>({...f,file})); }}/>
            {invoiceForm.file ? (
              <div className="space-y-1">
                <FileText className="w-8 h-8 text-primary mx-auto"/>
                <p className="text-sm font-medium text-foreground">{invoiceForm.file.name}</p>
                <p className="text-xs text-muted-foreground">{fmtBytes(Math.round(invoiceForm.file.size/1024))}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 text-muted-foreground mx-auto"/>
                <p className="text-sm font-medium text-foreground">Click to select file</p>
                <p className="text-xs text-muted-foreground">JPEG, PNG or PDF — max 10 MB</p>
              </div>
            )}
          </div>

          <Field label="Notes" htmlFor="inv-notes">
            <input id="inv-notes" type="text" className={inputCls} placeholder="Optional description…"
              value={invoiceForm.notes}
              onChange={e=>setInvoiceForm(f=>({...f,notes:e.target.value}))}/>
          </Field>
        </Modal>
      )}

      {/* ══ PAGE HEADER ═══════════════════════════════════════════════════════ */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">{t("proc.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("proc.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input type="month" value={period} onChange={e=>setPeriod(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-36"/>

          <span className={`text-xs font-semibold px-2.5 py-1 rounded-md flex items-center gap-1.5 ${
            selectedPeriodLocked
              ? "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800"
              : selectedPeriodClosed
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:ring-emerald-800"
          }`}>
            <Lock className="w-3 h-3"/>{selectedPeriodState.toUpperCase()}
          </span>

          {activeTab==="po" && (
            <>
              <Button variant="outline" size="sm" onClick={handleExportPDF}
                disabled={exporting||purchasesLoading||!filteredPurchases.length}>
                {exporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <FileDown className="w-4 h-4"/>}
                <span className="ml-1.5 hidden sm:inline">Export PDF</span>
              </Button>
              <Button variant="outline" size="sm" onClick={fetchPurchases} disabled={purchasesLoading}>
                <RefreshCw className={`w-4 h-4 ${purchasesLoading?"animate-spin":""}`}/>
              </Button>
            </>
          )}
          {activeTab==="cash" && (
            <Button variant="outline" size="sm" onClick={fetchCashPurchases} disabled={cashPurchasesLoading}>
              <RefreshCw className={`w-4 h-4 ${cashPurchasesLoading?"animate-spin":""}`}/>
            </Button>
          )}
          {activeTab==="fulfillment" && (
            <Button variant="outline" size="sm" onClick={fetchFulfillment} disabled={fulfillmentLoading}>
              <RefreshCw className={`w-4 h-4 ${fulfillmentLoading?"animate-spin":""}`}/>
            </Button>
          )}
          {activeTab==="invoices" && (
            <Button variant="outline" size="sm" onClick={()=>openModal("invoice_upload")} className="gap-1.5">
              <Upload className="w-4 h-4"/> Upload Invoice
            </Button>
          )}
        </div>
      </div>

      {/* ══ PERIOD CLOSED BANNER ══════════════════════════════════════════════ */}
      {selectedPeriodClosed && (
        <Card className={`p-3.5 ${selectedPeriodLocked
          ? "border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10"
          : "border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/10"}`}>
          <p className={`flex items-center gap-2 text-sm ${selectedPeriodLocked ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <Lock className="h-3.5 w-3.5 flex-shrink-0"/>
            {selectedPeriodLocked
              ? `${period} is locked for the whole company. No purchase entries are allowed.`
              : `${period} is closed for the whole company. Purchase entries are restricted.`}
          </p>
        </Card>
      )}

      {/* ══ TAB NAV ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-0.5 border-b border-border overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.key} onClick={()=>setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab===tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border/60"
            }`}>
            {tab.icon}{tab.label}
            {tab.key==="cash" && cashStats.pending > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {cashStats.pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PURCHASE ORDERS                                                  */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab==="po" && (
        <>
          <Card className="px-4 py-3 border border-border/60">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
                <Filter className="w-3.5 h-3.5"/><span>Branch</span>
              </div>
              <select aria-label="Filter by branch"
                className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={filterBranchId} onChange={e=>updateFilter(Number(e.target.value))}>
                <option value={0}>All Branches ({purchases.length})</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name} ({branchPurchaseCounts[b.id]??0})</option>)}
              </select>
              {filterBranchId!==0 && (
                <>
                  <button onClick={()=>updateFilter(0)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear</button>
                  <span className="text-xs text-muted-foreground ml-auto">
                    <strong className="text-foreground">{activeBranchLabel}</strong> — {filteredPurchases.length} record{filteredPurchases.length!==1?"s":""}
                  </span>
                </>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KPICard label={t("proc.kpi.totalPurchases")}  value={fmt(stats.total)}    sub={filterBranchId===0?t("proc.kpi.allTime"):activeBranchLabel} loading={purchasesLoading}/>
            <KPICard label={t("proc.kpi.thisMonth")}       value={fmt(stats.thisMonth)} sub={todayISO().slice(0,7)} trend={stats.trend} loading={purchasesLoading}/>
            <KPICard label={t("proc.kpi.activeSuppliers")} value={suppliers.length}    sub={t("proc.kpi.inSystem")}/>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card className="lg:col-span-2 p-6 border border-border/60">
              <SectionHeader title={t("proc.ops.title")}/>
              <div className="space-y-2.5">
                {([
                  { key:"purchase" as ModalType, label:t("proc.ops.purchase"), desc:t("proc.ops.purchaseDesc"), icon:<ShoppingCart className="w-5 h-5"/>, iconCls:"bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400" },
                  { key:"return"   as ModalType, label:t("proc.ops.return"),   desc:t("proc.ops.returnDesc"),   icon:<RotateCcw    className="w-5 h-5"/>, iconCls:"bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400" },
                ] as const).map(item => (
                  <button key={item.key} onClick={()=>openModal(item.key)}
                    disabled={selectedPeriodClosed} title={lockedTitle}
                    className={`w-full text-left p-4 border border-border/60 rounded-xl transition-all flex items-center justify-between group ${
                      selectedPeriodClosed ? "opacity-50 cursor-not-allowed bg-muted/20" : "hover:bg-muted/40 hover:border-border cursor-pointer"
                    }`}>
                    <div className="flex items-center gap-3">
                      <div className={`${item.iconCls} p-2.5 rounded-lg`}>{item.icon}</div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">{item.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                      </div>
                    </div>
                    {!selectedPeriodClosed
                      ? <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity"><Plus className="w-3 h-3"/>{t("proc.ops.record")}<ChevronRight className="w-3 h-3"/></div>
                      : <Lock className="w-4 h-4 text-muted-foreground shrink-0"/>
                    }
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-6 border border-border/60">
              <SectionHeader title={t("proc.suppliers.title")}/>
              {!suppliers.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">{t("proc.suppliers.empty")}</p>
              ) : (
                <div className="space-y-2">
                  {suppliers.slice(0,6).map(s => (
                    <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border border-transparent hover:bg-muted/40 hover:border-border/60 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-sm truncate">{s.name}</p>
                        {s.phone && <p className="text-xs text-muted-foreground truncate">{s.phone}</p>}
                      </div>
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-500 shrink-0"/>
                    </div>
                  ))}
                  {suppliers.length>6 && <p className="text-xs text-muted-foreground text-center pt-1">+{suppliers.length-6} more</p>}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-6 border border-border/60">
            <SectionHeader title={t("proc.recent.title")}
              action={
                filteredPurchases.length>0 ? (
                  <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={exporting} className="text-xs gap-1.5">
                    {exporting ? <Loader2 className="w-3 h-3 animate-spin"/> : <FileDown className="w-3 h-3"/>}
                    Export {filterBranchId===0?"All":activeBranchLabel}
                  </Button>
                ) : undefined
              }
            />

            {purchasesLoading ? (
              <SkeletonRows count={5}/>
            ) : !filteredPurchases.length ? (
              <EmptyState
                icon={<Package className="w-6 h-6 text-muted-foreground"/>}
                title={filterBranchId!==0 ? `No purchases for ${activeBranchLabel}` : t("proc.recent.empty")}
                desc={filterBranchId!==0 ? "Try changing the branch filter or add a new purchase." : "Start by recording your first purchase order."}
                cta={
                  filterBranchId!==0
                    ? <Button size="sm" variant="outline" onClick={()=>updateFilter(0)}>Show All Branches</Button>
                    : <Button size="sm" onClick={()=>openModal("purchase")} disabled={selectedPeriodClosed} title={lockedTitle} className="gap-1.5"><Plus className="w-4 h-4"/>{t("proc.recent.firstCta")}</Button>
                }
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border">
                    <Th>Date</Th><Th>Branch</Th><Th>Ingredient</Th><Th>Supplier</Th>
                    <Th right>Qty</Th><Th right>Unit Cost</Th><Th right>Total</Th>
                    <Th center>Status</Th><Th center>Open</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredPurchases.slice(0,50).map((row,i) => (
                    <tr key={row.id??i} className="hover:bg-muted/30 transition-colors">
                      <Td muted>{row.entry_date}</Td>
                      <Td muted>{row.branch_name??`Branch #${row.branch_id}`}</Td>
                      <Td className="font-medium text-foreground">{row.ingredient_name??row.item_name??`Item #${row.item_id}`}</Td>
                      <Td muted>{row.supplier_name??`Supplier #${row.supplier_id}`}</Td>
                      <Td right muted mono>{Number(row.quantity).toFixed(3)}</Td>
                      <Td right muted mono>{fmt(Number(row.unit_cost))}</Td>
                      <Td right mono className="font-semibold text-foreground">{fmt(Number(row.gross_amount))}</Td>
                      <Td center><StatusBadge status={(row.status as PurchaseStatus)??"pending"}/></Td>
                      <Td center>
                        <button
                          onClick={()=>handleOpenPoHtml(row.id)}
                          disabled={openingPoId===row.id}
                          aria-label={`Open PO #${row.id} as printable page`}
                          title="Open as HTML — use browser Print → Save as PDF"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border/60 bg-background text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40">
                          {openingPoId===row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Eye className="w-3.5 h-3.5"/>}
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                {filteredPurchases.length>0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/20">
                      <td colSpan={6} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total ({filteredPurchases.length} records)</td>
                      <td className="px-3 py-2.5 text-right font-bold text-foreground tabular-nums text-sm">{fmt(stats.total)}</td>
                      <td colSpan={2}/>
                    </tr>
                  </tfoot>
                )}
              </TableWrap>
            )}
            {filteredPurchases.length>50 && (
              <p className="text-xs text-muted-foreground text-center py-3 border-t border-border mt-3">
                Showing 50 of {filteredPurchases.length} records — export PDF for full list.
              </p>
            )}
          </Card>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: CASH PURCHASES                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab==="cash" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KPICard label="Total Cash Purchases" value={fmt(cashStats.total)}  sub="All time"        loading={cashPurchasesLoading}/>
            <KPICard label="Pending Approval"      value={cashStats.pending}     sub="Awaiting review" loading={cashPurchasesLoading}/>
            <KPICard label="Total Records"         value={cashPurchases.length}  sub="Loaded"          loading={cashPurchasesLoading}/>
          </div>

          <Card className="px-4 py-3 border border-border/60">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
                <Filter className="w-3.5 h-3.5"/><span>Filter</span>
              </div>
              <select className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={cashFilterBranchId} onChange={e=>setCashFilterBranchId(Number(e.target.value))}>
                <option value={0}>All Branches</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={cashTypeFilter} onChange={e=>setCashTypeFilter(e.target.value)}>
                <option value="">All Types</option>
                <option value="branch_cash">Branch Cash</option>
                <option value="emergency">Emergency</option>
              </select>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={fetchCashPurchases} disabled={cashPurchasesLoading}>
                  <RefreshCw className={`w-4 h-4 ${cashPurchasesLoading?"animate-spin":""}`}/>
                </Button>
                <Button size="sm" onClick={()=>openModal("cash")} disabled={selectedPeriodClosed} title={lockedTitle} className="gap-1.5">
                  {selectedPeriodClosed ? <Lock className="w-3.5 h-3.5"/> : <><Plus className="w-4 h-4"/>New Cash Purchase</>}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-border/60">
            <SectionHeader title="Cash Purchase Records"/>
            {cashPurchasesLoading ? (
              <SkeletonRows count={5}/>
            ) : !cashPurchases.length ? (
              <EmptyState
                icon={<Banknote className="w-6 h-6 text-muted-foreground"/>}
                title="No cash purchases found"
                desc="Record branch cash or emergency buys — inventory or expense credited on approval."
                cta={<Button size="sm" onClick={()=>openModal("cash")} disabled={selectedPeriodClosed} title={lockedTitle} className="gap-1.5"><Plus className="w-4 h-4"/>New Cash Purchase</Button>}
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border">
                    <Th>Date</Th><Th>Branch</Th><Th>Type</Th><Th>Item / Category</Th>
                    <Th>Supplier</Th><Th right>Qty</Th><Th right>Unit Cost</Th>
                    <Th right>Payable</Th><Th center>Petty Cash</Th><Th center>Status</Th>
                    {canApprove && <Th center>Action</Th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {cashPurchases.map((row,i) => (
                    <tr key={row.id??i} className="hover:bg-muted/30 transition-colors">
                      <Td muted>{row.entry_date}</Td>
                      <Td muted>{row.branch_name??`Branch #${row.branch_id}`}</Td>
                      <Td><PurchaseTypeBadge type={row.purchase_type}/></Td>
                      <Td className="font-medium text-foreground">
                        {row.category_name ? (
                          <span className="flex items-center gap-1.5">
                            <Receipt className="w-3.5 h-3.5 text-orange-500 shrink-0"/>
                            {row.category_name}
                            {row.category_type && (
                              <span className="text-xs text-muted-foreground font-normal">({row.category_type})</span>
                            )}
                          </span>
                        ) : row.ingredient_name??`Item #${row.ingredient_id}`}
                      </Td>
                      <Td muted>{row.supplier_name??<span className="italic text-muted-foreground/50">Walk-in</span>}</Td>
                      <Td right muted mono>{Number(row.quantity).toFixed(3)}</Td>
                      <Td right muted mono>{fmt(Number(row.unit_cost))}</Td>
                      <Td right mono className="font-semibold text-foreground">{fmt(Number(row.payable_amount))}</Td>
                      <Td center>
                        {row.petty_cash_used
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400"><Wallet className="w-3 h-3"/>Yes</span>
                          : <span className="text-xs text-muted-foreground/50">—</span>}
                      </Td>
                      <Td center><StatusBadge status={row.status??"pending"}/></Td>
                      {canApprove && (
                        <Td center>
                          {row.status==="pending" ? (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/20"
                              disabled={approvingId===row.id}
                              onClick={()=>handleApproveCash(row.id)}>
                              {approvingId===row.id ? <Loader2 className="w-3 h-3 animate-spin"/> : "Approve"}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td colSpan={7} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total ({cashPurchases.length} records)</td>
                    <td className="px-3 py-2.5 text-right font-bold text-foreground tabular-nums text-sm">{fmt(cashStats.total)}</td>
                    <td colSpan={canApprove?3:2}/>
                  </tr>
                </tfoot>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PETTY CASH                                                       */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab==="petty" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="p-6 border border-border/60 lg:col-span-1">
            <SectionHeader title="Branch Petty Cash"/>
            <Field label="Select Branch" htmlFor="petty-sel-branch">
              <select id="petty-sel-branch" className={inputCls} value={pettyBranchId||""}
                onChange={e=>setPettyBranchId(Number(e.target.value))}>
                <option value="">Choose a branch…</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>

            {pettyBranchId > 0 && (
              <div className="mt-5 space-y-4">
                <div className="bg-muted/30 border border-border/60 rounded-xl p-5 text-center">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Current Balance</p>
                  {pettyBalanceLoad
                    ? <div className="h-9 w-28 bg-muted/50 rounded animate-pulse mx-auto"/>
                    : <p className="text-3xl font-bold text-foreground">{pettyBalance!==null ? fmt(pettyBalance) : "—"}</p>
                  }
                </div>
                <Button className="w-full gap-2" onClick={()=>openModal("petty_topup")} disabled={selectedPeriodClosed} title={lockedTitle}>
                  {selectedPeriodClosed ? <Lock className="w-4 h-4"/> : <Plus className="w-4 h-4"/>}
                  Top Up Petty Cash
                </Button>
              </div>
            )}
            {!pettyBranchId && (
              <p className="text-xs text-muted-foreground text-center py-8 mt-4">Select a branch to view its petty cash balance and ledger.</p>
            )}
          </Card>

          <Card className="p-6 border border-border/60 lg:col-span-2">
            <SectionHeader title="Ledger"
              action={
                pettyBranchId>0 ? (
                  <Button variant="outline" size="sm" onClick={()=>{ fetchPettyBalance(pettyBranchId); fetchPettyLedger(pettyBranchId); }} disabled={pettyLedgerLoad}>
                    <RefreshCw className={`w-4 h-4 ${pettyLedgerLoad?"animate-spin":""}`}/>
                  </Button>
                ) : undefined
              }
            />
            {!pettyBranchId ? (
              <EmptyState icon={<Wallet className="w-6 h-6 text-muted-foreground"/>} title="No branch selected" desc="Select a branch to view the petty cash ledger."/>
            ) : pettyLedgerLoad ? (
              <SkeletonRows count={5}/>
            ) : !pettyLedger.length ? (
              <EmptyState icon={<Wallet className="w-6 h-6 text-muted-foreground"/>} title="No transactions yet" desc="Top up this branch's petty cash to get started."/>
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border">
                    <Th>Date</Th><Th>Type</Th><Th right>Amount</Th><Th right>Balance After</Th><Th>Notes</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {pettyLedger.map((row,i) => (
                    <tr key={row.id??i} className="hover:bg-muted/30 transition-colors">
                      <Td muted>{row.entry_date}</Td>
                      <Td><LedgerTypeBadge type={row.txn_type}/></Td>
                      <Td right mono className={`font-semibold ${row.txn_type==="top_up"?"text-emerald-600 dark:text-emerald-400":"text-red-600 dark:text-red-400"}`}>
                        {row.txn_type==="top_up"?"+":" -"}{fmt(Math.abs(Number(row.amount)))}
                      </Td>
                      <Td right mono className="font-medium text-foreground">{fmt(Number(row.balance_after))}</Td>
                      <Td muted className="truncate max-w-[200px]">{row.notes||"—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: INVOICES                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab==="invoices" && (
        <>
          <Card className="p-6 border border-border/60">
            <SectionHeader title="Invoice Search"/>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Reference Type">
                <select className={inputCls} value={invoiceRefTable}
                  onChange={e=>setInvoiceRefTable(e.target.value as InvoiceRefTable)}>
                  <option value="">All Types</option>
                  {INVOICE_REF_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Branch">
                <select className={inputCls} value={invoiceFilterBranchId}
                  onChange={e=>setInvoiceFilterBranchId(Number(e.target.value))}>
                  <option value={0}>All Branches</option>
                  {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Supplier">
                <select className={inputCls} value={invoiceFilterSupplierId}
                  onChange={e=>setInvoiceFilterSupplierId(Number(e.target.value))}>
                  <option value={0}>All Suppliers</option>
                  {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Invoice Number">
                <input type="text" className={inputCls} placeholder="Search INV-..."
                  value={invoiceNumberFilter}
                  onChange={e=>setInvoiceNumberFilter(e.target.value)}/>
              </Field>
              <Field label="Date From">
                <input type="date" className={inputCls} value={invoiceDateFrom}
                  onChange={e=>setInvoiceDateFrom(e.target.value)}/>
              </Field>
              <Field label="Date To">
                <input type="date" className={inputCls} value={invoiceDateTo}
                  onChange={e=>setInvoiceDateTo(e.target.value)}/>
              </Field>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button onClick={handleSearchInvoices} disabled={invoicesLoading} className="gap-1.5">
                {invoicesLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Filter className="w-4 h-4"/>}
                Search Invoices
              </Button>
              <Button variant="outline" onClick={handleClearInvoiceFilters} className="gap-1.5">
                <X className="w-4 h-4"/> Clear
              </Button>
              <div className="ml-auto">
                <Button variant="outline" onClick={()=>openModal("invoice_upload")} className="gap-1.5">
                  <Upload className="w-4 h-4"/> Upload Invoice
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-border/60">
            <SectionHeader title={invoices.length>0 ? `${invoices.length} Invoice${invoices.length!==1?"s":""} Found` : "Invoices"}/>
            {invoicesLoading ? (
              <SkeletonRows count={4}/>
            ) : !invoices.length ? (
              <EmptyState
                icon={<Receipt className="w-6 h-6 text-muted-foreground"/>}
                title="No invoices found"
                desc="Use the filters above to search, or upload a new invoice."
                cta={<Button size="sm" variant="outline" onClick={()=>openModal("invoice_upload")} className="gap-1.5"><Upload className="w-4 h-4"/> Upload Invoice</Button>}
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border">
                    <Th>Invoice #</Th><Th>Date</Th><Th>File</Th><Th>Type</Th>
                    <Th>Branch</Th><Th>Supplier</Th><Th right>Amount</Th><Th center>Download</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {invoices.map(inv => {
                    const isPdf = inv.mime_type === "application/pdf";
                    return (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <Td className="font-medium text-foreground">
                          {inv.invoice_number
                            ? <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{inv.invoice_number}</span>
                            : <span className="text-muted-foreground/40 text-xs">—</span>}
                        </Td>
                        <Td muted>{inv.invoice_date ?? "—"}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${isPdf ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400" : "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"}`}>
                              {isPdf ? <FileText className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate max-w-[160px]">{inv.file_name}</p>
                              <p className="text-xs text-muted-foreground">{fmtBytes(inv.file_size_kb)}</p>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          {inv.ref_table && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground capitalize">
                              {INVOICE_REF_OPTIONS.find(o=>o.value===inv.ref_table)?.label ?? inv.ref_table}
                            </span>
                          )}
                        </Td>
                        <Td muted>{inv.branch_name ?? "—"}</Td>
                        <Td muted>{inv.supplier_name ?? "—"}</Td>
                        <Td right mono className="font-semibold text-foreground">{inv.amount!=null ? fmt(inv.amount) : "—"}</Td>
                        <Td center>
                          <button onClick={()=>handleInvoiceDownload(inv)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors">
                            <Download className="w-3.5 h-3.5"/> Download
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: PO FULFILLMENT                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab==="fulfillment" && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard label="Total POs"        value={fulfillStats.total}              sub="Approved POs" loading={fulfillmentLoading}/>
            <KPICard label="Fully Received"   value={fulfillStats.fully}              sub="Complete deliveries" loading={fulfillmentLoading}/>
            <KPICard label="Partial / Pending" value={fulfillStats.partial + fulfillStats.none} sub={`${fulfillStats.partial} partial · ${fulfillStats.none} not started`} loading={fulfillmentLoading}/>
            <KPICard label="Total PO Value"   value={fmt(fulfillStats.totalValue)}    sub="Sum of approved POs" loading={fulfillmentLoading}/>
          </div>

          {/* Filters */}
          <Card className="px-4 py-3 border border-border/60">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0">
                <Filter className="w-3.5 h-3.5"/><span>Filter</span>
              </div>
              <select className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={fulfillBranchId} onChange={e=>setFulfillBranchId(Number(e.target.value))}>
                <option value={0}>All Branches</option>
                {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select className="px-2.5 py-1.5 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={fulfillIngredientId} onChange={e=>setFulfillIngredientId(Number(e.target.value))}>
                <option value={0}>All Ingredients</option>
                {ingredients.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <div className="flex gap-1">
                {[
                  { value:"",                  label:"All" },
                  { value:"fully_received",    label:"✓ Fully Received" },
                  { value:"partially_received",label:"⏳ Partial" },
                  { value:"not_received",      label:"✕ Not Received" },
                ].map(f => (
                  <button key={f.value} onClick={()=>setFulfillStatusFilter(f.value)}
                    className={`px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                      fulfillStatusFilter===f.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:bg-secondary"
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={fetchFulfillment} disabled={fulfillmentLoading} className="ml-auto">
                <RefreshCw className={`w-4 h-4 ${fulfillmentLoading?"animate-spin":""}`}/>
              </Button>
            </div>
          </Card>

          {/* Table */}
          <Card className="p-6 border border-border/60">
            <SectionHeader
              title={`PO Fulfillment — ${filteredFulfillment.length} record${filteredFulfillment.length!==1?"s":""}`}
            />
            {fulfillmentLoading ? (
              <SkeletonRows count={6}/>
            ) : !filteredFulfillment.length ? (
              <EmptyState
                icon={<ClipboardList className="w-6 h-6 text-muted-foreground"/>}
                title="No fulfillment data"
                desc="Approved POs will appear here once created. Use the filters to narrow results."
              />
            ) : (
              <TableWrap>
                <thead>
                  <tr className="border-b border-border">
                    <Th>PO #</Th>
                    <Th>Date</Th>
                    <Th>Branch</Th>
                    <Th>Supplier</Th>
                    <Th>Ingredient</Th>
                    <Th right>PO Qty</Th>
                    <Th right>Received</Th>
                    <Th right>Pending</Th>
                    <Th center>GRNs</Th>
                    <Th>Last GRN</Th>
                    <Th right>PO Cost</Th>
                    <Th right>Actual Cost</Th>
                    <Th right>Variance</Th>
                    <Th center>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredFulfillment.map(row => {
                    const varianceColor =
                      row.cost_variance_pct > 5  ? "text-red-600 dark:text-red-400" :
                      row.cost_variance_pct < -5 ? "text-emerald-600 dark:text-emerald-400" :
                      "text-muted-foreground";

                    return (
                      <tr key={row.po_id} className="hover:bg-muted/30 transition-colors">
                        <Td className="font-mono text-xs font-semibold text-foreground">
                          PO-{String(row.po_id).padStart(5,"0")}
                        </Td>
                        <Td muted>{row.po_date}</Td>
                        <Td muted>{row.branch_name}</Td>
                        <Td muted>{row.supplier_name}</Td>
                        <Td className="font-medium text-foreground">{row.ingredient_name}</Td>
                        <Td right mono>{Number(row.po_qty).toFixed(3)} <span className="text-muted-foreground text-xs">{row.unit}</span></Td>
                        <Td right mono className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {Number(row.total_received).toFixed(3)}
                        </Td>
                        <Td right mono className={Number(row.pending_qty) > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}>
                          {Number(row.pending_qty).toFixed(3)}
                        </Td>
                        <Td center>
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold">
                            {row.grn_count}
                          </span>
                        </Td>
                        <Td muted>{row.last_grn_date ?? "—"}</Td>
                        <Td right mono>{fmt(row.po_unit_cost)}</Td>
                        <Td right mono>{fmt(row.avg_grn_unit_cost)}</Td>
                        <Td right>
                          <span className={`text-xs font-semibold ${varianceColor}`}>
                            {row.cost_variance_pct > 0 ? "+" : ""}
                            {Number(row.cost_variance_pct).toFixed(1)}%
                          </span>
                          {Math.abs(row.cost_variance_pct) > 0.01 && (
                            <div className="text-[10px] text-muted-foreground">
                              {row.cost_variance > 0 ? "+" : ""}{fmt(row.cost_variance)}
                            </div>
                          )}
                        </Td>
                        <Td center>
                          <FulfillmentBadge status={row.fulfillment_status}/>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Totals ({filteredFulfillment.length} POs)
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-foreground tabular-nums">
                      {filteredFulfillment.reduce((s,r)=>s+Number(r.po_qty),0).toFixed(3)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-emerald-600 tabular-nums">
                      {filteredFulfillment.reduce((s,r)=>s+Number(r.total_received),0).toFixed(3)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-amber-600 tabular-nums">
                      {filteredFulfillment.reduce((s,r)=>s+Number(r.pending_qty),0).toFixed(3)}
                    </td>
                    <td colSpan={3}/>
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-foreground tabular-nums" colSpan={3}>
                      {fmt(fulfillStats.totalValue)}
                    </td>
                    <td/>
                  </tr>
                </tfoot>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </div>
  );
}