import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, Plus, X, Loader2, AlertCircle, RefreshCw,
  Download, Filter, Search, FileText, Lock,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { apiCall, getPeriodStatus, setPeriodStatus } from "@/lib/api";
import type { PeriodStatusValue, PeriodStatusRow } from "@/lib/api";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  formatCurrency as formatCurrencyValue,
  formatDateTime,
  getCurrencyLabel,
} from "@/lib/localization";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split("T")[0];
}

function currentPeriod() {
  return today().slice(0, 7);
}

const safeNum = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

const toArray = (v: unknown): any[] =>
  Array.isArray(v)
    ? v
    : (v as any)?.data    ??
      (v as any)?.sales   ??
      (v as any)?.waste   ??
      (v as any)?.results ??
      [];

function fmt(n: number) {
  return formatCurrencyValue(safeNum(n), { maximumFractionDigits: 2 });
}

function exportToCSV(data: any[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h] ?? "";
      const str = String(val).replace(/"/g, '""');
      return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
    }).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadHtmlAsFile(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportToPDF(data: any[], title: string, subtitle?: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const tableRows = data.map(row =>
    `<tr>${headers.map(h => `<td>${row[h] ?? ""}</td>`).join("")}</tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1a1a2e;padding:28px 32px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:2px solid #e2e8f0;padding-bottom:14px}
  .header-left h1{font-size:20px;font-weight:700;color:#1a1a2e;letter-spacing:-0.3px}
  .header-left p{font-size:11px;color:#64748b;margin-top:3px}
  .header-right{text-align:right;font-size:10px;color:#94a3b8}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  thead tr{background:#1e293b;color:#f8fafc}
  thead th{padding:8px 10px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;white-space:nowrap}
  tbody tr:nth-child(even){background:#f8fafc}
  tbody tr:nth-child(odd){background:#ffffff}
  tbody tr:last-child td{border-bottom:2px solid #e2e8f0}
  td{padding:7px 10px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:10.5px}
  .footer{margin-top:16px;font-size:9.5px;color:#94a3b8;text-align:center}
  @media print{body{padding:0}@page{margin:18mm 14mm;size:A4 landscape}}
  .print-btn{position:fixed;top:16px;right:16px;padding:8px 18px;background:#1e293b;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-family:inherit}
  .print-btn:hover{background:#334155}
  @media print{.print-btn{display:none}}
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<div class="header">
  <div class="header-left"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
  <div class="header-right"><div>Generated: ${formatDateTime(new Date())}</div><div>${data.length} record${data.length !== 1 ? "s" : ""}</div></div>
</div>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${tableRows}</tbody></table>
<div class="footer">Exported from Sales Management System · ${today()}</div>
</body></html>`;

  downloadHtmlAsFile(html, `${title.replace(/\s+/g, "_")}_${today()}.html`);
}

// ─── Single-Sale PDF Receipt ──────────────────────────────────────────────────

function exportSingleSalePDF(row: any, currencyLabel: string, paymentLabel: (v: string) => string, statusLabel: (v: string) => string) {
  const productName = row.product_name ?? row.item_name ?? `Product #${row.product_id}`;
  const gross      = safeNum(row.gross_amount);
  const discount   = safeNum(row.discount_amount);
  const promotion  = safeNum(row.promotion_amount);
  const tax        = safeNum(row.tax_amount);
  const net        = safeNum(row.net_amount);
  const unitPrice  = safeNum(row.unit_price);
  const qty        = safeNum(row.quantity);
  const receivable = safeNum(row.receivable_amount);
  const statusColor = row.status === "approved" ? "#16a34a" : "#d97706";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Receipt #${row.id}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;display:flex;justify-content:center;padding:40px 20px}
  .receipt{background:#fff;width:420px;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12)}
  .receipt-header{background:#1e293b;color:#f8fafc;padding:24px 28px}
  .receipt-header h1{font-size:22px;font-weight:700;letter-spacing:-0.5px}
  .receipt-header p{font-size:12px;color:#94a3b8;margin-top:4px}
  .receipt-id{display:flex;justify-content:space-between;align-items:center;margin-top:16px}
  .receipt-id .id{font-size:13px;font-weight:600;color:#e2e8f0}
  .receipt-id .status{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}55}
  .section{padding:20px 28px;border-bottom:1px solid #f1f5f9}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .info-item label{font-size:10px;color:#94a3b8;display:block;margin-bottom:2px}
  .info-item span{font-size:13px;font-weight:600;color:#1e293b}
  .line-item{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px;color:#475569}
  .line-item.total{font-size:15px;font-weight:700;color:#1e293b;padding-top:12px;margin-top:6px;border-top:2px solid #e2e8f0}
  .line-item .label{color:#64748b}
  .line-item .value{font-weight:600}
  .line-item .value.deduct{color:#dc2626}
  .line-item .value.add{color:#d97706}
  .line-item .value.net{color:${statusColor};font-size:17px}
  .receivable-box{margin:0 28px 20px;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center}
  .receivable-box label{font-size:11px;color:#92400e;font-weight:600}
  .receivable-box span{font-size:14px;font-weight:700;color:#b45309}
  .notes-box{margin:0 28px 20px;background:#f8fafc;border-radius:8px;padding:12px 16px}
  .notes-box label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;font-weight:700;display:block;margin-bottom:6px}
  .notes-box p{font-size:12px;color:#475569;line-height:1.5}
  .receipt-footer{padding:18px 28px;text-align:center;background:#f8fafc}
  .receipt-footer p{font-size:10px;color:#94a3b8}
  .print-btn{display:block;margin:0 auto 20px;padding:9px 22px;background:#1e293b;color:#fff;border:none;border-radius:7px;font-size:12px;cursor:pointer;font-family:inherit}
  .print-btn:hover{background:#334155}
  @media print{.print-btn{display:none}body{background:#fff;padding:0}.receipt{box-shadow:none;width:100%;border-radius:0}@page{margin:0;size:A5}}
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
<div class="receipt">
  <div class="receipt-header">
    <h1>Sales Receipt</h1>
    <p>${String(row.entry_date).slice(0, 10)} · ${row.branch_name ?? `Branch #${row.branch_id}`}</p>
    <div class="receipt-id">
      <span class="id">Receipt #${row.id}</span>
      <span class="status">${statusLabel(row.status)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Product</div>
    <div class="info-grid">
      <div class="info-item"><label>Product</label><span>${productName}</span></div>
      <div class="info-item"><label>Quantity</label><span>${qty.toFixed(2)}</span></div>
      <div class="info-item"><label>Unit Price</label><span>${unitPrice.toFixed(2)} ${currencyLabel}</span></div>
      <div class="info-item"><label>Payment</label><span>${paymentLabel(row.payment_method)}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Breakdown</div>
    <div class="line-item"><span class="label">Gross Amount</span><span class="value">${gross.toFixed(2)} ${currencyLabel}</span></div>
    ${discount > 0 ? `<div class="line-item"><span class="label">Discount</span><span class="value deduct">− ${discount.toFixed(2)} ${currencyLabel}</span></div>` : ""}
    ${promotion > 0 ? `<div class="line-item"><span class="label">Promotion</span><span class="value deduct">− ${promotion.toFixed(2)} ${currencyLabel}</span></div>` : ""}
    ${tax > 0 ? `<div class="line-item"><span class="label">Tax</span><span class="value add">+ ${tax.toFixed(2)} ${currencyLabel}</span></div>` : ""}
    <div class="line-item total"><span class="label">Net Amount</span><span class="value net">${net.toFixed(2)} ${currencyLabel}</span></div>
  </div>

  ${receivable > 0 ? `
  <div class="receivable-box">
    <label>⏳ Receivable (Credit Owed)</label>
    <span>${receivable.toFixed(2)} ${currencyLabel}</span>
  </div>` : ""}

  ${row.notes ? `
  <div class="notes-box">
    <label>Notes</label>
    <p>${row.notes}</p>
  </div>` : ""}

  <div class="receipt-footer">
    <p>Generated ${formatDateTime(new Date())} · Sales Management System</p>
  </div>
</div>
</body></html>`;

  downloadHtmlAsFile(html, `receipt_${row.id ?? "sale"}_${String(row.entry_date).slice(0, 10)}.html`);
}

const inputClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

const labelClass = "block text-xs font-medium text-muted-foreground mb-1";

const PAYMENT_METHOD_KEYS: Record<string, string> = {
  cash:   "sales.payment.cash",
  bank:   "sales.payment.bank",
  credit: "sales.payment.credit",
};

const SALE_STATUS_KEYS: Record<string, string> = {
  approved: "sales.status.approved",
  pending:  "sales.status.pending",
};

const WASTE_REASON_KEYS: Record<string, string> = {
  kitchen:         "sales.reason.kitchen",
  expiry:          "sales.reason.expiry",
  overproduction:  "sales.reason.overproduction",
  customer_return: "sales.reason.customerReturn",
  other:           "sales.reason.other",
  damage:          "sales.reason.damage",
};

function translateOption(value: string, keys: Record<string, string>, t: (key: string) => string) {
  return keys[value] ? t(keys[value]) : value;
}

const salesTranslations = {
  en: {
    "sales.title": "Sales",
    "sales.subtitle": "Sales orders, returns, waste, and damage tracking",
    "sales.recordSale": "Record Sale",
    "sales.recordFirstSale": "Record First Sale",
    "sales.customerReturn": "Customer Return",
    "sales.logWaste": "Log Waste",
    "sales.logDamage": "Log Damage",
    "sales.recentActivity": "Recent Activity",
    "sales.totalSales": "Total Sales",
    "sales.discounts": "Discounts",
    "sales.wasteCost": "Waste Cost",
    "sales.transactions": "Transactions",
    "sales.totalRecorded": "Total recorded",
    "sales.vsLastMonth": "vs last month",
    "sales.ofSales": "of sales",
    "sales.noSales": "No sales recorded yet",
    "sales.noWaste": "No waste logged yet",
    "sales.damageHint": "Log damage events for finished goods",
    "sales.header.switchArabic": "Switch to Arabic",
    "sales.header.switchEnglish": "Switch to English",
    "sales.header.switchLight": "Switch to light mode",
    "sales.header.switchDark": "Switch to dark mode",
    "sales.header.toggleTheme": "Toggle theme",
    "sales.filter.search": "Search by item, branch...",
    "sales.filter.filters": "Filters",
    "sales.filter.exportCsv": "CSV",
    "sales.filter.exportPdf": "PDF",
    "sales.filter.branch": "Branch",
    "sales.filter.allBranches": "All branches",
    "sales.filter.fromDate": "From date",
    "sales.filter.toDate": "To date",
    "sales.filter.payment": "Payment",
    "sales.filter.allMethods": "All methods",
    "sales.filter.status": "Status",
    "sales.filter.allStatuses": "All statuses",
    "sales.filter.reason": "Reason",
    "sales.filter.allReasons": "All reasons",
    "sales.filter.showing": "Showing",
    "sales.filter.result": "result",
    "sales.filter.results": "results",
    "sales.filter.clearAll": "Clear all filters",
    "sales.payment.cash": "Cash",
    "sales.payment.bank": "Bank",
    "sales.payment.credit": "Credit",
    "sales.status.approved": "Approved",
    "sales.status.pending": "Pending",
    "sales.reason.kitchen": "Kitchen",
    "sales.reason.expiry": "Expiry",
    "sales.reason.overproduction": "Overproduction",
    "sales.reason.customerReturn": "Customer Return",
    "sales.reason.other": "Other",
    "sales.reason.damage": "Damage",
    "sales.form.branch": "Branch",
    "sales.form.product": "Product",
    "sales.form.date": "Date",
    "sales.form.quantity": "Quantity",
    "sales.form.unitPrice": "Unit Price",
    "sales.form.paymentMethod": "Payment Method",
    "sales.form.discount": "Discount",
    "sales.form.promotion": "Promotion",
    "sales.form.tax": "Tax",
    "sales.form.grossAmount": "Gross Amount",
    "sales.form.netAmount": "Net Amount",
    "sales.form.notes": "Notes",
    "sales.form.notesPlaceholder": "Any notes...",
    "sales.form.select": "Select...",
    "sales.form.refundAmount": "Refund Amount",
    "sales.form.returnReasonPlaceholder": "Return reason...",
    "sales.form.reason": "Reason",
    "sales.form.wasteNotesPlaceholder": "Waste notes...",
    "sales.form.damageNotesPlaceholder": "Damage notes...",
    "sales.form.branchRequired": "Select a branch",
    "sales.form.productRequired": "Select a product",
    "sales.form.quantityRequired": "Enter quantity",
    "sales.form.unitPriceRequired": "Enter unit price",
    "sales.form.saveSaleFailed": "Failed to save sale. Please try again.",
    "sales.form.saveReturnFailed": "Failed to save return.",
    "sales.form.saveWasteFailed": "Failed to save waste.",
    "sales.form.saveDamageFailed": "Failed to save damage.",
    "sales.pagination.page": "Page",
    "sales.pagination.of": "of",
    "sales.table.date": "Date",
    "sales.table.branch": "Branch",
    "sales.table.item": "Item",
    "sales.table.qty": "Qty",
    "sales.table.quantity": "Quantity",
    "sales.table.unitPrice": "Unit Price",
    "sales.table.gross": "Gross",
    "sales.table.discount": "Discount",
    "sales.table.tax": "Tax",
    "sales.table.net": "Net",
    "sales.table.receivable": "Receivable",
    "sales.table.payment": "Payment",
    "sales.table.status": "Status",
    "sales.table.reason": "Reason",
    "sales.table.costValue": "Cost Value",
    "sales.table.noResults": "No results match your filters.",
    "sales.tab.sales": "Sales",
    "sales.tab.waste": "Waste",
    "sales.tab.damage": "Damage",
    "sales.table.totals": "Totals",
    "sales.table.unitPriceShort": "Unit Price",
    "sales.expand.unitPrice": "Unit Price",
    "sales.expand.promotion": "Promotion",
    "sales.expand.receivable": "Receivable",
    "sales.expand.notes": "Notes",
    "sales.expand.downloadPdf": "Download PDF",
  },
  ar: {
    "sales.title": "المبيعات",
    "sales.subtitle": "تتبع أوامر المبيعات والمرتجعات والهدر والتالف",
    "sales.recordSale": "تسجيل بيع",
    "sales.recordFirstSale": "تسجيل أول عملية بيع",
    "sales.customerReturn": "مرتجع عميل",
    "sales.logWaste": "تسجيل هدر",
    "sales.logDamage": "تسجيل تالف",
    "sales.recentActivity": "النشاط الأخير",
    "sales.totalSales": "إجمالي المبيعات",
    "sales.discounts": "الخصومات",
    "sales.wasteCost": "تكلفة الهدر",
    "sales.transactions": "المعاملات",
    "sales.totalRecorded": "إجمالي المسجل",
    "sales.vsLastMonth": "مقارنة بالشهر الماضي",
    "sales.ofSales": "من المبيعات",
    "sales.noSales": "لا توجد مبيعات مسجلة بعد",
    "sales.noWaste": "لا توجد سجلات هدر بعد",
    "sales.damageHint": "سجل أحداث التالف للمنتجات النهائية",
    "sales.header.switchArabic": "التبديل إلى العربية",
    "sales.header.switchEnglish": "التبديل إلى الإنجليزية",
    "sales.header.switchLight": "التبديل إلى الوضع الفاتح",
    "sales.header.switchDark": "التبديل إلى الوضع الداكن",
    "sales.header.toggleTheme": "تبديل المظهر",
    "sales.filter.search": "ابحث حسب الصنف أو الفرع...",
    "sales.filter.filters": "الفلاتر",
    "sales.filter.exportCsv": "CSV",
    "sales.filter.exportPdf": "PDF",
    "sales.filter.branch": "الفرع",
    "sales.filter.allBranches": "كل الفروع",
    "sales.filter.fromDate": "من تاريخ",
    "sales.filter.toDate": "إلى تاريخ",
    "sales.filter.payment": "الدفع",
    "sales.filter.allMethods": "كل الطرق",
    "sales.filter.status": "الحالة",
    "sales.filter.allStatuses": "كل الحالات",
    "sales.filter.reason": "السبب",
    "sales.filter.allReasons": "كل الأسباب",
    "sales.filter.showing": "عرض",
    "sales.filter.result": "نتيجة",
    "sales.filter.results": "نتائج",
    "sales.filter.clearAll": "مسح كل الفلاتر",
    "sales.payment.cash": "نقدي",
    "sales.payment.bank": "بنكي",
    "sales.payment.credit": "آجل",
    "sales.status.approved": "معتمد",
    "sales.status.pending": "معلق",
    "sales.reason.kitchen": "المطبخ",
    "sales.reason.expiry": "انتهاء الصلاحية",
    "sales.reason.overproduction": "زيادة إنتاج",
    "sales.reason.customerReturn": "مرتجع عميل",
    "sales.reason.other": "أخرى",
    "sales.reason.damage": "تالف",
    "sales.form.branch": "الفرع",
    "sales.form.product": "المنتج",
    "sales.form.date": "التاريخ",
    "sales.form.quantity": "الكمية",
    "sales.form.unitPrice": "سعر الوحدة",
    "sales.form.paymentMethod": "طريقة الدفع",
    "sales.form.discount": "الخصم",
    "sales.form.promotion": "الترويج",
    "sales.form.tax": "الضريبة",
    "sales.form.grossAmount": "الإجمالي قبل الخصم",
    "sales.form.netAmount": "الصافي",
    "sales.form.notes": "ملاحظات",
    "sales.form.notesPlaceholder": "أي ملاحظات...",
    "sales.form.select": "اختر...",
    "sales.form.refundAmount": "مبلغ الاسترداد",
    "sales.form.returnReasonPlaceholder": "سبب المرتجع...",
    "sales.form.reason": "السبب",
    "sales.form.wasteNotesPlaceholder": "ملاحظات الهدر...",
    "sales.form.damageNotesPlaceholder": "ملاحظات التالف...",
    "sales.form.branchRequired": "اختر فرعًا",
    "sales.form.productRequired": "اختر منتجًا",
    "sales.form.quantityRequired": "أدخل الكمية",
    "sales.form.unitPriceRequired": "أدخل سعر الوحدة",
    "sales.form.saveSaleFailed": "فشل حفظ عملية البيع. حاول مرة أخرى.",
    "sales.form.saveReturnFailed": "فشل حفظ المرتجع.",
    "sales.form.saveWasteFailed": "فشل حفظ الهدر.",
    "sales.form.saveDamageFailed": "فشل حفظ التالف.",
    "sales.pagination.page": "صفحة",
    "sales.pagination.of": "من",
    "sales.table.date": "التاريخ",
    "sales.table.branch": "الفرع",
    "sales.table.item": "الصنف",
    "sales.table.qty": "الكمية",
    "sales.table.quantity": "الكمية",
    "sales.table.unitPrice": "سعر الوحدة",
    "sales.table.gross": "الإجمالي",
    "sales.table.discount": "الخصم",
    "sales.table.tax": "الضريبة",
    "sales.table.net": "الصافي",
    "sales.table.receivable": "المستحق",
    "sales.table.payment": "الدفع",
    "sales.table.status": "الحالة",
    "sales.table.reason": "السبب",
    "sales.table.costValue": "قيمة التكلفة",
    "sales.table.noResults": "لا توجد نتائج تطابق الفلاتر.",
    "sales.tab.sales": "المبيعات",
    "sales.tab.waste": "الهدر",
    "sales.tab.damage": "التالف",
    "sales.table.totals": "المجاميع",
    "sales.table.unitPriceShort": "سعر الوحدة",
    "sales.expand.unitPrice": "سعر الوحدة",
    "sales.expand.promotion": "الترويج",
    "sales.expand.receivable": "المستحق",
    "sales.expand.notes": "ملاحظات",
    "sales.expand.downloadPdf": "تحميل PDF",
  },
} as const;

function useSalesText() {
  const { t, language } = useLanguage();
  const dictionary = salesTranslations[language];
  return (key: string) => dictionary[key as keyof typeof dictionary] ?? t(key);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  title, onClose, onSave, saving, children,
}: {
  title: string; onClose: () => void; onSave: () => void;
  saving: boolean; children: React.ReactNode;
}) {
  const t = useSalesText();
  const localizedTitle =
    title.includes("Record Sale")     ? t("sales.recordSale")     :
    title.includes("Customer Return") ? t("sales.customerReturn") :
    title.includes("Log Waste")       ? t("sales.logWaste")       :
    title.includes("Log Damage")      ? t("sales.logDamage")      :
    title;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-5 border border-border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{localizedTitle}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={onSave} disabled={saving} className="min-w-[80px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Period Status Modal ──────────────────────────────────────────────────────

function PeriodStatusModal({
  period, setPeriod, currentStatus, onClose, onSave, saving, formError,
}: {
  period: string;
  setPeriod: (p: string) => void;
  currentStatus: PeriodStatusValue;
  onClose: () => void;
  onSave: (status: PeriodStatusValue, notes: string) => void;
  saving: boolean;
  formError: string;
}) {
  const [status, setStatus] = useState<PeriodStatusValue>(
    currentStatus === "open" ? "closed" : currentStatus
  );
  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Period Status</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Set company-wide period access for all branches</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {formError && (
            <p className="text-xs text-red-600 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              <AlertCircle className="w-3 h-3 flex-shrink-0" />{formError}
            </p>
          )}
          <Field label="Period">
            <input type="month" className={inputClass} value={period} onChange={e => setPeriod(e.target.value)} />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={status} onChange={e => setStatus(e.target.value as PeriodStatusValue)}>
              <option value="open">Open — normal work</option>
              <option value="closed">Closed — no edits</option>
              <option value="locked">Locked — fully frozen</option>
            </select>
          </Field>
          <Field label="Notes">
            <textarea className={inputClass} rows={2} placeholder="Reason for status change..."
              value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
          <p className="text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2">
            This applies to the selected period for the whole company. Closing or locking prevents new entries across all branches.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-border bg-secondary/20 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => onSave(status, notes)} disabled={saving} className="min-w-[90px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface SaleFilters {
  branchId: string;
  dateFrom: string;
  dateTo: string;
  paymentMethod: string;
  search: string;
  status: string;
}

function FilterBar({
  filters, setFilters, branches, onExport, onExportPDF, resultCount,
}: {
  filters: SaleFilters;
  setFilters: React.Dispatch<React.SetStateAction<SaleFilters>>;
  branches: any[];
  onExport: () => void;
  onExportPDF: () => void;
  resultCount: number;
}) {
  const t = useSalesText();
  const [open, setOpen] = useState(false);

  const activeCount = [
    filters.branchId, filters.dateFrom, filters.dateTo,
    filters.paymentMethod, filters.status,
  ].filter(Boolean).length;

  function reset() {
    setFilters({ branchId: "", dateFrom: "", dateTo: "", paymentMethod: "", search: "", status: "" });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("sales.filter.search")}
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            className="w-full pl-9 pr-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(o => !o)} className="relative shrink-0">
          <Filter className="w-4 h-4 mr-1" />
          {t("sales.filter.filters")}
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
              {activeCount}
            </span>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} className="shrink-0">
          <Download className="w-4 h-4 mr-1" />{t("sales.filter.exportCsv")}
        </Button>
        <Button variant="outline" size="sm" onClick={onExportPDF} className="shrink-0">
          <FileText className="w-4 h-4 mr-1" />{t("sales.filter.exportPdf")}
        </Button>
      </div>

      {open && (
        <div className="p-4 border border-border rounded-lg bg-secondary/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Field label={t("sales.filter.branch")}>
              <select className={inputClass} value={filters.branchId}
                onChange={e => setFilters(f => ({ ...f, branchId: e.target.value }))}>
                <option value="">{t("sales.filter.allBranches")}</option>
                {branches.map((b: any) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("sales.filter.fromDate")}>
              <input type="date" className={inputClass} value={filters.dateFrom}
                onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            </Field>
            <Field label={t("sales.filter.toDate")}>
              <input type="date" className={inputClass} value={filters.dateTo}
                onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </Field>
            <Field label={t("sales.filter.payment")}>
              <select className={inputClass} value={filters.paymentMethod}
                onChange={e => setFilters(f => ({ ...f, paymentMethod: e.target.value }))}>
                <option value="">{t("sales.filter.allMethods")}</option>
                <option value="cash">{translateOption("cash", PAYMENT_METHOD_KEYS, t)}</option>
                <option value="bank">{translateOption("bank", PAYMENT_METHOD_KEYS, t)}</option>
                <option value="credit">{translateOption("credit", PAYMENT_METHOD_KEYS, t)}</option>
              </select>
            </Field>
            <Field label={t("sales.filter.status")}>
              <select className={inputClass} value={filters.status}
                onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
                <option value="">{t("sales.filter.allStatuses")}</option>
                <option value="approved">{translateOption("approved", SALE_STATUS_KEYS, t)}</option>
                <option value="pending">{translateOption("pending", SALE_STATUS_KEYS, t)}</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {t("sales.filter.showing")} <span className="font-semibold text-foreground">{resultCount}</span>{" "}
              {resultCount === 1 ? t("sales.filter.result") : t("sales.filter.results")}
            </p>
            {activeCount > 0 && (
              <button onClick={reset} className="text-xs text-primary hover:underline">
                {t("sales.filter.clearAll")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Waste Filter Bar ─────────────────────────────────────────────────────────

interface WasteFilters {
  branchId: string;
  dateFrom: string;
  dateTo: string;
  reason: string;
  search: string;
}

function WasteFilterBar({
  filters, setFilters, branches, onExport, onExportPDF, resultCount,
}: {
  filters: WasteFilters;
  setFilters: React.Dispatch<React.SetStateAction<WasteFilters>>;
  branches: any[];
  onExport: () => void;
  onExportPDF: () => void;
  resultCount: number;
}) {
  const t = useSalesText();
  const [open, setOpen] = useState(false);
  const activeCount = [filters.branchId, filters.dateFrom, filters.dateTo, filters.reason].filter(Boolean).length;

  function reset() {
    setFilters({ branchId: "", dateFrom: "", dateTo: "", reason: "", search: "" });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("sales.filter.search")}
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            className="w-full pl-9 pr-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(o => !o)} className="relative shrink-0">
          <Filter className="w-4 h-4 mr-1" />
          {t("sales.filter.filters")}
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
              {activeCount}
            </span>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} className="shrink-0">
          <Download className="w-4 h-4 mr-1" />{t("sales.filter.exportCsv")}
        </Button>
        <Button variant="outline" size="sm" onClick={onExportPDF} className="shrink-0">
          <FileText className="w-4 h-4 mr-1" />{t("sales.filter.exportPdf")}
        </Button>
      </div>

      {open && (
        <div className="p-4 border border-border rounded-lg bg-secondary/30 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t("sales.filter.branch")}>
              <select className={inputClass} value={filters.branchId}
                onChange={e => setFilters(f => ({ ...f, branchId: e.target.value }))}>
                <option value="">{t("sales.filter.allBranches")}</option>
                {branches.map((b: any) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("sales.filter.fromDate")}>
              <input type="date" className={inputClass} value={filters.dateFrom}
                onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
            </Field>
            <Field label={t("sales.filter.toDate")}>
              <input type="date" className={inputClass} value={filters.dateTo}
                onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
            </Field>
            <Field label={t("sales.filter.reason")}>
              <select className={inputClass} value={filters.reason}
                onChange={e => setFilters(f => ({ ...f, reason: e.target.value }))}>
                <option value="">{t("sales.filter.allReasons")}</option>
                <option value="kitchen">{translateOption("kitchen", WASTE_REASON_KEYS, t)}</option>
                <option value="expiry">{translateOption("expiry", WASTE_REASON_KEYS, t)}</option>
                <option value="overproduction">{translateOption("overproduction", WASTE_REASON_KEYS, t)}</option>
                <option value="customer_return">{translateOption("customer_return", WASTE_REASON_KEYS, t)}</option>
                <option value="other">{translateOption("other", WASTE_REASON_KEYS, t)}</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {t("sales.filter.showing")} <span className="font-semibold text-foreground">{resultCount}</span>{" "}
              {resultCount === 1 ? t("sales.filter.result") : t("sales.filter.results")}
            </p>
            {activeCount > 0 && (
              <button onClick={reset} className="text-xs text-primary hover:underline">
                {t("sales.filter.clearAll")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalType = "sale" | "return" | "waste" | "damage" | "periodStatus" | null;

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Sales() {
  const currentUserId = Number(localStorage.getItem("user_id") ?? 1);
  const { language, toggleLanguage } = useLanguage();
  const t = useSalesText();
  const { toggleTheme, isDark } = useTheme();
  const currencyLabel = getCurrencyLabel(language);

  const branchFallback  = (id: number | string) => `${t("sales.table.branch")} #${id}`;
  const productFallback = (id: number | string) => `${t("sales.form.product")} #${id}`;
  const itemFallback    = (id: number | string) => `${t("sales.table.item")} #${id}`;
  const paymentLabel    = (v: string) => translateOption(v, PAYMENT_METHOD_KEYS, t);
  const statusLabel     = (v: string) => translateOption(v, SALE_STATUS_KEYS, t);
  const reasonLabel     = (v: string) => translateOption(v, WASTE_REASON_KEYS, t);

  // ── Period status ──
  const [period, setPeriod] = useState(currentPeriod);

  const { data: companyPeriodStatus, refetch: refetchPeriodStatus } =
    useApi<PeriodStatusRow>(() => getPeriodStatus(period), { deps: [period] });

  const selectedPeriodState  = companyPeriodStatus?.status ?? "open";
  const selectedPeriodClosed = selectedPeriodState === "closed" || selectedPeriodState === "locked";
  const selectedPeriodLocked = selectedPeriodState === "locked";

  // ── Data ──
  const { data: branches } = useApi(() => apiCall<any[]>("/api/branches"));
  const { data: products  } = useApi(() => apiCall<any[]>("/api/products"));

  const { data: salesRaw,  loading: salesLoading, refetch: refetchSales } =
    useApi(() => apiCall<any>("/api/sales"));
  const { data: wasteRaw, loading: wasteLoading, refetch: refetchWaste } =
    useApi(() => apiCall<any>("/api/waste"));

  const sales     = toArray(salesRaw);
  const wasteList = toArray(wasteRaw);

  // ── Expanded row state ──
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);

  // ── Modal state ──
  const [modal,           setModal]          = useState<ModalType>(null);
  const [saving,          setSaving]          = useState(false);
  const [formError,       setFormError]       = useState("");
  const [periodFormError, setPeriodFormError] = useState("");
  const [activeTab,       setActiveTab]       = useState<"sales" | "waste" | "damage">("sales");

  // ── Filters ──
  const [saleFilters, setSaleFilters] = useState<SaleFilters>({
    branchId: "", dateFrom: "", dateTo: "", paymentMethod: "", search: "", status: "",
  });
  const [wasteFilters, setWasteFilters] = useState<WasteFilters>({
    branchId: "", dateFrom: "", dateTo: "", reason: "", search: "",
  });

  // ── Pagination ──
  const [salePage,  setSalePage]  = useState(1);
  const [wastePage, setWastePage] = useState(1);
  const PAGE_SIZE = 25;

  // ── Sale form ──
  const [saleForm, setSaleForm] = useState({
    branch_id: 0, product_id: 0, entry_date: today(),
    quantity: 0, unit_price: 0, discount_amount: 0,
    promotion_amount: 0, tax_amount: 0,
    payment_method: "cash", receivable: 0, notes: "",
  });

  const [returnForm, setReturnForm] = useState({
    branch_id: 0, product_id: 0, entry_date: today(),
    quantity: 0, refund_amount: 0, notes: "",
  });

  const [wasteForm, setWasteForm] = useState({
    branch_id: 0, product_id: 0, entry_date: today(),
    quantity: 0, reason: "other", notes: "",
  });

  const [damageForm, setDamageForm] = useState({
    branch_id: 0, product_id: 0, entry_date: today(),
    quantity: 0, reason: "damage", notes: "",
  });

  // ── Filtered data ──
  const filteredSales = useMemo(() => {
    return sales.filter(row => {
      const rowDate = String(row.entry_date || "").slice(0, 10);
      if (saleFilters.branchId      && String(row.branch_id) !== saleFilters.branchId)   return false;
      if (saleFilters.dateFrom      && rowDate < saleFilters.dateFrom)                    return false;
      if (saleFilters.dateTo        && rowDate > saleFilters.dateTo)                      return false;
      if (saleFilters.paymentMethod && row.payment_method !== saleFilters.paymentMethod)  return false;
      if (saleFilters.status        && row.status !== saleFilters.status)                 return false;
      if (saleFilters.search) {
        const q = saleFilters.search.toLowerCase();
        // FIX #1: search against product_name (the actual API field), not item_name
        if (![row.product_name, row.branch_name, row.notes].join(" ").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [sales, saleFilters]);

  const filteredWaste = useMemo(() => {
    return wasteList.filter(row => {
      const rowDate = String(row.entry_date || "").slice(0, 10);
      if (wasteFilters.branchId && String(row.branch_id) !== wasteFilters.branchId) return false;
      if (wasteFilters.dateFrom && rowDate < wasteFilters.dateFrom)                  return false;
      if (wasteFilters.dateTo   && rowDate > wasteFilters.dateTo)                    return false;
      if (wasteFilters.reason   && row.reason !== wasteFilters.reason)               return false;
      if (wasteFilters.search) {
        const q = wasteFilters.search.toLowerCase();
        if (![row.item_name, row.product_name, row.ingredient_name, row.branch_name, row.notes]
          .join(" ").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [wasteList, wasteFilters]);

  const pagedSales      = filteredSales.slice((salePage  - 1) * PAGE_SIZE, salePage  * PAGE_SIZE);
  const pagedWaste      = filteredWaste.slice((wastePage - 1) * PAGE_SIZE, wastePage * PAGE_SIZE);
  const saleTotalPages  = Math.ceil(filteredSales.length / PAGE_SIZE);
  const wasteTotalPages = Math.ceil(filteredWaste.length / PAGE_SIZE);

  // ── Summary footer totals (FIX #5) ──
  const salesTotals = useMemo(() => ({
    qty:      filteredSales.reduce((s, r) => s + safeNum(r.quantity),        0),
    gross:    filteredSales.reduce((s, r) => s + safeNum(r.gross_amount),    0),
    discount: filteredSales.reduce((s, r) => s + safeNum(r.discount_amount), 0),
    tax:      filteredSales.reduce((s, r) => s + safeNum(r.tax_amount),      0),
    net:      filteredSales.reduce((s, r) => s + safeNum(r.net_amount),      0),
    receivable: filteredSales.reduce((s, r) => s + safeNum(r.receivable_amount), 0),
  }), [filteredSales]);

  // ── Stats ──
  const stats = useMemo(() => {
    const totalSales   = sales.reduce((s, r) => s + safeNum(r.net_amount),      0);
    const totalReturns = sales.reduce((s, r) => s + safeNum(r.discount_amount), 0);
    const totalWaste   = wasteList.reduce((s, r) => s + safeNum(r.cost_value),  0);

    const thisMonth = today().slice(0, 7);
    const lastMonthDate = new Date();
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonth = lastMonthDate.toISOString().slice(0, 7);

    const thisMonthSales = sales
      .filter(r => String(r.entry_date || "").slice(0, 7) === thisMonth)
      .reduce((s, r) => s + safeNum(r.net_amount), 0);
    const lastMonthSales = sales
      .filter(r => String(r.entry_date || "").slice(0, 7) === lastMonth)
      .reduce((s, r) => s + safeNum(r.net_amount), 0);

    const salesChange = lastMonthSales > 0
      ? Math.round(((thisMonthSales - lastMonthSales) / lastMonthSales) * 100)
      : thisMonthSales > 0 ? 100 : 0;

    const returnsPercent = totalSales > 0 ? ((totalReturns / totalSales) * 100).toFixed(1) : "0.0";
    const wastePercent   = totalSales > 0 ? ((totalWaste   / totalSales) * 100).toFixed(1) : "0.0";

    return { totalSales, totalReturns, totalWaste, salesChange, returnsPercent, wastePercent };
  }, [sales, wasteList]);

  // ── Auto-fill unit price ──
  function handleProductChange(productId: number) {
    const product = toArray(products).find((p: any) => p.id === productId);
    setSaleForm(f => ({
      ...f,
      product_id: productId,
      unit_price: product ? safeNum(product.sale_price) : 0,
    }));
  }

  const saleGross = safeNum(saleForm.quantity) * safeNum(saleForm.unit_price);
  const saleNet   = saleGross
    - safeNum(saleForm.discount_amount)
    - safeNum(saleForm.promotion_amount)
    + safeNum(saleForm.tax_amount);

  const WRITE_MODALS: ModalType[] = ["sale", "return", "waste", "damage"];
  function openModal(type: ModalType) {
    if (selectedPeriodClosed && type && WRITE_MODALS.includes(type)) return;
    setFormError(""); setPeriodFormError("");
    setModal(type);
  }

  function refetchAll() {
    refetchSales?.();
    refetchWaste?.();
    refetchPeriodStatus?.();
  }

  // ── Period status save ──
  async function handleSavePeriodStatus(status: PeriodStatusValue, notes: string) {
    setSaving(true); setPeriodFormError("");
    try {
      await setPeriodStatus({ period, status, notes });
      setModal(null);
      refetchPeriodStatus?.();
    } catch {
      setPeriodFormError("Could not update period status");
    }
    setSaving(false);
  }

  // ── Export handlers ──
  function handleExportSales() {
    exportToCSV(filteredSales.map(r => ({
      [t("sales.table.date")]:                                String(r.entry_date).slice(0, 10),
      [t("sales.table.branch")]:                              r.branch_name ?? branchFallback(r.branch_id),
      // FIX #1 in CSV export: use product_name
      [t("sales.table.item")]:                                r.product_name ?? productFallback(r.product_id),
      [t("sales.table.quantity")]:                            safeNum(r.quantity).toFixed(2),
      [`${t("sales.table.unitPrice")} (${currencyLabel})`]:   safeNum(r.unit_price).toFixed(2),
      [`${t("sales.table.gross")} (${currencyLabel})`]:       safeNum(r.gross_amount).toFixed(2),
      [`${t("sales.table.discount")} (${currencyLabel})`]:    safeNum(r.discount_amount).toFixed(2),
      [`${t("sales.table.tax")} (${currencyLabel})`]:         safeNum(r.tax_amount).toFixed(2),
      [`${t("sales.table.net")} (${currencyLabel})`]:         safeNum(r.net_amount).toFixed(2),
      [`${t("sales.table.receivable")} (${currencyLabel})`]:  safeNum(r.receivable_amount).toFixed(2),
      [t("sales.table.payment")]:                             paymentLabel(r.payment_method),
      [t("sales.table.status")]:                              statusLabel(r.status),
      [t("sales.form.notes")]:                                r.notes ?? "",
    })), `sales_export_${today()}.csv`);
  }

  function handleExportSalesPDF() {
    const rows = filteredSales.map(r => ({
      [t("sales.table.date")]:                             String(r.entry_date).slice(0, 10),
      [t("sales.table.branch")]:                           r.branch_name ?? branchFallback(r.branch_id),
      // FIX #1 in PDF export: use product_name
      [t("sales.table.item")]:                             r.product_name ?? productFallback(r.product_id),
      [t("sales.table.qty")]:                              safeNum(r.quantity).toFixed(2),
      [`${t("sales.table.unitPrice")} (${currencyLabel})`]: safeNum(r.unit_price).toFixed(2),
      [`${t("sales.table.gross")} (${currencyLabel})`]:    safeNum(r.gross_amount).toFixed(2),
      [`${t("sales.table.discount")} (${currencyLabel})`]: safeNum(r.discount_amount).toFixed(2),
      [`${t("sales.table.tax")} (${currencyLabel})`]:      safeNum(r.tax_amount).toFixed(2),
      [`${t("sales.table.net")} (${currencyLabel})`]:      safeNum(r.net_amount).toFixed(2),
      [`${t("sales.table.receivable")} (${currencyLabel})`]: safeNum(r.receivable_amount).toFixed(2),
      [t("sales.table.payment")]:                          paymentLabel(r.payment_method),
      [t("sales.table.status")]:                           statusLabel(r.status),
    }));
    const parts: string[] = [];
    if (saleFilters.dateFrom || saleFilters.dateTo)
      parts.push(`Date: ${saleFilters.dateFrom || "—"} to ${saleFilters.dateTo || "—"}`);
    if (saleFilters.branchId) {
      const b = toArray(branches).find((x: any) => String(x.id) === saleFilters.branchId);
      if (b) parts.push(`Branch: ${b.name}`);
    }
    if (saleFilters.paymentMethod) parts.push(`Payment: ${saleFilters.paymentMethod}`);
    if (saleFilters.status)        parts.push(`Status: ${saleFilters.status}`);
    exportToPDF(rows, "Sales Report", parts.length ? parts.join("  ·  ") : undefined);
  }

  function handleExportWaste() {
    exportToCSV(filteredWaste.map(r => ({
      Date:     String(r.entry_date).slice(0, 10),
      Branch:   r.branch_name ?? `Branch #${r.branch_id}`,
      Item:     r.item_name ?? r.product_name ?? r.ingredient_name ?? `Item #${r.product_id ?? r.ingredient_id}`,
      Quantity: safeNum(r.quantity).toFixed(3),
      Unit:     r.unit ?? "",
      Reason:   r.reason,
      [`${t("sales.table.costValue")} (${currencyLabel})`]: safeNum(r.cost_value).toFixed(2),
      Notes:    r.notes ?? "",
    })), `waste_export_${today()}.csv`);
  }

  function handleExportWastePDF() {
    const rows = filteredWaste.map(r => ({
      Date:     String(r.entry_date).slice(0, 10),
      Branch:   r.branch_name ?? `Branch #${r.branch_id}`,
      Item:     r.item_name ?? r.product_name ?? r.ingredient_name ?? `Item #${r.product_id ?? r.ingredient_id}`,
      Quantity: `${safeNum(r.quantity).toFixed(3)} ${r.unit ?? ""}`.trim(),
      Reason:   r.reason,
      [`${t("sales.table.costValue")} (${currencyLabel})`]: safeNum(r.cost_value).toFixed(2),
    }));
    const parts: string[] = [];
    if (wasteFilters.dateFrom || wasteFilters.dateTo)
      parts.push(`Date: ${wasteFilters.dateFrom || "—"} to ${wasteFilters.dateTo || "—"}`);
    if (wasteFilters.branchId) {
      const b = toArray(branches).find((x: any) => String(x.id) === wasteFilters.branchId);
      if (b) parts.push(`Branch: ${b.name}`);
    }
    if (wasteFilters.reason) parts.push(`Reason: ${wasteFilters.reason}`);
    exportToPDF(rows, "Waste Report", parts.length ? parts.join("  ·  ") : undefined);
  }

  // ── Save handlers ──
  async function handleSaveSale() {
    if (!saleForm.branch_id)  { setFormError(t("sales.form.branchRequired"));    return; }
    if (!saleForm.product_id) { setFormError(t("sales.form.productRequired"));   return; }
    if (!saleForm.quantity)   { setFormError(t("sales.form.quantityRequired"));  return; }
    if (!saleForm.unit_price) { setFormError(t("sales.form.unitPriceRequired")); return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/sales", { method: "POST", body: JSON.stringify({ ...saleForm, user_id: currentUserId }) });
      setModal(null);
      setSaleForm({ branch_id: 0, product_id: 0, entry_date: today(), quantity: 0, unit_price: 0, discount_amount: 0, promotion_amount: 0, tax_amount: 0, payment_method: "cash", receivable: 0, notes: "" });
      refetchAll();
    } catch (err: any) {
      setFormError(err?.detail?.error ?? err?.message ?? t("sales.form.saveSaleFailed"));
    } finally { setSaving(false); }
  }

  async function handleSaveReturn() {
    if (!returnForm.branch_id)  { setFormError(t("sales.form.branchRequired"));   return; }
    if (!returnForm.product_id) { setFormError(t("sales.form.productRequired"));  return; }
    if (!returnForm.quantity)   { setFormError(t("sales.form.quantityRequired")); return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/sales/returns", { method: "POST", body: JSON.stringify({ ...returnForm, user_id: currentUserId }) });
      setModal(null);
      setReturnForm({ branch_id: 0, product_id: 0, entry_date: today(), quantity: 0, refund_amount: 0, notes: "" });
      refetchAll();
    } catch (err: any) {
      setFormError(err?.detail?.error ?? err?.message ?? t("sales.form.saveReturnFailed"));
    } finally { setSaving(false); }
  }

  async function handleSaveWaste() {
    if (!wasteForm.branch_id)  { setFormError(t("sales.form.branchRequired"));   return; }
    if (!wasteForm.product_id) { setFormError(t("sales.form.productRequired"));  return; }
    if (!wasteForm.quantity)   { setFormError(t("sales.form.quantityRequired")); return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/waste", { method: "POST", body: JSON.stringify({ ...wasteForm, user_id: currentUserId }) });
      setModal(null);
      setWasteForm({ branch_id: 0, product_id: 0, entry_date: today(), quantity: 0, reason: "other", notes: "" });
      refetchAll();
    } catch (err: any) {
      setFormError(err?.detail?.error ?? err?.message ?? t("sales.form.saveWasteFailed"));
    } finally { setSaving(false); }
  }

  async function handleSaveDamage() {
    if (!damageForm.branch_id)  { setFormError(t("sales.form.branchRequired"));   return; }
    if (!damageForm.product_id) { setFormError(t("sales.form.productRequired"));  return; }
    if (!damageForm.quantity)   { setFormError(t("sales.form.quantityRequired")); return; }
    setSaving(true); setFormError("");
    try {
      await apiCall("/api/damage", { method: "POST", body: JSON.stringify({ ...damageForm, user_id: currentUserId }) });
      setModal(null);
      setDamageForm({ branch_id: 0, product_id: 0, entry_date: today(), quantity: 0, reason: "damage", notes: "" });
      refetchAll();
    } catch (err: any) {
      setFormError(err?.detail?.error ?? err?.message ?? t("sales.form.saveDamageFailed"));
    } finally { setSaving(false); }
  }

  // ── Pagination component ──
  function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {t("sales.pagination.page")} {page} {t("sales.pagination.of")} {totalPages}
        </p>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPage(page - 1)}>←</Button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const p = totalPages <= 7 ? i + 1 : page <= 4 ? i + 1 : page + i - 3;
            if (p < 1 || p > totalPages) return null;
            return (
              <Button key={p} variant={p === page ? "default" : "outline"} size="sm" onClick={() => onPage(p)}>
                {p}
              </Button>
            );
          })}
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => onPage(page + 1)}>→</Button>
        </div>
      </div>
    );
  }

  // TABLE_COLS = 12: expand-toggle | date | branch | item | qty | unit price | gross | discount | tax | net | receivable | payment | status
  const TABLE_COLS = 13;

  // ── Render ──
  return (
    <div className="space-y-6">

      {/* ── Period Status Modal ── */}
      {modal === "periodStatus" && (
        <PeriodStatusModal
          period={period}
          setPeriod={setPeriod}
          currentStatus={selectedPeriodState}
          onClose={() => setModal(null)}
          onSave={handleSavePeriodStatus}
          saving={saving}
          formError={periodFormError}
        />
      )}

      {/* ── Sale Modal ── */}
      {modal === "sale" && (
        <Modal title="💰 Record Sale" onClose={() => setModal(null)} onSave={handleSaveSale} saving={saving}>
          {formError && (
            <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" />{formError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.branch")} *`}>
              <select className={inputClass} value={saleForm.branch_id || ""}
                onChange={e => setSaleForm({ ...saleForm, branch_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(branches).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={`${t("sales.form.product")} *`}>
              <select className={inputClass} value={saleForm.product_id || ""}
                onChange={e => handleProductChange(Number(e.target.value))}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(products).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.date")} *`}>
              <input type="date" className={inputClass} value={saleForm.entry_date}
                onChange={e => setSaleForm({ ...saleForm, entry_date: e.target.value })} />
            </Field>
            <Field label={`${t("sales.form.quantity")} *`}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0" value={saleForm.quantity || ""}
                onChange={e => setSaleForm({ ...saleForm, quantity: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.unitPrice")} (${currencyLabel}) *`}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00" value={saleForm.unit_price || ""}
                onChange={e => setSaleForm({ ...saleForm, unit_price: Number(e.target.value) })} />
            </Field>
            <Field label={t("sales.form.paymentMethod")}>
              <select className={inputClass} value={saleForm.payment_method}
                onChange={e => setSaleForm({ ...saleForm, payment_method: e.target.value })}>
                <option value="cash">{paymentLabel("cash")}</option>
                <option value="bank">{paymentLabel("bank")}</option>
                <option value="credit">{paymentLabel("credit")}</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={`${t("sales.form.discount")} (${currencyLabel})`}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00" value={saleForm.discount_amount || ""}
                onChange={e => setSaleForm({ ...saleForm, discount_amount: Number(e.target.value) })} />
            </Field>
            <Field label={`${t("sales.form.promotion")} (${currencyLabel})`}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00" value={saleForm.promotion_amount || ""}
                onChange={e => setSaleForm({ ...saleForm, promotion_amount: Number(e.target.value) })} />
            </Field>
            <Field label={`${t("sales.form.tax")} (${currencyLabel})`}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00" value={saleForm.tax_amount || ""}
                onChange={e => setSaleForm({ ...saleForm, tax_amount: Number(e.target.value) })} />
            </Field>
          </div>
          {saleForm.quantity > 0 && saleForm.unit_price > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900/60 dark:bg-green-950/25">
              <div>
                <p className="text-xs text-muted-foreground">{t("sales.form.grossAmount")}</p>
                <p className="font-semibold text-foreground">{fmt(saleGross)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("sales.form.netAmount")}</p>
                <p className="font-bold text-green-700 dark:text-green-300">{fmt(saleNet)}</p>
              </div>
            </div>
          )}
          <Field label={t("sales.form.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("sales.form.notesPlaceholder")}
              value={saleForm.notes}
              onChange={e => setSaleForm({ ...saleForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {/* ── Return Modal ── */}
      {modal === "return" && (
        <Modal title="↩️ Customer Return" onClose={() => setModal(null)} onSave={handleSaveReturn} saving={saving}>
          {formError && (
            <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" />{formError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.branch")} *`}>
              <select className={inputClass} value={returnForm.branch_id || ""}
                onChange={e => setReturnForm({ ...returnForm, branch_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(branches).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={`${t("sales.form.product")} *`}>
              <select className={inputClass} value={returnForm.product_id || ""}
                onChange={e => setReturnForm({ ...returnForm, product_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(products).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.date")} *`}>
              <input type="date" className={inputClass} value={returnForm.entry_date}
                onChange={e => setReturnForm({ ...returnForm, entry_date: e.target.value })} />
            </Field>
            <Field label={`${t("sales.form.quantity")} *`}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0" value={returnForm.quantity || ""}
                onChange={e => setReturnForm({ ...returnForm, quantity: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={`${t("sales.form.refundAmount")} (${currencyLabel})`}>
            <input type="number" min={0} step={0.01} className={inputClass}
              placeholder="0.00" value={returnForm.refund_amount || ""}
              onChange={e => setReturnForm({ ...returnForm, refund_amount: Number(e.target.value) })} />
          </Field>
          <Field label={t("sales.form.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("sales.form.returnReasonPlaceholder")}
              value={returnForm.notes}
              onChange={e => setReturnForm({ ...returnForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {/* ── Waste Modal ── */}
      {modal === "waste" && (
        <Modal title="🗑️ Log Waste" onClose={() => setModal(null)} onSave={handleSaveWaste} saving={saving}>
          {formError && (
            <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" />{formError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.branch")} *`}>
              <select className={inputClass} value={wasteForm.branch_id || ""}
                onChange={e => setWasteForm({ ...wasteForm, branch_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(branches).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={`${t("sales.form.product")} *`}>
              <select className={inputClass} value={wasteForm.product_id || ""}
                onChange={e => setWasteForm({ ...wasteForm, product_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(products).map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.date")} *`}>
              <input type="date" className={inputClass} value={wasteForm.entry_date}
                onChange={e => setWasteForm({ ...wasteForm, entry_date: e.target.value })} />
            </Field>
            <Field label={`${t("sales.form.quantity")} *`}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0.000" value={wasteForm.quantity || ""}
                onChange={e => setWasteForm({ ...wasteForm, quantity: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("sales.form.reason")}>
            <select className={inputClass} value={wasteForm.reason}
              onChange={e => setWasteForm({ ...wasteForm, reason: e.target.value })}>
              <option value="kitchen">{reasonLabel("kitchen")}</option>
              <option value="expiry">{reasonLabel("expiry")}</option>
              <option value="overproduction">{reasonLabel("overproduction")}</option>
              <option value="customer_return">{reasonLabel("customer_return")}</option>
              <option value="other">{reasonLabel("other")}</option>
            </select>
          </Field>
          <Field label={t("sales.form.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("sales.form.wasteNotesPlaceholder")}
              value={wasteForm.notes}
              onChange={e => setWasteForm({ ...wasteForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {/* ── Damage Modal ── */}
      {modal === "damage" && (
        <Modal title="⚠️ Log Damage" onClose={() => setModal(null)} onSave={handleSaveDamage} saving={saving}>
          {formError && (
            <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3 h-3" />{formError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.branch")} *`}>
              <select className={inputClass} value={damageForm.branch_id || ""}
                onChange={e => setDamageForm({ ...damageForm, branch_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(branches).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={`${t("sales.form.product")} *`}>
              <select className={inputClass} value={damageForm.product_id || ""}
                onChange={e => setDamageForm({ ...damageForm, product_id: Number(e.target.value) })}>
                <option value="">{t("sales.form.select")}</option>
                {toArray(products).map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("sales.form.date")} *`}>
              <input type="date" className={inputClass} value={damageForm.entry_date}
                onChange={e => setDamageForm({ ...damageForm, entry_date: e.target.value })} />
            </Field>
            <Field label={`${t("sales.form.quantity")} *`}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0.000" value={damageForm.quantity || ""}
                onChange={e => setDamageForm({ ...damageForm, quantity: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("sales.form.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("sales.form.damageNotesPlaceholder")}
              value={damageForm.notes}
              onChange={e => setDamageForm({ ...damageForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-primary">{t("sales.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("sales.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="month"
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-36"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => openModal("sale")}
            disabled={selectedPeriodClosed}
            title={selectedPeriodLocked ? "Period is locked" : selectedPeriodClosed ? "Period is closed" : undefined}
          >
            {selectedPeriodClosed ? <Lock className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
            {t("sales.recordSale")}
          </Button>
        </div>
      </div>

      {/* ── Period closed / locked banner ── */}
      {selectedPeriodClosed && (
        <Card className={`${selectedPeriodLocked ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20" : "border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20"} p-4`}>
          <p className={`flex items-center gap-2 text-sm ${selectedPeriodLocked ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <Lock className="h-4 w-4" />
            {selectedPeriodLocked
              ? `${period} is locked for the whole company. No sales entries are allowed.`
              : `${period} is closed for the whole company. Sales entries are restricted.`}
          </p>
        </Card>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6">
          <p className="text-sm font-medium text-muted-foreground">{t("sales.totalSales")}</p>
          {salesLoading
            ? <div className="h-9 bg-secondary/50 rounded mt-2 animate-pulse" />
            : <p className="text-3xl font-bold text-primary mt-2">{fmt(stats.totalSales)}</p>
          }
          <div className="flex items-center gap-1 mt-2">
            {stats.salesChange >= 0
              ? <TrendingUp  className="w-4 h-4 text-green-600 dark:text-green-400" />
              : <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
            }
            <span className={`text-xs ${stats.salesChange >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {stats.salesChange >= 0 ? "+" : ""}{stats.salesChange}% {t("sales.vsLastMonth")}
            </span>
          </div>
        </Card>
        <Card className="p-6">
          <p className="text-sm font-medium text-muted-foreground">{t("sales.discounts")}</p>
          {salesLoading
            ? <div className="h-9 bg-secondary/50 rounded mt-2 animate-pulse" />
            : <p className="mt-2 text-3xl font-bold text-amber-600 dark:text-amber-400">{fmt(stats.totalReturns)}</p>
          }
          <p className="text-xs text-muted-foreground mt-2">{stats.returnsPercent}% {t("sales.ofSales")}</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm font-medium text-muted-foreground">{t("sales.wasteCost")}</p>
          {wasteLoading
            ? <div className="h-9 bg-secondary/50 rounded mt-2 animate-pulse" />
            : <p className="mt-2 text-3xl font-bold text-red-600 dark:text-red-400">{fmt(stats.totalWaste)}</p>
          }
          <p className="text-xs text-muted-foreground mt-2">{stats.wastePercent}% {t("sales.ofSales")}</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm font-medium text-muted-foreground">{t("sales.transactions")}</p>
          {salesLoading
            ? <div className="h-9 bg-secondary/50 rounded mt-2 animate-pulse" />
            : <p className="text-3xl font-bold text-primary mt-2">{sales.length}</p>
          }
          <p className="text-xs text-muted-foreground mt-2">{t("sales.totalRecorded")}</p>
        </Card>
      </div>

      {/* ── Quick Actions ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t("sales.recordSale"),     icon: "💰", type: "sale"   as ModalType, color: "bg-green-50 border-green-200 hover:border-green-400 dark:bg-green-950/20 dark:border-green-900/50 dark:hover:border-green-700"      },
          { label: t("sales.customerReturn"), icon: "↩️", type: "return" as ModalType, color: "bg-amber-50 border-amber-200 hover:border-amber-400 dark:bg-amber-950/20 dark:border-amber-900/50 dark:hover:border-amber-700"      },
          { label: t("sales.logWaste"),       icon: "🗑️", type: "waste"  as ModalType, color: "bg-red-50 border-red-200 hover:border-red-400 dark:bg-red-950/20 dark:border-red-900/50 dark:hover:border-red-700"                 },
          { label: t("sales.logDamage"),      icon: "⚠️", type: "damage" as ModalType, color: "bg-orange-50 border-orange-200 hover:border-orange-400 dark:bg-orange-950/20 dark:border-orange-900/50 dark:hover:border-orange-700" },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => openModal(item.type)}
              disabled={selectedPeriodClosed}
              title={selectedPeriodLocked ? "Period is locked" : selectedPeriodClosed ? "Period is closed" : undefined}
              className={`p-4 rounded-lg border-2 transition-colors text-left ${item.color} ${
                selectedPeriodClosed ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              <span className="text-2xl">{selectedPeriodClosed ? "🔒" : item.icon}</span>
              <p className="text-sm font-medium text-foreground mt-2">{item.label}</p>
            </button>
          ))}
      </div>

      {/* ── Recent Activity ── */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{t("sales.recentActivity")}</h2>
          <div className="flex gap-2">
            {(["sales", "waste", "damage"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}>
                {tab === "sales" ? t("sales.tab.sales") : tab === "waste" ? t("sales.tab.waste") : t("sales.tab.damage")}
              </button>
            ))}
          </div>
        </div>

        {/* ══ Sales Tab ══ */}
        {activeTab === "sales" && (
          salesLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-secondary/50 rounded animate-pulse" />)}</div>
          ) : !sales.length ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("sales.noSales")}</p>
              <Button size="sm" className="mt-3" onClick={() => openModal("sale")} disabled={selectedPeriodClosed}>
                <Plus className="w-4 h-4 mr-1" /> {t("sales.recordFirstSale")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <FilterBar
                filters={saleFilters}
                setFilters={f => { setSaleFilters(f as SaleFilters); setSalePage(1); }}
                branches={toArray(branches)}
                onExport={handleExportSales}
                onExportPDF={handleExportSalesPDF}
                resultCount={filteredSales.length}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary">
                    <tr>
                      {/* expand toggle col */}
                      <th className="w-8 px-2 py-2" />
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.date")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.branch")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.item")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.qty")}</th>
                      {/* FIX #4: Unit Price column */}
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.unitPrice")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.gross")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.discount")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.tax")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.net")}</th>
                      {/* FIX #7: Receivable column */}
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.receivable")}</th>
                      <th className="px-4 py-2 text-center font-semibold">{t("sales.table.payment")}</th>
                      <th className="px-4 py-2 text-center font-semibold">{t("sales.table.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedSales.length === 0 ? (
                      <tr>
                        <td colSpan={TABLE_COLS} className="px-4 py-10 text-center text-muted-foreground text-sm">
                          {t("sales.table.noResults")}
                        </td>
                      </tr>
                    ) : pagedSales.map((row: any, i: number) => {
                      const isExpanded = expandedRowId === row.id;
                      // FIX #6: color-coded net by status
                      const netClass = row.status === "approved"
                        ? "text-green-700 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400";
                      const receivable = safeNum(row.receivable_amount);

                      return (
                        <>
                          {/* ── Main row ── */}
                          <tr
                            key={`row-${row.id ?? i}`}
                            className={`border-b border-border transition-colors cursor-pointer select-none ${
                              isExpanded
                                ? "bg-secondary/70"
                                : "hover:bg-secondary/50"
                            }`}
                            onClick={() => setExpandedRowId(isExpanded ? null : (row.id ?? i))}
                          >
                            {/* Expand toggle */}
                            <td className="w-8 px-2 py-3 text-muted-foreground">
                              {isExpanded
                                ? <ChevronUp className="w-4 h-4" />
                                : <ChevronDown className="w-4 h-4" />
                              }
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">{String(row.entry_date).slice(0, 10)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{row.branch_name ?? branchFallback(row.branch_id)}</td>
                            {/* FIX #1: product_name instead of item_name */}
                            <td className="px-4 py-3 font-medium">{row.product_name ?? productFallback(row.product_id)}</td>
                            <td className="px-4 py-3 text-right">{safeNum(row.quantity).toFixed(2)}</td>
                            {/* FIX #4: unit_price cell */}
                            <td className="px-4 py-3 text-right text-muted-foreground">{fmt(safeNum(row.unit_price))}</td>
                            <td className="px-4 py-3 text-right">{fmt(safeNum(row.gross_amount))}</td>
                            <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400">{fmt(safeNum(row.discount_amount))}</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{fmt(safeNum(row.tax_amount))}</td>
                            {/* FIX #6: color-coded net */}
                            <td className={`px-4 py-3 text-right font-semibold ${netClass}`}>{fmt(safeNum(row.net_amount))}</td>
                            {/* FIX #7: receivable cell */}
                            <td className="px-4 py-3 text-right">
                              {receivable > 0
                                ? <span className="font-medium text-orange-600 dark:text-orange-400">{fmt(receivable)}</span>
                                : <span className="text-muted-foreground/40">—</span>
                              }
                            </td>
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium capitalize text-blue-700 dark:bg-blue-950/35 dark:text-blue-300">
                                {paymentLabel(row.payment_method)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                row.status === "approved"
                                  ? "bg-green-100 text-green-700 dark:bg-green-950/35 dark:text-green-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"
                              }`}>
                                {statusLabel(row.status)}
                              </span>
                            </td>
                          </tr>

                          {/* FIX #2: Expandable detail row ── */}
                          {isExpanded && (
                            <tr key={`expand-${row.id ?? i}`} className="bg-secondary/30 border-b border-border">
                              <td colSpan={TABLE_COLS} className="px-6 py-4">
                                <div className="flex flex-wrap items-start gap-6">
                                  {/* Detail chips */}
                                  <div className="flex flex-wrap gap-4 flex-1 min-w-0">
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                        {t("sales.expand.unitPrice")}
                                      </p>
                                      <p className="text-sm font-medium text-foreground">{fmt(safeNum(row.unit_price))}</p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                        {t("sales.expand.promotion")}
                                      </p>
                                      <p className="text-sm font-medium text-foreground">{fmt(safeNum(row.promotion_amount))}</p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                        {t("sales.expand.receivable")}
                                      </p>
                                      <p className={`text-sm font-medium ${receivable > 0 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}>
                                        {receivable > 0 ? fmt(receivable) : "—"}
                                      </p>
                                    </div>
                                    {row.notes && (
                                      <div className="min-w-[160px]">
                                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                                          {t("sales.expand.notes")}
                                        </p>
                                        <p className="text-sm text-foreground/80 leading-snug">{row.notes}</p>
                                      </div>
                                    )}
                                  </div>

                                  {/* FIX #3: Single-sale PDF download button */}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0 gap-1.5"
                                    onClick={e => {
                                      e.stopPropagation();
                                      exportSingleSalePDF(row, currencyLabel, paymentLabel, statusLabel);
                                    }}
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                    {t("sales.expand.downloadPdf")}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>

                  {/* FIX #5: Summary footer row */}
                  {filteredSales.length > 0 && (
                    <tfoot>
                      <tr className="bg-secondary border-t-2 border-border font-semibold text-sm">
                        <td className="w-8 px-2 py-2" />
                        <td colSpan={3} className="px-4 py-2 text-muted-foreground text-xs uppercase tracking-wide">
                          {t("sales.table.totals")} ({filteredSales.length})
                        </td>
                        <td className="px-4 py-2 text-right">{salesTotals.qty.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">—</td>
                        <td className="px-4 py-2 text-right">{fmt(salesTotals.gross)}</td>
                        <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">{fmt(salesTotals.discount)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{fmt(salesTotals.tax)}</td>
                        <td className="px-4 py-2 text-right text-green-700 dark:text-green-400">{fmt(salesTotals.net)}</td>
                        <td className="px-4 py-2 text-right text-orange-600 dark:text-orange-400">
                          {salesTotals.receivable > 0 ? fmt(salesTotals.receivable) : "—"}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <Pagination page={salePage} totalPages={saleTotalPages} onPage={setSalePage} />
            </div>
          )
        )}

        {/* ══ Waste Tab ══ */}
        {activeTab === "waste" && (
          wasteLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-secondary/50 rounded animate-pulse" />)}</div>
          ) : !wasteList.length ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("sales.noWaste")}</p>
              <Button size="sm" className="mt-3" onClick={() => openModal("waste")} disabled={selectedPeriodClosed}>
              <Plus className="w-4 h-4 mr-1" /> {t("sales.logWaste")}
            </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <WasteFilterBar
                filters={wasteFilters}
                setFilters={f => { setWasteFilters(f as WasteFilters); setWastePage(1); }}
                branches={toArray(branches)}
                onExport={handleExportWaste}
                onExportPDF={handleExportWastePDF}
                resultCount={filteredWaste.length}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.date")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.branch")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.item")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.quantity")}</th>
                      <th className="px-4 py-2 text-left font-semibold">{t("sales.table.reason")}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t("sales.table.costValue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWaste.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">{t("sales.table.noResults")}</td></tr>
                    ) : pagedWaste.map((row: any, i: number) => (
                      <tr key={i} className="border-b border-border hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-3">{String(row.entry_date).slice(0, 10)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.branch_name ?? branchFallback(row.branch_id)}</td>
                        <td className="px-4 py-3 font-medium">{row.item_name ?? row.product_name ?? row.ingredient_name ?? itemFallback(row.product_id ?? row.ingredient_id)}</td>
                        <td className="px-4 py-3 text-right">{safeNum(row.quantity).toFixed(3)} {row.unit ?? ""}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs capitalize text-red-700 dark:bg-red-950/35 dark:text-red-300">
                            {reasonLabel(row.reason)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">{fmt(safeNum(row.cost_value))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={wastePage} totalPages={wasteTotalPages} onPage={setWastePage} />
            </div>
          )
        )}

        {/* ══ Damage Tab ══ */}
        {activeTab === "damage" && (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground mb-3">{t("sales.damageHint")}</p>
            <Button size="sm" onClick={() => openModal("damage")} disabled={selectedPeriodClosed}>
              <Plus className="w-4 h-4 mr-1" /> {t("sales.logDamage")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}