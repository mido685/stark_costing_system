// import { useState, useEffect, useCallback, useRef } from "react";
// import { useSearch } from "wouter";
// import { Card } from "@/components/ui/card";
// import { Button } from "@/components/ui/button";
// import {
//   Plus, X, Building2, Package, Truck, Users,
//   ChevronRight, Loader2, AlertCircle, DollarSign,
//   FileDown, History, TrendingUp, TrendingDown, Minus, Lock,
//   Search, ChevronLeft, Eye, Phone, Mail, MapPin, Globe,
//   Tag, Upload, Pencil, Activity, CheckCircle,
// } from "lucide-react";
// import { useApi } from "@/hooks/useApi";
// import { useCachedQuery, readCachedQuery, writeCachedQuery } from "@/hooks/useCachedQuery";
// import {
//   getBranches, getSuppliers, getItems, getUsers,
//   addBranch, addSupplier, addItem, addUser,
//   deleteSupplier, deleteBranch, deleteItem, apiCall,
//   getSkuPrefixes, addSkuPrefix, deleteSkuPrefix, seedSkuPrefixes,
//   type SkuPrefixRow,
// } from "@/lib/api";
// import type { Branch, UserRow, ItemRow, SupplierRow } from "@/lib/api";
// import { useLanguage } from "@/contexts/LanguageContext";
// import { formatCurrency, getCurrencyLabel } from "@/lib/localization";
// import { apiUpload, assetUrl } from "@/lib/api";
// import { useWorkingPeriod } from "@/contexts/Workingperiodcontext";   // make sure useEffect is imported
// import { invalidateCachedQueries } from "@/hooks/useCachedQuery";
// import { invalidateApiCache } from "@/hooks/useApi";
// // Shared cache implementation lives in @/hooks/useCachedQuery.
// const MASTER_CACHE_TTL = 5 * 60_000;

// // ─── Types ────────────────────────────────────────────────────────────────────

// type ModalType = "branch" | "supplier" | "item" | "editItem" | "user" | "price" | null;
// type Tab = "branches" | "suppliers" | "items" | "users" | "prices" | "skuPrefixes";

// interface PriceHistoryRow {
//   id:           number;
//   purchase_date: string;      // was entry_date
//   supplier_name: string;
//   price:         number;
//   price_type:    "initial_cost" | "market_price" | "contract_price" | "spot_price" | null;
//   status:        "pending" | "approved" | "rejected";
//   notes:         string;
// }

// interface IngredientOption {
//   id:            number;
//   name:          string;
//   unit:          string;
//   cost_per_unit: number;
// }

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// function today() {
//   return new Date().toISOString().split("T")[0];
// }

// const inputClass =
//   "w-full px-3 py-2 rounded-md border border-input bg-background text-sm " +
//   "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

// const labelClass = "block text-xs font-medium text-muted-foreground mb-1";

// function Field({ label, children }: { label: string; children: React.ReactNode }) {
//   return (
//     <div>
//       <label className={labelClass}>{label}</label>
//       {children}
//     </div>
//   );
// }

// function localNumber(value: number | null | undefined, fallback: number) {
//   return String(value ?? fallback).padStart(5, "0");
// }

// // ─── Supplier Categories ──────────────────────────────────────────────────────

// const SUPPLIER_CATEGORIES = [
//   "Food & Ingredients", "Beverages", "Dairy", "Meat & Poultry",
//   "Seafood", "Bakery", "Frozen Goods", "Dry Goods",
//   "Packaging", "Equipment", "Cleaning & Hygiene", "General",
// ] as const;

// function supplierCatColor(category: string | null | undefined) {
//   switch (category) {
//     case "Food & Ingredients": return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
//     case "Beverages":          return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
//     case "Dairy":              return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400";
//     case "Meat & Poultry":     return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
//     case "Seafood":            return "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400";
//     case "Bakery":             return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
//     case "Frozen Goods":       return "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400";
//     case "Dry Goods":          return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
//     case "Packaging":          return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
//     case "Equipment":          return "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400";
//     case "Cleaning & Hygiene": return "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400";
//     default:                   return "bg-secondary text-muted-foreground";
//   }
// }

// // ─── Country Phone Config ─────────────────────────────────────────────────────

// interface CountryPhone {
//   code: string; name: string; dialCode: string;
//   pattern: RegExp; placeholder: string; example: string;
// }

// const COUNTRY_PHONES: CountryPhone[] = [
//   { code: "EG", name: "Egypt",        dialCode: "+20",  pattern: /^1[0-9]{9}$/,      placeholder: "1xxxxxxxxx",   example: "+20 10 1234 5678"  },
//   { code: "SA", name: "Saudi Arabia", dialCode: "+966", pattern: /^5[0-9]{8}$/,      placeholder: "5xxxxxxxx",    example: "+966 50 123 4567"  },
//   { code: "AE", name: "UAE",          dialCode: "+971", pattern: /^5[0-9]{8}$/,      placeholder: "5xxxxxxxx",    example: "+971 50 123 4567"  },
//   { code: "JO", name: "Jordan",       dialCode: "+962", pattern: /^7[789][0-9]{7}$/, placeholder: "7xxxxxxxx",    example: "+962 79 123 4567"  },
//   { code: "KW", name: "Kuwait",       dialCode: "+965", pattern: /^[569][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+965 5123 4567"    },
//   { code: "QA", name: "Qatar",        dialCode: "+974", pattern: /^[357][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+974 3312 3456"    },
//   { code: "BH", name: "Bahrain",      dialCode: "+973", pattern: /^[369][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+973 3612 3456"    },
//   { code: "OM", name: "Oman",         dialCode: "+968", pattern: /^[79][0-9]{7}$/,   placeholder: "xxxxxxxx",     example: "+968 9912 3456"    },
//   { code: "LB", name: "Lebanon",      dialCode: "+961", pattern: /^[37][0-9]{7}$/,   placeholder: "xxxxxxxx",     example: "+961 3123 4567"    },
//   { code: "IQ", name: "Iraq",         dialCode: "+964", pattern: /^7[0-9]{9}$/,      placeholder: "7xxxxxxxxx",   example: "+964 770 123 4567" },
//   { code: "SY", name: "Syria",        dialCode: "+963", pattern: /^9[0-9]{8}$/,      placeholder: "9xxxxxxxx",    example: "+963 944 123 456"  },
//   { code: "LY", name: "Libya",        dialCode: "+218", pattern: /^9[0-9]{8}$/,      placeholder: "9xxxxxxxx",    example: "+218 91 123 4567"  },
//   { code: "TN", name: "Tunisia",      dialCode: "+216", pattern: /^[2-9][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+216 20 123 456"   },
//   { code: "DZ", name: "Algeria",      dialCode: "+213", pattern: /^[567][0-9]{8}$/,  placeholder: "xxxxxxxxx",    example: "+213 550 123 456"  },
//   { code: "MA", name: "Morocco",      dialCode: "+212", pattern: /^[67][0-9]{8}$/,   placeholder: "xxxxxxxxx",    example: "+212 612 345 678"  },
//   { code: "TR", name: "Turkey",       dialCode: "+90",  pattern: /^5[0-9]{9}$/,      placeholder: "5xxxxxxxxx",   example: "+90 530 123 4567"  },
//   { code: "GB", name: "UK",           dialCode: "+44",  pattern: /^7[0-9]{9}$/,      placeholder: "7xxxxxxxxx",   example: "+44 7911 123456"   },
//   { code: "US", name: "USA",          dialCode: "+1",   pattern: /^[2-9][0-9]{9}$/,  placeholder: "xxxxxxxxxx",   example: "+1 212 123 4567"   },
//   { code: "DE", name: "Germany",      dialCode: "+49",  pattern: /^1[0-9]{10,11}$/,  placeholder: "1xxxxxxxxxxx", example: "+49 151 12345678"  },
//   { code: "FR", name: "France",       dialCode: "+33",  pattern: /^[67][0-9]{8}$/,   placeholder: "xxxxxxxxx",    example: "+33 6 12 34 56 78" },
//   { code: "IN", name: "India",        dialCode: "+91",  pattern: /^[6-9][0-9]{9}$/,  placeholder: "xxxxxxxxxx",   example: "+91 98765 43210"   },
//   { code: "CN", name: "China",        dialCode: "+86",  pattern: /^1[3-9][0-9]{9}$/, placeholder: "1xxxxxxxxxx",  example: "+86 131 2345 6789" },
// ];

// function validatePhone(localNumber: string, country: CountryPhone | null): string {
//   if (!localNumber || !country) return "";
//   const digits = localNumber.replace(/[\s\-().]/g, "");
//   if (!country.pattern.test(digits))
//     return `Invalid number for ${country.name}. Expected format: ${country.example}`;
//   return "";
// }

// // ─── Phone Input ──────────────────────────────────────────────────────────────

// function PhoneInput({
//   value, countryCode, onValueChange, onCountryChange, error,
// }: {
//   value: string; countryCode: string;
//   onValueChange: (v: string) => void; onCountryChange: (code: string) => void; error?: string;
// }) {
//   const country = COUNTRY_PHONES.find(c => c.code === countryCode) ?? null;
//   return (
//     <div className="space-y-1">
//       <div className="flex gap-2">
//         <select
//           className="px-2 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-36 shrink-0"
//           value={countryCode} onChange={e => onCountryChange(e.target.value)}
//         >
//           <option value="">Country</option>
//           {COUNTRY_PHONES.map(c => <option key={c.code} value={c.code}>{c.dialCode} {c.name}</option>)}
//         </select>
//         <div className="relative flex-1">
//           {country && (
//             <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none select-none">
//               {country.dialCode}
//             </span>
//           )}
//           <input
//             className={`${inputClass} ${country ? "pl-12" : ""} ${error ? "border-red-400 focus:ring-red-400" : ""}`}
//             placeholder={country?.placeholder ?? "Enter number"}
//             value={value} onChange={e => onValueChange(e.target.value)}
//           />
//         </div>
//       </div>
//       {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3 shrink-0" />{error}</p>}
//       {!error && country && value && <p className="text-xs text-muted-foreground">Full: {country.dialCode} {value}</p>}
//     </div>
//   );
// }

// // ─── SKU Selector ─────────────────────────────────────────────────────────────

// function SkuSelector({
//   prefixes, loading, category, selectedPrefix, manualSku,
//   onPrefixChange, onManualSkuChange,
// }: {
//   prefixes: SkuPrefixRow[]; loading: boolean; category: string;
//   selectedPrefix: string; manualSku: string;
//   onPrefixChange: (p: string) => void; onManualSkuChange: (s: string) => void;
// }) {
//   const filtered = prefixes.filter(p => p.item_type === category || p.item_type === "both");

//   return (
//     <div className="space-y-3 p-3 rounded-lg bg-secondary/30 border border-border">
//       <div className="flex items-center gap-2">
//         <Tag className="w-3.5 h-3.5 text-primary" />
//         <span className="text-xs font-semibold text-foreground">SKU</span>
//         <span className="text-[11px] text-muted-foreground">— pick a prefix; number auto-increments</span>
//       </div>

//       <Field label="Prefix">
//         {loading ? (
//           <div className="h-9 bg-secondary/50 rounded-md animate-pulse" />
//         ) : (
//           <select
//             className={inputClass}
//             value={selectedPrefix}
//             onChange={e => { onPrefixChange(e.target.value); onManualSkuChange(""); }}
//           >
//             <option value="">— Auto (default prefix) —</option>
//             {filtered.map(p => (
//               <option key={p.id} value={p.prefix}>{p.label} · {p.prefix}-XXXXX</option>
//             ))}
//           </select>
//         )}
//         {selectedPrefix && !manualSku && (
//           <p className="text-[11px] text-muted-foreground mt-1">
//             Will generate: <span className="font-mono font-semibold text-primary">{selectedPrefix}-00001</span>,{" "}
//             <span className="font-mono text-primary">{selectedPrefix}-00002</span>, …
//           </p>
//         )}
//       </Field>

//       <Field label="Manual SKU (optional — overrides auto)">
//         <input
//           className={inputClass}
//           placeholder={selectedPrefix ? `${selectedPrefix}-XXXXX or leave blank` : "Leave blank to auto-generate"}
//           value={manualSku}
//           onChange={e => onManualSkuChange(e.target.value)}
//         />
//         {manualSku && (
//           <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
//             <AlertCircle className="w-3 h-3 shrink-0" />
//             Manual SKU — auto-increment disabled for this item.
//           </p>
//         )}
//       </Field>
//     </div>
//   );
// }

// // ─── PDF Export — Price History ───────────────────────────────────────────────

// function exportPriceHistoryPDF(rows: PriceHistoryRow[], ingredientName: string, currencyLabel: string) {
//   const win = window.open("", "_blank");
//   if (!win) return;
//   const changes = rows.map((row, i) => {
//     if (i === rows.length - 1) return { ...row, change: null, changePct: null };
//     const next = rows[i + 1];
//     const diff = row.price - next.price;
//     const pct  = next.price > 0 ? (diff / next.price) * 100 : 0;
//     return { ...row, change: diff, changePct: pct };
//   });
//   const rows_html = changes.map((r, i) => {
//     const changeCell = r.change === null
//       ? `<td class="center muted">—</td>`
//       : r.change > 0
//         ? `<td class="center up">▲ ${formatCurrency(r.change)} (${r.changePct!.toFixed(1)}%)</td>`
//         : r.change < 0
//           ? `<td class="center down">▼ ${formatCurrency(Math.abs(r.change))} (${Math.abs(r.changePct!).toFixed(1)}%)</td>`
//           : `<td class="center muted">— No change</td>`;
//     return `<tr class="${i % 2 === 0 ? "even" : ""}"><td>${r.purchase_date}</td><td>${r.supplier_name}</td><td class="right bold">${formatCurrency(r.price)} ${currencyLabel}</td>${changeCell}<td class="muted">${r.notes || "—"}</td></tr>`;
//   }).join("");
//   const latest = rows[0]?.price ?? 0;
//   const oldest = rows[rows.length - 1]?.price ?? 0;
//   const overall = latest - oldest;
//   const overallPct = oldest > 0 ? ((overall / oldest) * 100).toFixed(1) : "0";
//   win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Price History — ${ingredientName}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;padding:40px}.header{border-bottom:3px solid #9c2177;padding-bottom:16px;margin-bottom:24px}.brand{font-size:11px;font-weight:700;letter-spacing:3px;color:#9c2177;text-transform:uppercase}h1{font-size:22px;font-weight:700;color:#0f172a;margin-top:6px}.sub{color:#64748b;font-size:12px;margin-top:4px}.stats{display:flex;gap:24px;margin-bottom:24px}.stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 20px;flex:1}.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#94a3b8}.stat-value{font-size:20px;font-weight:700;color:#0f172a;margin-top:4px}.stat-value.up{color:#16a34a}.stat-value.down{color:#dc2626}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;text-align:left;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#475569}td{padding:10px 12px;border-bottom:1px solid #f1f5f9}tr.even td{background:#fafafa}.right{text-align:right}.center{text-align:center}.bold{font-weight:700}.muted{color:#94a3b8}.up{color:#16a34a;font-weight:600}.down{color:#dc2626;font-weight:600}.footer{margin-top:32px;color:#94a3b8;font-size:11px;text-align:center}@media print{body{padding:20px}}</style></head><body><div class="header"><div class="brand">STARK AI — Enterprise Costing System</div><h1>Price History: ${ingredientName}</h1><div class="sub">Generated on ${new Date().toLocaleDateString()} · ${rows.length} price records</div></div><div class="stats"><div class="stat"><div class="stat-label">Latest Price</div><div class="stat-value">${formatCurrency(latest)} ${currencyLabel}</div></div><div class="stat"><div class="stat-label">Oldest Price</div><div class="stat-value">${formatCurrency(oldest)} ${currencyLabel}</div></div><div class="stat"><div class="stat-label">Overall Change</div><div class="stat-value ${overall >= 0 ? "up" : "down"}">${overall >= 0 ? "▲" : "▼"} ${formatCurrency(Math.abs(overall))} (${Math.abs(Number(overallPct))}%)</div></div><div class="stat"><div class="stat-label">Total Records</div><div class="stat-value">${rows.length}</div></div></div><table><thead><tr><th>Date</th><th>Supplier</th><th class="right">Price (${currencyLabel})</th><th class="center">Change vs Previous</th><th>Notes</th></tr></thead><tbody>${rows_html}</tbody></table><div class="footer">STARK AI · Confidential · ${new Date().toISOString()}</div></body></html>`);
//   win.document.close(); win.focus(); setTimeout(() => { win.print(); }, 400);
// }

// // ─── PDF Export — Items ───────────────────────────────────────────────────────

// function exportItemsPDF(items: ItemRow[], currencyLabel: string) {
//   const win = window.open("", "_blank");
//   if (!win) return;
//   const rows_html = items.map((item, i) => `<tr class="${i % 2 === 0 ? "even" : ""}"><td class="bold">${item.name}</td><td class="muted">${item.sku || "—"}</td><td><span class="badge ${item.category === "finished_good" ? "fg" : "rm"}">${item.category === "finished_good" ? "Finished Good" : "Raw Material"}</span></td><td class="center">${item.unit}</td><td class="right bold">${formatCurrency(item.standard_cost ?? 0)} ${currencyLabel}</td><td class="right">${item.category === "finished_good" ? formatCurrency(item.sale_price ?? 0) + " " + currencyLabel : (item.reorder_level ?? 0) + " " + item.unit}</td></tr>`).join("");
//   win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Items — STARK AI</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;padding:40px}.header{border-bottom:3px solid #9c2177;padding-bottom:16px;margin-bottom:24px}.brand{font-size:11px;font-weight:700;letter-spacing:3px;color:#9c2177;text-transform:uppercase}h1{font-size:22px;font-weight:700;color:#0f172a;margin-top:6px}.sub{color:#64748b;font-size:12px;margin-top:4px}.stats{display:flex;gap:16px;margin-bottom:24px}.stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 18px;flex:1}.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#94a3b8}.stat-value{font-size:20px;font-weight:700;color:#0f172a;margin-top:4px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;text-align:left;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#475569}td{padding:10px 12px;border-bottom:1px solid #f1f5f9}tr.even td{background:#fafafa}.right{text-align:right}.center{text-align:center}.bold{font-weight:700}.muted{color:#94a3b8}.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600}.fg{background:#dcfce7;color:#15803d}.rm{background:#fef3c7;color:#b45309}.footer{margin-top:32px;color:#94a3b8;font-size:11px;text-align:center}@media print{body{padding:20px}}</style></head><body><div class="header"><div class="brand">STARK AI — Enterprise Costing System</div><h1>Items / Ingredients Master List</h1><div class="sub">Generated on ${new Date().toLocaleDateString()} · ${items.length} items</div></div><div class="stats"><div class="stat"><div class="stat-label">Total Items</div><div class="stat-value">${items.length}</div></div><div class="stat"><div class="stat-label">Raw Materials</div><div class="stat-value">${items.filter(i => i.category === "raw_material").length}</div></div><div class="stat"><div class="stat-label">Finished Goods</div><div class="stat-value">${items.filter(i => i.category === "finished_good").length}</div></div></div><table><thead><tr><th>Name</th><th>SKU</th><th>Category</th><th class="center">Unit</th><th class="right">Cost (${currencyLabel})</th><th class="right">Sale Price / Reorder</th></tr></thead><tbody>${rows_html}</tbody></table><div class="footer">STARK AI · Confidential · ${new Date().toISOString()}</div></body></html>`);
//   win.document.close(); win.focus(); setTimeout(() => { win.print(); }, 400);
// }

// // ─── Price Change History Panel ───────────────────────────────────────────────

// function PriceChangeHistory({ rows, currencyLabel }: { rows: PriceHistoryRow[]; currencyLabel: string }) {
//   if (rows.length < 2) return null;
//   const changes: { date: string; from: number; to: number; diff: number; pct: number; supplier: string }[] = [];
//   for (let i = 0; i < rows.length - 1; i++) {
//     const from = rows[i + 1].price; const to = rows[i].price;
//     const diff = to - from; const pct = from > 0 ? (diff / from) * 100 : 0;
//     changes.push({ date: rows[i].purchase_date , supplier: rows[i].supplier_name, from, to, diff, pct });
//   }
//   return (
//     <div className="mt-6 space-y-2">
//       <div className="flex items-center gap-2 mb-3">
//         <History className="w-4 h-4 text-primary" />
//         <h3 className="text-sm font-semibold text-foreground">Price Change Log</h3>
//       </div>
//       {changes.map((c, i) => (
//         <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border text-xs">
//           <div className="text-muted-foreground w-24 shrink-0">{c.date}</div>
//           <div className="font-medium text-foreground shrink-0">{c.supplier}</div>
//           <div className="flex items-center gap-1.5 flex-1">
//             <span className="text-muted-foreground">{formatCurrency(c.from)}</span>
//             <span className="text-muted-foreground">→</span>
//             <span className="font-semibold text-foreground">{formatCurrency(c.to)}</span>
//           </div>
//           <div className={`flex items-center gap-1 font-semibold shrink-0 ${c.diff > 0 ? "text-red-500" : c.diff < 0 ? "text-green-600" : "text-muted-foreground"}`}>
//             {c.diff > 0 ? <TrendingUp className="w-3 h-3" /> : c.diff < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
//             {c.diff > 0 ? "+" : ""}{formatCurrency(c.diff)} ({c.diff > 0 ? "+" : ""}{c.pct.toFixed(1)}%)
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// }

// // ─── Item Card ────────────────────────────────────────────────────────────────

// function ItemCard({
//   item, suppliers, selectedPeriodClosed, currencyLabel,
//   onDelete, onEdit, onImageUploaded,
// }: {
//   item: ItemRow; suppliers: SupplierRow[]; selectedPeriodClosed: boolean;
//   currencyLabel: string; onDelete: () => void; onEdit: () => void; onImageUploaded: () => void;
// }) {
//   const isFG = item.category === "finished_good";
//   const [uploading, setUploading] = useState(false);

//   const supplierName: string =
//     item.supplier_name ??
//     suppliers.find(s => s.id === item.supplier_id)?.name ?? "";

//   async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
//     const file = e.target.files?.[0];
//     if (!file) return;
//     setUploading(true);
//     const formData = new FormData();
//     formData.append("file", file);
//     const category = isFG ? "finished_good" : "raw_material";
//     try {
//       const result = await apiUpload<{ image_url?: string; message?: string }>(
//         `/api/products/${item.id}/image?category=${category}`, formData
//       );
//       const imageUrl = (result as { image_url?: string })?.image_url ?? null;
//       if (imageUrl) item.image_url = imageUrl;
//       onImageUploaded();
//     } catch {
//       alert("Image upload failed");
//     } finally {
//       setUploading(false);
//       e.target.value = "";
//     }
//   }

//   return (
//     <div className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md hover:border-primary/40 transition-all duration-200 flex flex-col group">
//       <div className="relative h-36 bg-secondary/40 flex items-center justify-center shrink-0 overflow-hidden">
//         {item.image_url ? (
//           <img src={assetUrl(item.image_url)} alt={item.name} className="w-full h-full object-cover" />
//         ) : (
//           <div className="flex flex-col items-center gap-1 select-none pointer-events-none">
//             <Package className="w-10 h-10 text-muted-foreground/30" />
//             <span className="text-[10px] font-semibold text-muted-foreground/40 tracking-widest uppercase">No Image</span>
//           </div>
//         )}
//         {!selectedPeriodClosed && (
//           <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
//             {uploading ? (
//               <Loader2 className="w-6 h-6 text-white animate-spin" />
//             ) : (
//               <div className="flex flex-col items-center gap-1 text-white">
//                 <Upload className="w-5 h-5" />
//                 <span className="text-[10px] font-semibold">Upload Image</span>
//               </div>
//             )}
//             <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
//               onChange={handleImageUpload} disabled={uploading} />
//           </label>
//         )}
//         <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${isFG ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"}`}>
//           {isFG ? "Finished Good" : "Raw Material"}
//         </span>
//         <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
//           Active
//         </span>
//       </div>
//       <div className="p-4 flex flex-col gap-3 flex-1">
//         <div>
//           <p className="text-[11px] font-mono text-primary leading-none mb-1">
//             {isFG ? "FG" : "RM"}-{localNumber(item.display_number, item.id)}
//           </p>
//           <p className="text-sm font-bold text-foreground leading-snug">{item.name}</p>
//         </div>
//         <div className="grid grid-cols-2 gap-x-3 gap-y-2">
//           {item.sku && (
//             <div className="col-span-2">
//               <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">SKU</p>
//               <p className="text-xs font-semibold text-foreground font-mono">{item.sku}</p>
//             </div>
//           )}
//           <div>
//             <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">Unit</p>
//             <p className="text-xs font-semibold text-foreground">{item.unit}</p>
//           </div>
//           {item.category_label && (
//             <div>
//               <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">Category</p>
//               <p className="text-xs font-semibold text-foreground">{item.category_label}</p>
//             </div>
//           )}
//           <div>
//             <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">Cost</p>
//             <p className="text-xs font-bold text-primary">{formatCurrency(item.standard_cost ?? 0)} {currencyLabel}</p>
//           </div>
//           {isFG ? (
//             <div>
//               <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">Sale Price</p>
//               <p className="text-xs font-bold text-green-600 dark:text-green-400">{formatCurrency(item.sale_price ?? 0)} {currencyLabel}</p>
//             </div>
//           ) : (
//             <div>
//               <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">Reorder At</p>
//               <p className="text-xs font-bold text-orange-600 dark:text-orange-400">{item.reorder_level ?? 0} {item.unit}</p>
//             </div>
//           )}
//         </div>
//         {supplierName && (
//           <div className="pt-2 border-t border-border">
//             <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">Supplier</p>
//             <p className="text-xs font-medium text-foreground flex items-center gap-1">
//               <Truck className="w-3 h-3 text-muted-foreground shrink-0" />{supplierName}
//             </p>
//           </div>
//         )}
//         <div className="flex gap-2 mt-auto pt-2 border-t border-border">
//           <button
//             disabled={selectedPeriodClosed} onClick={onEdit}
//             className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
//           >
//             <Pencil className="w-3.5 h-3.5" /> Edit
//           </button>
//           <button
//             disabled={selectedPeriodClosed} onClick={onDelete}
//             className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
//           >
//             <X className="w-3.5 h-3.5" /> Delete
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// }

// // ─── Modal ────────────────────────────────────────────────────────────────────

// function Modal({ title, onClose, onSave, saving, children, cancelLabel, saveLabel }: {
//   title: string; onClose: () => void; onSave: () => void;
//   saving: boolean; children: React.ReactNode; cancelLabel: string; saveLabel: string;
// }) {
//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
//       <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg p-6 border border-border max-h-[90vh] flex flex-col">
//         <div className="flex items-center justify-between mb-5">
//           <h2 className="text-lg font-semibold text-foreground">{title}</h2>
//           <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
//             <X className="w-5 h-5" />
//           </button>
//         </div>
//         <div className="space-y-4 overflow-y-auto flex-1 pr-1">{children}</div>
//         <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-border">
//           <Button variant="outline" onClick={onClose} disabled={saving}>{cancelLabel}</Button>
//           <Button onClick={onSave} disabled={saving} className="min-w-[80px]">
//             {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveLabel}
//           </Button>
//         </div>
//       </div>
//     </div>
//   );
// }

// // ─── Small reusable bits ──────────────────────────────────────────────────────

// function EmptyState({ label }: { label: string }) {
//   return <div className="py-12 text-center text-muted-foreground text-sm">{label}</div>;
// }

// function SkeletonRows({ count = 4 }: { count?: number }) {
//   return (
//     <div className="space-y-2">
//       {Array.from({ length: count }).map((_, i) => (
//         <div key={i} className="h-14 bg-secondary/50 rounded-lg animate-pulse" />
//       ))}
//     </div>
//   );
// }

// function SkeletonCards({ count = 8 }: { count?: number }) {
//   return (
//     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
//       {Array.from({ length: count }).map((_, i) => (
//         <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
//           <div className="h-36 bg-secondary/60" />
//           <div className="p-4 space-y-3">
//             <div className="h-4 w-3/4 bg-secondary/70 rounded" />
//             <div className="grid grid-cols-2 gap-2">
//               <div className="h-3 bg-secondary/60 rounded" />
//               <div className="h-3 bg-secondary/60 rounded" />
//               <div className="h-3 bg-secondary/60 rounded" />
//               <div className="h-3 bg-secondary/60 rounded" />
//             </div>
//           </div>
//         </div>
//       ))}
//     </div>
//   );
// }

// function TabBtn({ active, onClick, icon, label, count }: {
//   active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number;
// }) {
//   return (
//     <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
//       {icon}{label}
//       {count !== undefined && (
//         <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-bold ${active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{count}</span>
//       )}
//     </button>
//   );
// }

// function Badge({ label, color }: { label: string; color: string }) {
//   return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color}`}>{label}</span>;
// }

// function SectionLabel({ label }: { label: string }) {
//   return <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pt-1">{label}</p>;
// }

// // ─── Supplier Card ────────────────────────────────────────────────────────────

// function BranchCard({ b, selectedPeriodClosed, onShow, onDelete }: {
//   b: Branch; selectedPeriodClosed: boolean; onShow: () => void; onDelete: () => void;
// }) {
//   return (
//     <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-4 hover:shadow-md hover:border-primary/40 transition-all duration-200">
//       <div className="flex items-start justify-between gap-2">
//         <div className="flex items-start gap-3 min-w-0">
//           <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-sm font-bold shrink-0">
//             {b.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
//           </div>
//           <div className="min-w-0">
//             <p className="text-[11px] font-mono text-primary leading-none mb-1">BR-{localNumber(b.branch_number, b.id)}</p>
//             <p className="text-base font-bold text-foreground leading-snug truncate">{b.name}</p>
//             {b.manager && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Users className="w-3 h-3 shrink-0" />{b.manager}</p>}
//           </div>
//         </div>
//         <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Active</span>
//       </div>
//       <div className="min-h-[22px]">
//         {b.location ? (
//           <p className="text-xs text-muted-foreground flex items-center gap-1">
//             <MapPin className="w-3 h-3 shrink-0" />
//             <span className="truncate">Location: {b.location}</span>
//           </p>
//         ) : (
//           <span className="text-xs text-muted-foreground">No location set</span>
//         )}
//       </div>
//       <div className="flex gap-2 pt-1 border-t border-border">
//         <button onClick={onShow} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-foreground bg-secondary/60 hover:bg-secondary transition-colors">
//           <Eye className="w-3.5 h-3.5" />View Details
//         </button>
//         <button disabled={selectedPeriodClosed} onClick={onDelete} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
//           <X className="w-3.5 h-3.5" />Delete
//         </button>
//       </div>
//     </div>
//   );
// }

// function BranchDetailView({ b, selectedPeriodClosed, onBack, onDelete }: {
//   b: Branch; selectedPeriodClosed: boolean; onBack: () => void; onDelete: () => void;
// }) {
//   return (
//     <div className="space-y-5">
//       <div className="flex items-center justify-between">
//         <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
//           <ChevronLeft className="w-4 h-4" />Back to Branches
//         </button>
//         <button disabled={selectedPeriodClosed} onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
//           <X className="w-3.5 h-3.5" /> Delete Branch
//         </button>
//       </div>
//       <div className="flex items-center gap-4">
//         <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 flex items-center justify-center text-xl font-bold shrink-0">
//           {b.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
//         </div>
//         <div>
//           <div className="flex items-center gap-2 flex-wrap">
//             <h2 className="text-2xl font-bold text-foreground">{b.name}</h2>
//             <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Active</span>
//           </div>
//           <p className="text-sm text-primary font-mono mt-0.5">BR-{localNumber(b.branch_number, b.id)}</p>
//         </div>
//       </div>
//       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
//         <Card className="p-4">
//           <DetailRow icon={<MapPin className="w-4 h-4" />} label="Location" value={b.location || "—"} />
//           <DetailRow icon={<Users className="w-4 h-4" />} label="Manager" value={b.manager || "—"} />
//         </Card>
//       </div>
//     </div>
//   );
// }

// function SupplierCard({ s, selectedPeriodClosed, onShow, onDelete }: {
//   s: SupplierRow; selectedPeriodClosed: boolean; onShow: () => void; onDelete: () => void;
// }) {
//   return (
//     <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-5 hover:shadow-md hover:border-primary/40 transition-all duration-200">
//       <div className="flex items-start justify-between gap-2">
//         <div className="flex items-start gap-3 min-w-0">
//           <div className="w-11 h-11 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center justify-center text-sm font-bold shrink-0">
//             {s.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
//           </div>
//           <div className="min-w-0">
//             <p className="text-[11px] font-mono text-primary leading-none mb-1">SP-{localNumber(s.supplier_number, s.id)}</p>
//             <p className="text-base font-bold text-foreground leading-snug truncate">{s.name}</p>
//             {s.phone && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{s.phone}</p>}
//             {s.email && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{s.email}</p>}
//           </div>
//         </div>
//         <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Active</span>
//       </div>
//       <div className="flex flex-col gap-1">
//         <div className="flex items-center gap-2 flex-wrap">
//           <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${supplierCatColor(s.category)}`}>{s.category || "General"}</span>
//           {s.commercial_reg_number && <span className="text-xs text-muted-foreground font-mono">Reg: {s.commercial_reg_number}</span>}
//         </div>
//         {s.address && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{s.address}</span></p>}
//       </div>
//       <div className="flex gap-2 pt-1 border-t border-border">
//         <button onClick={onShow} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-foreground bg-secondary/60 hover:bg-secondary transition-colors">
//           <Eye className="w-3.5 h-3.5" />View Details
//         </button>
//         <button disabled={selectedPeriodClosed} onClick={onDelete} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
//           <X className="w-3.5 h-3.5" />Delete
//         </button>
//       </div>
//     </div>
//   );
// }

// // ─── Detail Row ───────────────────────────────────────────────────────────────

// function DetailRow({ icon, label, value, isLink }: { icon: React.ReactNode; label: string; value: string; isLink?: boolean }) {
//   return (
//     <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
//       <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
//       <div className="flex-1 min-w-0">
//         <p className="text-[11px] text-muted-foreground font-medium mb-0.5">{label}</p>
//         {isLink && value !== "—" ? (
//           <a href={value} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline truncate block">{value}</a>
//         ) : (
//           <p className="text-sm font-semibold text-foreground break-words">{value}</p>
//         )}
//       </div>
//     </div>
//   );
// }

// // ─── Supplier Detail View ─────────────────────────────────────────────────────

// function SupplierDetailView({ s, selectedPeriodClosed, onBack, onDelete }: {
//   s: SupplierRow; selectedPeriodClosed: boolean; onBack: () => void; onDelete: () => void;
// }) {
//   return (
//     <div className="space-y-5">
//       <div className="flex items-center justify-between">
//         <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
//           <ChevronLeft className="w-4 h-4" />Back to Suppliers
//         </button>
//         <button disabled={selectedPeriodClosed} onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
//           <X className="w-3.5 h-3.5" /> Delete Supplier
//         </button>
//       </div>
//       <div className="flex items-center gap-4">
//         <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex items-center justify-center text-xl font-bold shrink-0">
//           {s.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
//         </div>
//         <div>
//           <div className="flex items-center gap-2 flex-wrap">
//             <h2 className="text-2xl font-bold text-foreground">{s.name}</h2>
//             <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">Active</span>
//           </div>
//           <p className="text-sm text-primary font-mono mt-0.5">SP-{localNumber(s.supplier_number, s.id)}</p>
//         </div>
//       </div>
//       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
//         <Card className="p-5">
//           <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">Supplier Details</p>
//           <div className="space-y-0">
//             <DetailRow icon={<Phone className="w-3.5 h-3.5" />}  label="Phone Number"           value={s.phone                 || "—"} />
//             <DetailRow icon={<Mail  className="w-3.5 h-3.5" />}  label="Email"                  value={s.email                 || "—"} />
//             <DetailRow icon={<MapPin className="w-3.5 h-3.5" />} label="Address"                value={s.address               || "—"} />
//             <DetailRow icon={<Globe className="w-3.5 h-3.5" />}  label="Website"                value={s.website               || "—"} isLink />
//             <DetailRow icon={<span className="text-[13px]">📄</span>} label="Commercial Reg. Number" value={s.commercial_reg_number || "—"} />
//           </div>
//         </Card>
//         <Card className="p-5">
//           <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">Business Details</p>
//           <div className="space-y-0">
//             <DetailRow icon={<Users className="w-3.5 h-3.5" />} label="Agent Name"  value={s.agent_name  || "—"} />
//             <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Agent Phone" value={s.agent_phone || "—"} />
//             <div className="py-2.5 border-b border-border last:border-0">
//               <p className="text-[11px] text-muted-foreground font-medium mb-1">Category</p>
//               <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${supplierCatColor(s.category)}`}>{s.category || "General"}</span>
//             </div>
//             {s.notes && <DetailRow icon={<span className="text-[13px]">📝</span>} label="Notes" value={s.notes} />}
//           </div>
//         </Card>
//       </div>
//     </div>
//   );
// }

// // ─── SKU Prefix Manager ───────────────────────────────────────────────────────

// function SkuPrefixManager({
//   prefixes, loading, onRefresh, selectedPeriodClosed,
// }: {
//   prefixes: SkuPrefixRow[];
//   loading: boolean;
//   onRefresh: () => void;
//   selectedPeriodClosed: boolean;
// }) {
//   const [form, setForm] = useState({
//     label: "",
//     prefix: "",
//     item_type: "raw_material" as "raw_material" | "finished_good" | "both",
//   });
//   const [saving,  setSaving]  = useState(false);
//   const [error,   setError]   = useState("");
//   const [success, setSuccess] = useState("");
//   const [seeding, setSeeding] = useState(false);

//   const rawPrefixes      = prefixes.filter(p => p.item_type === "raw_material");
//   const finishedPrefixes = prefixes.filter(p => p.item_type === "finished_good");
//   const bothPrefixes     = prefixes.filter(p => p.item_type === "both");
//   async function handleAdd() {
//     if (!form.label.trim())  { setError("Label is required.");  return; }
//     if (!form.prefix.trim()) { setError("Prefix is required."); return; }
//     if (!/^[A-Z0-9]+$/.test(form.prefix.toUpperCase())) {
//       setError("Prefix must be letters/numbers only (e.g. PIZ, BRK2)."); return;
//     }
//     setSaving(true); setError(""); setSuccess("");
//     try {
//       await addSkuPrefix({
//         label:     form.label.trim(),
//         prefix:    form.prefix.trim().toUpperCase(),
//         item_type: form.item_type,
//       });
//       setSuccess(`Prefix "${form.prefix.toUpperCase()}" added successfully.`);
//       setForm({ label: "", prefix: "", item_type: "raw_material" });
//       onRefresh();
//     } catch (e: any) {
//       setError(e?.message ?? "Failed to add prefix. It may already exist.");
//     }
//     setSaving(false);
//   }

//   async function handleDelete(id: number, prefix: string) {
//     if (!confirm(`Delete prefix "${prefix}"? Items with this SKU prefix won't be affected.`)) return;
//     const ok = await deleteSkuPrefix(id);
//     if (ok) {
//       onRefresh();
//     } else {
//       alert("Failed to delete prefix.");
//     }
//   }

//   async function handleSeedDefaults() {
//     if (!confirm("This will add all default prefixes for your company. Existing ones won't be changed. Continue?")) return;
//     setSeeding(true);
//     const ok = await seedSkuPrefixes();
//     if (ok) {
//       onRefresh();
//       setSuccess("Default prefixes seeded successfully.");
//     } else {
//       setError("Failed to seed defaults.");
//     }
//     setSeeding(false);
//   }
  

  

//   function PrefixGroup({ title, items, color }: { title: string; items: SkuPrefixRow[]; color: string }) {
//     if (!items.length) return null;
//     return (
//       <div>
//         <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${color}`}>
//           {title} ({items.length})
//         </p>
//         <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
//           {items.map(p => (
//             <div
//               key={p.id}
//               className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 group transition-colors"
//             >
//               <div className="min-w-0">
//                 <p className="font-mono text-sm font-bold text-primary">{p.prefix}-</p>
//                 <p className="text-[11px] text-muted-foreground truncate">{p.label}</p>
//               </div>
//               {!selectedPeriodClosed && (
//                 <button
//                   onClick={() => handleDelete(p.id, p.prefix)}
//                   className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
//                   title={`Delete ${p.prefix}`}
//                 >
//                   <X className="w-3.5 h-3.5" />
//                 </button>
//               )}
//             </div>
//           ))}
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="space-y-6">
//       {/* Header */}
//       <div className="flex items-center justify-between">
//         <h2 className="text-lg font-semibold">SKU Prefix Manager</h2>
//         <Button
//           size="sm"
//           variant="outline"
//           className="gap-2"
//           onClick={handleSeedDefaults}
//           disabled={seeding || selectedPeriodClosed}
//         >
//           {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
//           Seed Defaults
//         </Button>
//       </div>

//       {/* Add New Prefix Form */}
//       <div className="p-4 rounded-xl border border-primary/30 bg-primary/[0.03] space-y-4">
//         <p className="text-xs font-bold text-primary uppercase tracking-wider">Add New SKU Prefix</p>

//         {error   && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//         {success && <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" />{success}</p>}

//         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
//           <Field label="Label (display name)">
//             <input
//               className={inputClass}
//               placeholder="e.g. Wraps & Rolls"
//               value={form.label}
//               onChange={e => setForm({ ...form, label: e.target.value })}
//             />
//           </Field>

//           <Field label="Prefix (short code)">
//             <div className="relative">
//               <input
//                 className={inputClass + " uppercase font-mono"}
//                 placeholder="e.g. WRAP"
//                 maxLength={8}
//                 value={form.prefix}
//                 onChange={e => setForm({ ...form, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
//               />
//               {form.prefix && (
//                 <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono">
//                   → {form.prefix}-00001
//                 </span>
//               )}
//             </div>
//           </Field>

//           <Field label="Applies To">
//             <select
//               className={inputClass}
//               value={form.item_type}
//               onChange={e => setForm({ ...form, item_type: e.target.value as "raw_material" | "finished_good" | "both" })}
//             >
//               <option value="raw_material">Raw Materials only</option>
//               <option value="finished_good">Finished Goods only</option>
//               <option value="both">Both</option>
//             </select>
//           </Field>
//         </div>

//         {/* Preview */}
//         {form.prefix && form.label && (
//           <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border text-xs">
//             <Tag className="w-3.5 h-3.5 text-primary shrink-0" />
//             <span className="text-muted-foreground">Preview:</span>
//             <span className="font-mono font-bold text-primary">{form.prefix}-00001</span>
//             <span className="text-muted-foreground">·</span>
//             <span className="font-mono font-bold text-primary">{form.prefix}-00002</span>
//             <span className="text-muted-foreground">·</span>
//             <span className="text-muted-foreground">{form.label}</span>
//             <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${
//               form.item_type === "raw_material"  ? "bg-amber-100 text-amber-700"  :
//               form.item_type === "finished_good" ? "bg-green-100 text-green-700"  :
//                                                    "bg-blue-100 text-blue-700"
//             }`}>
//               {form.item_type === "raw_material"  ? "Raw Material"  :
//                form.item_type === "finished_good" ? "Finished Good" : "Both"}
//             </span>
//           </div>
//         )}

//         <div className="flex justify-end">
//           <Button
//             size="sm"
//             onClick={handleAdd}
//             disabled={saving || selectedPeriodClosed || !form.label || !form.prefix}
//             className="gap-2"
//           >
//             {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
//             Add Prefix
//           </Button>
//         </div>
//       </div>

//       {/* Existing Prefixes */}
//       {loading ? (
//         <div className="space-y-2">
//           {[1, 2, 3].map(i => <div key={i} className="h-10 bg-secondary/40 rounded-lg animate-pulse" />)}
//         </div>
//       ) : !prefixes.length ? (
//         <div className="py-12 text-center space-y-3">
//           <Tag className="w-10 h-10 text-muted-foreground/30 mx-auto" />
//           <p className="text-sm text-muted-foreground">No prefixes yet.</p>
//           <p className="text-xs text-muted-foreground">
//             Click <strong>Seed Defaults</strong> to add the standard F&B prefixes, or add your own above.
//           </p>
//         </div>
//       ) : (
//         <div className="space-y-5">
//           <PrefixGroup title="Raw Materials"  items={rawPrefixes}      color="text-amber-600 dark:text-amber-400" />
//           <PrefixGroup title="Finished Goods" items={finishedPrefixes} color="text-green-600 dark:text-green-400" />
//           <PrefixGroup title="Both"           items={bothPrefixes}     color="text-blue-600 dark:text-blue-400"   />
//         </div>
//       )}

//       <p className="text-xs text-muted-foreground border-t border-border pt-4">
//         Deleting a prefix won't affect existing items — their SKUs are stored permanently.
//         The counter resets if you re-add the same prefix later.
//       </p>
//     </div>
//   );
// }

// // ─── Empty supplier form ──────────────────────────────────────────────────────

// const emptySupplierForm = {
//   name: "", phone: "", phoneCountry: "EG",
//   agentPhone: "", agentPhoneCountry: "EG",
//   email: "", address: "", website: "",
//   commercial_reg_number: "", agent_name: "",
//   category: "", notes: "",
// };

// // ─── Main Component ───────────────────────────────────────────────────────────

// export default function Masters() {
//   const { language, t } = useLanguage();
//   const search = useSearch();

// const [tab, setTab] = useState<Tab>(() => {
//   const currentTab = new URLSearchParams(window.location.search).get("tab");

//   const validTabs: Tab[] = [
//     "branches",
//     "suppliers",
//     "items",
//     "users",
//     "prices",
//     "skuPrefixes",
//   ];

//   return validTabs.includes(currentTab as Tab)
//     ? (currentTab as Tab)
//     : "branches";
// });

// useEffect(() => {
//   const currentTab = new URLSearchParams(search).get("tab");

//   const validTabs: Tab[] = [
//     "branches",
//     "suppliers",
//     "items",
//     "users",
//     "prices",
//     "skuPrefixes",
//   ];

//   if (validTabs.includes(currentTab as Tab)) {
//     setTab(currentTab as Tab);
//   } else if (!currentTab) {
//     setTab("branches");
//   }
// }, [search]);
// const masterPageInfo: Record<Tab, { title: string; subtitle: string }> = {
//   branches: {
//     title: "Branches",
//     subtitle: "Manage your company branches",
//   },
//   suppliers: {
//     title: "Suppliers",
//     subtitle: "Manage supplier information and purchasing relationships",
//   },
//   items: {
//     title: "Items",
//     subtitle: "Manage raw materials and finished goods",
//   },
//   users: {
//     title: "Users",
//     subtitle: "Manage system users and roles",
//   },
//   prices: {
//     title: "Prices",
//     subtitle: "Manage ingredient price history",
//   },
//   skuPrefixes: {
//     title: "SKU Prefixes",
//     subtitle: "Manage SKU numbering prefixes",
//   },
// };

// const pageInfo = masterPageInfo[tab];
//   const [modal, setModal] = useState<ModalType>(null);
//   const [saving,  setSaving]  = useState(false);
//   const [error,   setError]   = useState("");
//   const [showChangeLog, setShowChangeLog] = useState(false);
//   const currencyLabel = getCurrencyLabel(language);

//   const { workingPeriod, periodStatus } = useWorkingPeriod();

//   const selectedPeriodState = periodStatus ?? "unknown";


//     const selectedPeriodClosed =
//       periodStatus === null ||
//       selectedPeriodState === "closed" ||
//       selectedPeriodState === "locked";

//   const selectedPeriodLocked =
//     selectedPeriodState === "locked";

//   const periodStatusLoading = periodStatus === null;
//   const [branchSearch, setBranchSearch] = useState("");
//   const [branchView, setBranchView] = useState<Branch | null>(null);
//   const [supplierSearch, setSupplierSearch] = useState("");
//   const [supplierCategoryFilter, setSupplierCategoryFilter] = useState("");
//   const [supplierView,   setSupplierView]   = useState<SupplierRow | null>(null);
//   const [itemSearch, setItemSearch] = useState("");
//   const [itemFilter, setItemFilter] = useState<"all" | "raw_material" | "finished_good">("all");
//   const [userRoleFilter, setUserRoleFilter] = useState("");

//   const authUser = (() => { try { return JSON.parse(localStorage.getItem("auth_user") ?? "{}"); } catch { return {}; } })();
//   const currentUserId = Number(authUser.id ?? 0);
//   const companyId = String(authUser.company_id ?? authUser.company?.id ?? "unknown");
//   const masterScope = `${companyId}:${currentUserId}`;
//   const { data: branches, loading: branchLoading, error: branchError, refetch: refetchBranches } =
//     useCachedQuery(`master:${masterScope}:branches`, getBranches);
//   const { data: suppliers, loading: supplierLoading, error: supplierError, refetch: refetchSuppliers } =
//     useCachedQuery(`master:${masterScope}:suppliers`, getSuppliers);
//   const { data: items, loading: itemLoading, error: itemError, refetch: refetchItemsRaw } =
//     useCachedQuery(`master:${masterScope}:items`, getItems);
//   const { data: users, loading: userLoading, error: userError, refetch: refetchUsers } =
//     useCachedQuery(`master:${masterScope}:users`, getUsers);
//   const { data: ingredients, loading: ingredientLoading, error: ingredientError, refetch: refetchIngredients } =
//     useCachedQuery(`master:${masterScope}:ingredients`, () => apiCall<IngredientOption[]>("/api/ingredients"));
//   const { data: skuPrefixData, loading: skuPrefixLoading, error: skuPrefixError, refetch: refetchSkuPrefixes } =
//     useCachedQuery(`master:${masterScope}:sku-prefixes`, getSkuPrefixes);

//   const skuPrefixes: SkuPrefixRow[] = skuPrefixData ?? [];

//   const [selectedIngredient,     setSelectedIngredient]     = useState<number>(0);
//   const [selectedIngredientName, setSelectedIngredientName] = useState<string>("");
//   const [ingredientSearch, setIngredientSearch] = useState("");
//   const [showIngredientDropdown, setShowIngredientDropdown] = useState(false);
//   const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
//   const [priceLoading, setPriceLoading] = useState(false);
//   const [priceError, setPriceError] = useState("");
//   const priceRequestRef = useRef(0);
//   const fetchPriceHistory = useCallback(async (ingredientId: number, force = false) => {
//     const request = ++priceRequestRef.current;
//     if (!ingredientId) { setPriceHistory([]); setPriceLoading(false); return; }
//     const key = `master:${masterScope}:price-history:${ingredientId}`;
//     const cached = readCachedQuery<PriceHistoryRow[]>(key);
//     setPriceHistory((cached?.value as PriceHistoryRow[] | undefined) ?? []);
//     setPriceError("");
//     if (cached && !force && Date.now() - cached.timestamp < MASTER_CACHE_TTL) {
//       setPriceLoading(false);
//       return;
//     }
//     setPriceLoading(!cached);
//     try {
//       const rows = await apiCall<PriceHistoryRow[]>(`/api/suppliers/price-history/${ingredientId}`);
//       if (request !== priceRequestRef.current) return;
//       const safeRows = Array.isArray(rows) ? rows : [];
//       writeCachedQuery(key, safeRows);
//       setPriceHistory(safeRows);
//     } catch (err) {
//       if (request === priceRequestRef.current)
//         setPriceError(err instanceof Error ? err.message : "Failed to load price history");
//     } finally {
//       if (request === priceRequestRef.current) setPriceLoading(false);
//     }
//   }, [masterScope]); 
//   const filteredIngredients = (ingredients ?? []).filter((i: IngredientOption) =>
//     i.name.toLowerCase().includes(ingredientSearch.toLowerCase())
//   );
//  // Replace the existing priceHistory useApi call:
  

//   const [branchForm,   setBranchForm]   = useState({ name: "", location: "", manager: "" });
//   const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
//   const [phoneError,      setPhoneError]      = useState("");
//   const [agentPhoneError, setAgentPhoneError] = useState("");
//   useEffect(() => {
//   fetchPriceHistory(selectedIngredient);
//   }, [selectedIngredient,fetchPriceHistory]);

//   const [itemForm, setItemForm] = useState({
//     name: "", sku: "", sku_prefix: "",
//     category: "raw_material", unit: "",
//     sale_price: 0, reorder_level: 0, standard_cost: 0,
//     supplier_id: 0,
//   });
//   const [editingItem,  setEditingItem]  = useState<ItemRow | null>(null);
//   const [editItemForm, setEditItemForm] = useState({
//     name: "", sku: "", sku_prefix: "", unit: "",
//     sale_price: 0, reorder_level: 0, standard_cost: 0,
//   });

//   const [userForm,  setUserForm]  = useState({ username: "", display_name: "", role: "clerk" });
//   const [priceForm, setPriceForm] = useState({ supplier_id: 0, ingredient_id: 0, price: 0, purchase_date: today(), notes: "" });

//   const openModal = (type: ModalType) => {
//     setError(""); setPhoneError(""); setAgentPhoneError(""); setModal(type);
//   };

//   function openEditItem(item: ItemRow) {
//     setEditingItem(item);
//     const existingPrefix = item.sku?.includes("-") ? item.sku.split("-")[0] : "";
//     setEditItemForm({
//       name:          item.name,
//       sku:           item.sku ?? "",
//       sku_prefix:    existingPrefix,
//       unit:          item.unit,
//       sale_price:    item.sale_price    ?? 0,
//       reorder_level: item.reorder_level ?? 0,
//       standard_cost: item.standard_cost ?? 0,
//     });
//     setError("");
//     setModal("editItem");
//   }

//   function buildPhone(localNumber: string, countryCode: string): string {
//     if (!localNumber) return "";
//     const country = COUNTRY_PHONES.find(c => c.code === countryCode);
//     if (!country) return localNumber;
//     return `${country.dialCode} ${localNumber.replace(/[\s\-().]/g, "")}`;
//   }

//   // ── Save handlers ──────────────────────────────────────────────────────────

// async function handleSaveBranch() {
//   if (!branchForm.name.trim()) {
//     setError(t("masters.err.branchName"));
//     return;
//   }

//   setSaving(true);
//   setError("");

//   const ok = await addBranch({
//     ...branchForm,
//     user_id: currentUserId,
//   });

//   setSaving(false);

//   if (ok) {
//     // Clear the shared branch cache.
//     invalidateCachedQueries(`master:${masterScope}:branches`);
//     // Update the branch list on the current page.
//     refetchBranches?.();

//     setModal(null);
//     setBranchForm({
//       name: "",
//       location: "",
//       manager: "",
//     });
//   } else {
//     setError(t("masters.err.branchSave"));
//   }
// }

//   async function handleSaveSupplier() {
//     if (!supplierForm.name.trim()) { setError(t("masters.err.supplierName")); return; }
//     const phoneCountry      = COUNTRY_PHONES.find(c => c.code === supplierForm.phoneCountry)      ?? null;
//     const agentPhoneCountry = COUNTRY_PHONES.find(c => c.code === supplierForm.agentPhoneCountry) ?? null;
//     const pErr  = supplierForm.phone      ? validatePhone(supplierForm.phone,      phoneCountry)      : "";
//     const apErr = supplierForm.agentPhone ? validatePhone(supplierForm.agentPhone, agentPhoneCountry) : "";
//     setPhoneError(pErr); setAgentPhoneError(apErr);
//     if (pErr || apErr) return;
//     setSaving(true); setError("");
//     const ok = await addSupplier({
//       name: supplierForm.name,
//       phone: buildPhone(supplierForm.phone, supplierForm.phoneCountry),
//       email: supplierForm.email, address: supplierForm.address, website: supplierForm.website,
//       commercial_reg_number: supplierForm.commercial_reg_number, agent_name: supplierForm.agent_name,
//       agent_phone: buildPhone(supplierForm.agentPhone, supplierForm.agentPhoneCountry),
//       category: supplierForm.category, notes: supplierForm.notes, user_id: currentUserId,
//     });
//     setSaving(false);
//     if (ok) {
//   // Clear Procurement's cached supplier list.
//     invalidateCachedQueries(`master:${masterScope}:suppliers`);
//     refetchSuppliers?.();
//     setModal(null);
//     setSupplierForm(emptySupplierForm);
//   } else {
//     setError(t("masters.err.supplierSave"));
//   }

//   }

//   async function handleSaveItem() {
//     if (!itemForm.name.trim() || !itemForm.unit.trim()) {
//       setError(t("masters.err.itemRequired"));
//       return;
//     }
//     setSaving(true);
//     setError("");

//     const savedName       = itemForm.name;
//     const savedSupplierId = itemForm.supplier_id;
//     const savedCost       = itemForm.standard_cost;

//     const result = await addItem({
//       name:          itemForm.name,
//       unit:          itemForm.unit,
//       category:      itemForm.category,
//       sale_price:    itemForm.sale_price,
//       reorder_level: itemForm.reorder_level,
//       standard_cost: itemForm.standard_cost,
//       sku:           itemForm.sku        || "",
//       sku_prefix:    itemForm.sku_prefix || undefined,
//       user_id:       currentUserId,
//     });

//     if (!result) {
//       setError(t("masters.err.itemSave"));
//       setSaving(false);
//       return;
//     }

//     // POST the initial price record BEFORE resetting anything
//     if (result.id && savedSupplierId && savedCost > 0) {
//       try {
//         await apiCall("/api/suppliers/price", {
//           method: "POST",
//           body: JSON.stringify({
//             ingredient_id:  result.id,
//             supplier_id:    savedSupplierId,
//             price:          savedCost,
//             purchase_date: (() => {
//               const d = new Date();
//               d.setDate(d.getDate() - 1);
//               return d.toISOString().split("T")[0];
//             })(),
//             notes:      "Initial cost on item creation",
//             price_type: "initial_cost",
//           }),
//         });
//       } catch { /* non-blocking */ }
//     }

//     // Close modal and reset form
//     setModal(null);
//     setItemForm({
//       name: "", sku: "", sku_prefix: "", category: "raw_material",
//       unit: "", sale_price: 0, reorder_level: 0, standard_cost: 0,
//       supplier_id: 0,
//     });

//     // Navigate and fetch fresh history directly with the known ID
//     if (result.id && savedSupplierId && savedCost > 0) {
//       setSelectedIngredient(result.id);
//       setSelectedIngredientName(savedName);
//       setTab("prices");
//       await fetchPriceHistory(result.id, true);
//     }
//     invalidateCachedQueries(`master:${masterScope}:items`);
//     invalidateCachedQueries(`master:${masterScope}:ingredients`);
//     await refetchItemsRaw?.();
//     await refetchIngredients?.();
//     setSaving(false);
//   }
//   async function handleUpdateItem() {
//     if (!editingItem) return;
//     if (!editItemForm.name.trim() || !editItemForm.unit.trim()) {
//       setError("Name and unit are required."); return;
//     }
//     setSaving(true); setError("");
//     try {
//       if (editingItem.category === "finished_good") {
//         await apiCall(`/api/products/${editingItem.id}`, {
//           method: "PUT",
//           body: JSON.stringify({
//             name:          editItemForm.name,
//             unit:          editItemForm.unit,
//             sale_price:    editItemForm.sale_price,
//             standard_cost: editItemForm.standard_cost,
//             sku:        editItemForm.sku        || null,
//             sku_prefix: editItemForm.sku_prefix || null,
//           }),
//         });
//       } else {
//         await apiCall(`/api/ingredients/${editingItem.id}`, {
//           method: "PUT",
//           body: JSON.stringify({
//             name:          editItemForm.name,
//             unit:          editItemForm.unit,
//             cost_per_unit: editItemForm.standard_cost,
//             reorder_level: editItemForm.reorder_level,
//             sku:        editItemForm.sku        || null,
//             sku_prefix: editItemForm.sku_prefix || null,
//           }),
//         });
//       }
//       setModal(null); setEditingItem(null);
//       invalidateCachedQueries(`master:${masterScope}:items`);
//       invalidateCachedQueries(`master:${masterScope}:ingredients`);
//       await refetchItemsRaw?.();
//       await refetchIngredients?.();
//     } catch {
//       setError("Failed to update item. Please try again.");
//     }
//     setSaving(false);
//   }

//   async function handleSaveUser() {
//     if (!userForm.username.trim() || !userForm.display_name.trim()) { setError(t("masters.err.userRequired")); return; }
//     setSaving(true); setError("");
//     const ok = await addUser({ ...userForm, password: `${userForm.username}123`, user_id: currentUserId });
//     setSaving(false);
//     if (ok) { setModal(null); setUserForm({ username: "", display_name: "", role: "clerk" }); refetchUsers?.(); }
//     else setError(t("masters.err.userSave"));
//   }

//   async function handleSavePrice() {
//     if (!priceForm.supplier_id)   { setError(t("masters.err.selectSupplier"));   return; }
//     if (!priceForm.ingredient_id) { setError(t("masters.err.selectIngredient")); return; }
//     if (!priceForm.price)         { setError(t("masters.err.enterPrice"));        return; }

//     setSaving(true);
//     setError("");

//     const savedIngredientId   = priceForm.ingredient_id;
//     const savedIngredientName = ingredients?.find(i => i.id === savedIngredientId)?.name ?? "";

//     try {
//       // Record price — backend sets status to 'pending', cost NOT updated yet
//       await apiCall("/api/suppliers/price", {
//         method: "POST",
//         body:   JSON.stringify({
//           ...priceForm,
//           price_type: "market_price",
//         }),
//       });

//       // Reset form
//       setPriceForm({
//         supplier_id:   0,
//         ingredient_id: 0,
//         price:         0,
//         purchase_date: today(),
//         notes:         "",
//       });

//       setModal(null);
//       setSelectedIngredient(savedIngredientId);
//       setSelectedIngredientName(savedIngredientName);
//       setTab("prices");

//       invalidateCachedQueries(`master:${masterScope}:price-history:${savedIngredientId}`);
//       invalidateCachedQueries(`master:${masterScope}:ingredients`);
//       invalidateCachedQueries(`master:${masterScope}:items`);
//       await Promise.all([
//         fetchPriceHistory(savedIngredientId, true),
//         refetchIngredients?.(),
//         refetchItemsRaw?.(),
//       ]);

//     } catch {
//       setError(t("masters.err.priceSave"));
//     }

//     setSaving(false);
//   }

//   async function handleDeleteSupplier(s: SupplierRow) {
//     if (selectedPeriodClosed) return;
//     if (!confirm(t("masters.confirm.deleteSupplier").replace("{name}", s.name))) return;
//     const ok = await deleteSupplier(s.id);
//     if (ok) {
//     invalidateCachedQueries(`master:${masterScope}:suppliers`);
//     refetchSuppliers?.();
//     setSupplierView(null);
//   }
//   }

//   async function handleDeleteBranch(b: Branch) {
//     if (selectedPeriodClosed) return;
//     if (!confirm(t("masters.confirm.deleteBranch").replace("{name}", b.name))) return;
//     const ok = await deleteBranch(b.id);
//     if (ok) {
//   invalidateCachedQueries(`master:${masterScope}:branches`);
//   refetchBranches?.();
//     setBranchView(null);
//   }
//   }

//   // ── Derived values ─────────────────────────────────────────────────────────

//   const counts = {
//     branches:    branches?.length    ?? 0,
//     suppliers:   suppliers?.length   ?? 0,
//     items:       items?.length       ?? 0,
//     users:       users?.length       ?? 0,
//     skuPrefixes: skuPrefixes.length,
//   };

//   const roleColor = (role: string) =>
//     role === "admin"   ? "bg-purple-100 text-purple-700" :
//     role === "manager" ? "bg-blue-100 text-blue-700"     :
//                          "bg-secondary text-muted-foreground";

//   const modalProps = { saving, cancelLabel: t("masters.cancel"), saveLabel: t("masters.save") };

//   const branchList = (branches as Branch[]) ?? [];
//   const filteredBranches = branchList.filter(b => {
//     const q = branchSearch.toLowerCase();
//     return (
//       b.name.toLowerCase().includes(q) ||
//       (b.location ?? "").toLowerCase().includes(q) ||
//       (b.manager ?? "").toLowerCase().includes(q) ||
//       `br-${localNumber(b.branch_number, b.id)}`.includes(q)
//     );
//   });

//   const supplierList      = (suppliers as SupplierRow[]) ?? [];
//   const filteredSuppliers = supplierList.filter(s =>
//     (s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
//     (s.phone ?? "").includes(supplierSearch) ||
//     (s.email ?? "").toLowerCase().includes(supplierSearch.toLowerCase()) ||
//     (s.notes ?? "").toLowerCase().includes(supplierSearch.toLowerCase())) &&
//     (!supplierCategoryFilter || (s.category || "General") === supplierCategoryFilter)
//   );
//   const activeCategories = [...new Set(supplierList.map(s => s.category || "General"))].sort();

//   const filteredItems = (items as ItemRow[] ?? []).filter(item => {
//     const matchSearch =
//       item.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
//       (item.sku ?? "").toLowerCase().includes(itemSearch.toLowerCase());
//     return matchSearch && (itemFilter === "all" || item.category === itemFilter);
//   });
//   const filteredUsers = (users as UserRow[] ?? []).filter(u =>
//   !userRoleFilter || u.role === userRoleFilter
//   );

//   // ── Render ─────────────────────────────────────────────────────────────────

//   return (
//     <div className="space-y-6">
//       {(branchError || supplierError || itemError || userError || ingredientError || skuPrefixError || priceError) && (
//         <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
//           {branchError || supplierError || itemError || userError || ingredientError || skuPrefixError || priceError}
//         </div>
//       )}


//       {/* ── Branch Modal ── */}
//       {modal === "branch" && (
//         <Modal title={t("masters.modal.addBranch")} onClose={() => setModal(null)} onSave={handleSaveBranch} {...modalProps}>
//           {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//           <Field label={t("masters.field.branchName")}>
//             <input className={inputClass} placeholder={t("masters.ph.branchName")} value={branchForm.name}
//               onChange={e => setBranchForm({ ...branchForm, name: e.target.value })} autoFocus />
//           </Field>
//           <Field label={t("masters.field.location")}>
//             <input className={inputClass} placeholder={t("masters.ph.location")} value={branchForm.location}
//               onChange={e => setBranchForm({ ...branchForm, location: e.target.value })} />
//           </Field>
//           <Field label={t("masters.field.manager")}>
//             <input className={inputClass} placeholder={t("masters.ph.manager")} value={branchForm.manager}
//               onChange={e => setBranchForm({ ...branchForm, manager: e.target.value })} />
//           </Field>
//         </Modal>
//       )}

//       {/* ── Add Supplier Modal ── */}
//       {modal === "supplier" && (
//         <Modal title={t("masters.modal.addSupplier")} onClose={() => setModal(null)} onSave={handleSaveSupplier} {...modalProps}>
//           {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//           <SectionLabel label="Supplier Details" />
//           <Field label={t("masters.field.supplierName")}>
//             <input className={inputClass} placeholder={t("masters.ph.supplierName")} value={supplierForm.name}
//               onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} autoFocus />
//           </Field>
//           <Field label="Category">
//             <select className={inputClass} value={supplierForm.category}
//               onChange={e => setSupplierForm({ ...supplierForm, category: e.target.value })}>
//               <option value="">Select category...</option>
//               {SUPPLIER_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
//             </select>
//           </Field>
//           <Field label="Phone Number">
//             <PhoneInput value={supplierForm.phone} countryCode={supplierForm.phoneCountry}
//               onValueChange={v => { setSupplierForm({ ...supplierForm, phone: v }); setPhoneError(""); }}
//               onCountryChange={code => { setSupplierForm({ ...supplierForm, phoneCountry: code }); setPhoneError(""); }}
//               error={phoneError} />
//           </Field>
//           <Field label="Email">
//             <input type="email" className={inputClass} placeholder="supplier@example.com"
//               value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} />
//           </Field>
//           <Field label="Address">
//             <input className={inputClass} placeholder="Cairo, Egypt"
//               value={supplierForm.address} onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })} />
//           </Field>
//           <div className="grid grid-cols-2 gap-3">
//             <Field label="Website">
//               <input className={inputClass} placeholder="https://..."
//                 value={supplierForm.website} onChange={e => setSupplierForm({ ...supplierForm, website: e.target.value })} />
//             </Field>
//             <Field label="Commercial Reg. No.">
//               <input className={inputClass} placeholder="e.g. 226564656"
//                 value={supplierForm.commercial_reg_number}
//                 onChange={e => setSupplierForm({ ...supplierForm, commercial_reg_number: e.target.value })} />
//             </Field>
//           </div>
//           <SectionLabel label="Agent / Business Details" />
//           <Field label="Agent Name">
//             <input className={inputClass} placeholder="Agent name" value={supplierForm.agent_name}
//               onChange={e => setSupplierForm({ ...supplierForm, agent_name: e.target.value })} />
//           </Field>
//           <Field label="Agent Phone">
//             <PhoneInput value={supplierForm.agentPhone} countryCode={supplierForm.agentPhoneCountry}
//               onValueChange={v => { setSupplierForm({ ...supplierForm, agentPhone: v }); setAgentPhoneError(""); }}
//               onCountryChange={code => { setSupplierForm({ ...supplierForm, agentPhoneCountry: code }); setAgentPhoneError(""); }}
//               error={agentPhoneError} />
//           </Field>
//           <Field label={t("masters.field.notes")}>
//             <textarea className={inputClass} rows={2} placeholder={t("masters.ph.notes")}
//               value={supplierForm.notes} onChange={e => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
//           </Field>
//         </Modal>
//       )}

//       {/* ── Add Item Modal ── */}
//       {modal === "item" && (
//         <Modal title={t("masters.modal.addItem")} onClose={() => setModal(null)} onSave={handleSaveItem} {...modalProps}>
//           {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//           <div className="grid grid-cols-2 gap-3">
//             <Field label={t("masters.field.itemName")}>
//               <input className={inputClass} placeholder={t("masters.ph.itemName")} value={itemForm.name}
//                 onChange={e => setItemForm({ ...itemForm, name: e.target.value })} autoFocus />
//             </Field>
//             <Field label={t("masters.field.category")}>
//               <select className={inputClass} value={itemForm.category}
//                 onChange={e => setItemForm(prev => ({ ...prev, category: e.target.value, sku_prefix: "", sku: "" }))}>
//                 <option value="raw_material">{t("masters.cat.rawMaterial")}</option>
//                 <option value="finished_good">{t("masters.cat.finishedGood")}</option>
//               </select>
//             </Field>
//           </div>
//           <Field label={t("masters.field.unit")}>
//             <input className={inputClass} placeholder={t("masters.ph.unit")} value={itemForm.unit}
//               onChange={e => setItemForm(prev => ({ ...prev, unit: e.target.value }))} />
//           </Field>
//           <div className="grid grid-cols-2 gap-3">
//             <Field label={t("masters.field.standardCost")}>
//               <input className={inputClass} type="number" min={0} step={0.01}
//                 placeholder={t("masters.ph.price")} value={itemForm.standard_cost || ""}
//                 onChange={e => setItemForm(prev => ({ ...prev, standard_cost: Number(e.target.value) }))} />
//             </Field>
//             {itemForm.category === "finished_good" ? (
//               <Field label={t("masters.field.salePrice")}>
//                 <input className={inputClass} type="number" min={0} step={0.01}
//                   placeholder={t("masters.ph.price")} value={itemForm.sale_price || ""}
//                   onChange={e => setItemForm(prev => ({ ...prev, sale_price: Number(e.target.value) }))} />
//               </Field>
//             ) : (
//               <Field label={t("masters.field.reorderLevel")}>
//                 <input className={inputClass} type="number" min={0} placeholder="0"
//                   value={itemForm.reorder_level || ""}
//                   onChange={e => setItemForm(prev => ({ ...prev, reorder_level: Number(e.target.value) }))} />
//               </Field>
//             )}
//           </div>
//           <SkuSelector
//             prefixes={skuPrefixes}
//             loading={skuPrefixLoading}
//             category={itemForm.category}
//             selectedPrefix={itemForm.sku_prefix}
//             manualSku={itemForm.sku}
//             onPrefixChange={prefix => setItemForm(prev => ({ ...prev, sku_prefix: prefix, sku: "" }))}
//             onManualSkuChange={sku => setItemForm(prev => ({ ...prev, sku }))}
//           />
//           {itemForm.category === "raw_material" && (
//             <Field label="Initial Supplier (optional — auto-records starting price)">
//               <select
//                 className={inputClass}
//                 value={itemForm.supplier_id || ""}
//                 onChange={e => setItemForm(prev => ({ ...prev, supplier_id: Number(e.target.value) }))}
//               >
//                 <option value="">— Skip (no price record) —</option>
//                 {supplierList.map(s => (
//                   <option key={s.id} value={s.id}>{s.name}</option>
//                 ))}
//               </select>
//               {itemForm.supplier_id > 0 && itemForm.standard_cost > 0 && (
//                 <p className="text-[11px] text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
//                   <CheckCircle className="w-3 h-3 shrink-0" />
//                   Will auto-record {formatCurrency(itemForm.standard_cost)} {currencyLabel} to price history on save.
//                 </p>
//               )}
//             </Field>
//           )}
//         </Modal>
//       )}

//       {/* ── Edit Item Modal ── */}
//       {modal === "editItem" && editingItem && (
//         <Modal
//           title={`Edit ${editingItem.category === "finished_good" ? "Finished Good" : "Raw Material"}`}
//           onClose={() => { setModal(null); setEditingItem(null); }}
//           onSave={handleUpdateItem}
//           {...modalProps}
//         >
//           {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//           <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
//             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${editingItem.category === "finished_good" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
//               {editingItem.category === "finished_good" ? "Finished Good" : "Raw Material"}
//             </span>
//             {editingItem.sku && (
//               <span className="text-xs text-muted-foreground font-mono">{editingItem.sku}</span>
//             )}
//           </div>
//           <div className="grid grid-cols-2 gap-3">
//             <Field label="Item Name">
//               <input className={inputClass} placeholder="Item name" value={editItemForm.name}
//                 onChange={e => setEditItemForm(prev => ({ ...prev, name: e.target.value }))} autoFocus />
//             </Field>
//             <Field label="Unit">
//               <input className={inputClass} placeholder="kg / pcs / L" value={editItemForm.unit}
//                 onChange={e => setEditItemForm(prev => ({ ...prev, unit: e.target.value }))} autoFocus />
//             </Field>
//           </div>
//           <div className="grid grid-cols-2 gap-3">
//             <Field label={`Standard Cost (${currencyLabel})`}>
//               <input className={inputClass} type="number" min={0} step={0.01}
//                 value={editItemForm.standard_cost || ""}
//                 onChange={e => setEditItemForm(prev => ({ ...prev, standard_cost: Number(e.target.value) }))} />
//             </Field>
//             {editingItem.category === "finished_good" ? (
//               <Field label={`Sale Price (${currencyLabel})`}>
//                 <input className={inputClass} type="number" min={0} step={0.01}
//                   value={editItemForm.sale_price || ""}
//                   onChange={e => setEditItemForm(prev => ({ ...prev, sale_price: Number(e.target.value) }))} />
//               </Field>
//             ) : (
//               <Field label="Reorder Level">
//                 <input className={inputClass} type="number" min={0}
//                   value={editItemForm.reorder_level || ""}
//                   onChange={e => setEditItemForm(prev => ({ ...prev, reorder_level: Number(e.target.value) }))} />
//               </Field>
//             )}
//           </div>
//           <SkuSelector
//             prefixes={skuPrefixes}
//             loading={skuPrefixLoading}
//             category={editingItem.category}
//             selectedPrefix={editItemForm.sku_prefix}
//             manualSku={editItemForm.sku}
//             onPrefixChange={prefix => setEditItemForm(prev => ({ ...prev, sku_prefix: prefix, sku: "" }))}
//             onManualSkuChange={sku => setEditItemForm(prev => ({ ...prev, sku }))}
//           />
//         </Modal>
//       )}

//       {/* ── User Modal ── */}
//       {modal === "user" && (
//         <Modal title={t("masters.modal.addUser")} onClose={() => setModal(null)} onSave={handleSaveUser} {...modalProps}>
//           {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//           <Field label={t("masters.field.username")}>
//             <input className={inputClass} placeholder={t("masters.ph.username")} value={userForm.username}
//               onChange={e => setUserForm({ ...userForm, username: e.target.value })} autoFocus />
//           </Field>
//           <Field label={t("masters.field.displayName")}>
//             <input className={inputClass} placeholder={t("masters.ph.displayName")} value={userForm.display_name}
//               onChange={e => setUserForm({ ...userForm, display_name: e.target.value })} />
//           </Field>
//           <Field label={t("masters.field.role")}>
//             <select className={inputClass} value={userForm.role}
//               onChange={e => setUserForm({ ...userForm, role: e.target.value })}>
//               <option value="clerk">{t("masters.role.clerk")}</option>
//               <option value="manager">{t("masters.role.manager")}</option>
//               <option value="admin">{t("masters.role.admin")}</option>
//             </select>
//           </Field>
//           <p className="text-xs text-muted-foreground">
//             {t("masters.defaultPassword")}{" "}
//             <code className="bg-secondary px-1 rounded">{userForm.username || "username"}123</code>
//           </p>
//         </Modal>
//       )}

//       {/* ── Price Modal ── */}
//       {modal === "price" && (
//         <Modal title={t("masters.modal.recordPrice")} onClose={() => setModal(null)} onSave={handleSavePrice} {...modalProps}>
//           {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{error}</p>}
//           {/* Add this inside the Price Modal, right after the error line */}
//           <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
//             <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
//             <p className="text-xs text-amber-700 dark:text-amber-400">
//               This price will be recorded as <strong>pending</strong> and requires manager approval before updating the standard cost.
//             </p>
//           </div>
//           <Field label={t("masters.field.ingredient")}>
//             <select className={inputClass} value={priceForm.ingredient_id || ""}
//               onChange={e => setPriceForm({ ...priceForm, ingredient_id: Number(e.target.value) })}>
//               <option value="">{t("masters.ph.selectIngredient")}</option>
//               {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
//             </select>
//           </Field>
//           <Field label={t("masters.field.supplier")}>
//             <select className={inputClass} value={priceForm.supplier_id || ""}
//               onChange={e => setPriceForm({ ...priceForm, supplier_id: Number(e.target.value) })}>
//               <option value="">{t("masters.ph.selectSupplier")}</option>
//               {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
//             </select>
//           </Field>
//           <div className="grid grid-cols-2 gap-3">
//             <Field label={t("masters.field.price").replace("{currency}", currencyLabel)}>
//               <input type="number" min={0} step={0.01} className={inputClass}
//                 placeholder={t("masters.ph.price")} value={priceForm.price || ""}
//                 onChange={e => setPriceForm({ ...priceForm, price: Number(e.target.value) })} />
//             </Field>
//             <Field label={t("masters.field.date")}>
//               <input type="date" className={inputClass} value={priceForm.purchase_date}
//                 onChange={e => setPriceForm({ ...priceForm, purchase_date: e.target.value })} />
//             </Field>
//           </div>
//           <Field label={t("masters.field.notes")}>
//             <textarea className={inputClass} rows={2} placeholder={t("masters.ph.priceNotes")}
//               value={priceForm.notes} onChange={e => setPriceForm({ ...priceForm, notes: e.target.value })} />
//           </Field>
//         </Modal>
//       )}

//       {/* ── Page Header ── */}
//       <div className="flex items-center justify-between flex-wrap gap-4">
//         <div>
//           <h1 className="text-3xl font-bold text-primary">
//             {pageInfo.title}
//           </h1>

//           <p className="text-muted-foreground mt-1">
//             {pageInfo.subtitle}
//           </p>
//         </div>
//         <div className="flex items-center gap-3">
//           {tab === "suppliers" && !supplierView && (
//             <Button
//               size="sm"
//               className="gap-2"
//               onClick={() => openModal("supplier")}
//               disabled={selectedPeriodClosed}
//             >
//               <Plus className="w-4 h-4" />
//               {t("masters.add.supplier")}
//             </Button>
//           )}
//           {tab === "branches" && !branchView && (
//             <Button
//               size="sm"
//               className="gap-2"
//               onClick={() => openModal("branch")}
//               disabled={selectedPeriodClosed}
//             >
//               <Plus className="w-4 h-4" />
//               {t("masters.add.branch")}
//             </Button>
//           )}
//           {tab === "items" && (
//             <div className="flex items-center gap-2">
//               {items && items.length > 0 && (
//                 <Button
//                   size="sm"
//                   variant="outline"
//                   className="gap-2"
//                   onClick={() => exportItemsPDF(items as ItemRow[], currencyLabel)}
//                 >
//                   <FileDown className="w-4 h-4" />
//                   Export PDF
//                 </Button>
//               )}

//               <Button
//                 size="sm"
//                 className="gap-2"
//                 onClick={() => openModal("item")}
//                 disabled={selectedPeriodClosed}
//               >
//                 <Plus className="w-4 h-4" />
//                 {t("masters.add.item")}
//               </Button>
//             </div>
//           )}
//           <span
//             className={`text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
//               selectedPeriodLocked
//                 ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
//                 : selectedPeriodClosed
//                 ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
//                 : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
//             }`}
//           >
//             {selectedPeriodLocked
//               ? <Lock className="w-3 h-3" />
//               : selectedPeriodClosed
//               ? <Lock className="w-3 h-3" />
//               : <Activity className="w-3 h-3" />}

//             {selectedPeriodState.toUpperCase()}
//           </span>
//         </div>
//       </div>

//       {selectedPeriodClosed && (
//         <Card className={`p-4 ${selectedPeriodLocked ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20" : "border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20"}`}>
//           <p className={`flex items-center gap-2 text-sm ${selectedPeriodLocked ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
//             <Lock className="h-4 w-4 flex-shrink-0" />
//             {selectedPeriodLocked
//               ? `${workingPeriod} is locked. No master data changes are allowed.`
//               : `${workingPeriod} is closed. Adding or deleting records is restricted.`}
//           </p>
//         </Card>
//       )}

//       <div>

//   {/* ── Branches ── */}

//         {/* ── Branches ── */}
//         {tab === "branches" && (
//           <>
//             {branchView ? (
//               <BranchDetailView b={branchView} selectedPeriodClosed={selectedPeriodClosed}
//                 onBack={() => setBranchView(null)} onDelete={() => handleDeleteBranch(branchView)} />
//             ) : (
//               <>
//               {!branchLoading && branchList.length > 0 && (
//                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
//                   {[
//                     {
//                       label: "Total Branches",
//                       value: branchList.length,
//                       color: "text-green-600 dark:text-green-400",
//                     },
//                     {
//                       label: "Active",
//                       value: branchList.filter(b => b.is_active !== false).length,
//                       color: "text-blue-600 dark:text-blue-400",
//                     },
//                     {
//                       label: "Managers Assigned",
//                       value: branchList.filter(b => b.manager?.trim()).length,
//                       color: "text-violet-600 dark:text-violet-400",
//                     },
//                   ].map((stat, i) => (
//                     <Card key={i} className="p-4">
//                       <p className="text-xs text-muted-foreground font-medium">
//                         {stat.label}
//                       </p>
//                       <p className={`text-3xl font-bold mt-1 ${stat.color}`}>
//                         {stat.value}
//                       </p>
//                     </Card>
//                   ))}
//                 </div>
//               )}
//                 <div className="relative mb-5 w-full lg:max-w-2xl">
//                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
//                   <input className={inputClass + " pl-9"} placeholder="Search branches..."
//                     value={branchSearch} onChange={e => setBranchSearch(e.target.value)} />
//                 </div>
//                 {branchLoading ? (
//                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
//                     {[1, 2, 3].map(i => (
//                       <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
//                         <div className="flex gap-3">
//                           <div className="w-11 h-11 rounded-full bg-secondary/70 shrink-0" />
//                           <div className="flex-1 space-y-2 pt-1">
//                             <div className="h-3 w-16 bg-secondary/70 rounded" />
//                             <div className="h-4 w-32 bg-secondary/70 rounded" />
//                           </div>
//                         </div>
//                         <div className="flex gap-2 pt-2 border-t border-border">
//                           <div className="h-8 flex-1 bg-secondary/70 rounded-lg" />
//                           <div className="h-8 flex-1 bg-secondary/70 rounded-lg" />
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 ) : !branchList.length ? <EmptyState label={t("masters.empty.branches")} />
//                   : !filteredBranches.length ? (
//                     <div className="py-16 text-center space-y-2">
//                       <p className="text-sm text-muted-foreground">No branches match your search.</p>
//                       <button onClick={() => setBranchSearch("")} className="text-xs text-primary hover:underline">Clear search</button>
//                     </div>
//                   ) : (
//                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
//                       {filteredBranches.map(b => (
//                         <BranchCard key={b.id} b={b} selectedPeriodClosed={selectedPeriodClosed}
//                           onShow={() => setBranchView(b)} onDelete={() => handleDeleteBranch(b)} />
//                       ))}
//                     </div>
//                   )}
//               </>
//             )}
//           </>
//         )}

//         {/* ── Suppliers ── */}
//         {tab === "suppliers" && (
//           <>
//             {supplierView ? (
//               <SupplierDetailView s={supplierView} selectedPeriodClosed={selectedPeriodClosed}
//                 onBack={() => setSupplierView(null)} onDelete={() => handleDeleteSupplier(supplierView)} />
//             ) : (
//               <>
//                 {!supplierLoading && supplierList.length > 0 && (
//                   <div className="grid grid-cols-3 gap-4 mb-6">
//                     {[
//                       { label: "Total Suppliers", value: supplierList.length,                                           color: "text-green-600 dark:text-green-400"   },
//                       { label: "Active",           value: supplierList.length,                                           color: "text-blue-600 dark:text-blue-400"     },
//                       { label: "Categories",       value: new Set(supplierList.map(s => s.category || "General")).size, color: "text-violet-600 dark:text-violet-400" },
//                     ].map((stat, i) => (
//                       <Card key={i} className="p-4">
//                         <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
//                         <p className={`text-3xl font-bold mt-1 ${stat.color}`}>{stat.value}</p>
//                       </Card>
//                     ))}
//                   </div>
//                 )}
//                 <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
//                 <div className="relative w-full lg:flex-1">
//                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
//                   <input className={inputClass + " pl-9"} placeholder="Search suppliers..."
//                     value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} />
//                 </div>
//                 {!supplierLoading && activeCategories.length > 1 && (
//                   <div className="flex flex-wrap gap-2">
//                     <button
//                       onClick={() => setSupplierCategoryFilter("")}
//                       className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${!supplierCategoryFilter ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border hover:border-primary"}`}
//                     >
//                       All ({supplierList.length})
//                     </button>
//                     {activeCategories.map(cat => (
//                       <button
//                         key={cat}
//                         onClick={() => setSupplierCategoryFilter(cat === supplierCategoryFilter ? "" : cat)}
//                         className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${supplierCategoryFilter === cat ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border hover:border-primary"}`}
//                       >
//                         <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${supplierCatColor(cat).split(" ")[0]}`} />
//                         {cat} ({supplierList.filter(s => (s.category || "General") === cat).length})
//                       </button>
//                     ))}
//                   </div>
//                 )}
//                 </div>

//                 {supplierLoading ? (
//                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
//                     {[1, 2, 3].map(i => (
//                       <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
//                         <div className="flex gap-3">
//                           <div className="w-11 h-11 rounded-full bg-secondary/70 shrink-0" />
//                           <div className="flex-1 space-y-2 pt-1">
//                             <div className="h-3 w-16 bg-secondary/70 rounded" />
//                             <div className="h-4 w-32 bg-secondary/70 rounded" />
//                           </div>
//                         </div>
//                         <div className="flex gap-2 pt-2 border-t border-border">
//                           <div className="h-8 flex-1 bg-secondary/70 rounded-lg" />
//                           <div className="h-8 flex-1 bg-secondary/70 rounded-lg" />
//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 ) : !supplierList.length ? <EmptyState label={t("masters.empty.suppliers")} />
//                   : !filteredSuppliers.length ? (
//                     <div className="py-16 text-center space-y-2">
//                       <p className="text-sm text-muted-foreground">No suppliers match your search.</p>
//                       <button onClick={() => setSupplierSearch("")} className="text-xs text-primary hover:underline">Clear search</button>
//                     </div>
//                   ) : (
//                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
//                       {filteredSuppliers.map(s => (
//                         <SupplierCard key={s.id} s={s} selectedPeriodClosed={selectedPeriodClosed}
//                           onShow={() => setSupplierView(s)} onDelete={() => handleDeleteSupplier(s)} />
//                       ))}
//                     </div>
//                   )}
//               </>
//             )}
//           </>
//         )}

//         {/* ── Items ── */}
//         {tab === "items" && (
//           <>

//             <div className="flex flex-wrap items-center gap-2 mb-5">
//               <div className="relative">
//                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
//                 <input className={inputClass + " pl-9 max-w-xs"} placeholder="Search by name or SKU..."
//                   value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
//               </div>
//               {(["all", "raw_material", "finished_good"] as const).map(f => (
//                 <button key={f} onClick={() => setItemFilter(f)}
//                   className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${itemFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border hover:border-primary"}`}>
//                   {f === "all" ? "All" : f === "raw_material" ? "Raw Materials" : "Finished Goods"}
//                 </button>
//               ))}
//               {(itemSearch || itemFilter !== "all") && (
//                 <span className="text-xs text-muted-foreground ml-1">
//                   {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""}
//                 </span>
//               )}
//             </div>
//             {itemLoading ? <SkeletonCards count={8} />
//               : !items?.length ? <EmptyState label={t("masters.empty.items")} />
//               : !filteredItems.length ? <EmptyState label="No items match your search." />
//               : (
//                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
//                   {filteredItems.map(item => (
//                     <ItemCard
//                       key={item.id}
//                       item={item}
//                       suppliers={supplierList}
//                       selectedPeriodClosed={selectedPeriodClosed}
//                       currencyLabel={currencyLabel}
//                       onImageUploaded={() => {
//                         invalidateCachedQueries(`master:${masterScope}:items`);
//                         refetchItemsRaw?.();
//                       }}
//                       onEdit={() => openEditItem(item)}
//                       onDelete={async () => {
//                         if (selectedPeriodClosed) return;
//                         if (!confirm(`Delete "${item.name}"?`)) return;
//                         try {
//                           await apiCall(
//                             item.category === "finished_good"
//                               ? `/api/products/${item.id}`
//                               : `/api/ingredients/${item.id}`,
//                             { method: "DELETE" }
//                           );
//                           invalidateCachedQueries(`master:${masterScope}:items`);
//                           invalidateCachedQueries(`master:${masterScope}:ingredients`);
//                           await refetchItemsRaw?.();
//                           await refetchIngredients?.();
//                         } catch {
//                           alert("Failed to delete item");
//                         }
//                       }}
//                     />
//                   ))}
//                 </div>
//               )}
//           </>
//         )}

//         {/* ── Users ── */}
//         {tab === "users" && (
//           <>
//             <div className="flex items-center justify-between mb-4">
//               <h2 className="text-lg font-semibold">{t("masters.tab.users")}</h2>
//               <Button size="sm" className="gap-2" onClick={() => openModal("user")} disabled={selectedPeriodClosed}>
//                 <Plus className="w-4 h-4" /> {t("masters.add.user")}
//               </Button>
//             </div>
//             {userLoading ? <SkeletonRows /> : !users?.length ? <EmptyState label={t("masters.empty.users")} /> : (
//               <>
//                 <div className="flex gap-2 mb-4 flex-wrap">
//                   {["", "owner", "admin", "manager", "accountant", "clerk"].map(role => {
//                     const count = role
//                       ? (users as UserRow[] ?? []).filter(u => u.role === role).length
//                       : (users as UserRow[] ?? []).length;
//                     if (count === 0 && role) return null;
//                     return (
//                       <button
//                         key={role}
//                         onClick={() => setUserRoleFilter(role)}
//                         className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border capitalize ${userRoleFilter === role ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-muted-foreground border-border hover:border-primary"}`}
//                       >
//                         {role || "All"} ({count})
//                       </button>
//                     );
//                   })}
//                 </div>
//                 <div className="space-y-2">
//                   {filteredUsers.map(u => (
//                     <div key={u.id} className={`flex items-center justify-between p-3 rounded-lg hover:bg-secondary transition-colors group ${u.id === currentUserId ? "bg-primary/5 border border-primary/20" : "bg-secondary/50"}`}>
//                       <div className="flex items-center gap-3">
//                         <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">
//                           {u.display_name.charAt(0).toUpperCase()}
//                         </div>
//                         <div>
//                           <p className="text-sm font-medium text-foreground flex items-center gap-1">
//                             {u.display_name}
//                             {u.id === currentUserId && (
//                               <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary ml-1">You</span>
//                             )}
//                           </p>
//                           <p className="text-xs text-muted-foreground">
//                             <span className="font-mono">US-{localNumber(u.user_number, u.id)}</span> · @{u.username}
//                           </p>
//                         </div>
//                       </div>
//                       <div className="flex items-center gap-2">
//                         <Badge label={u.role} color={roleColor(u.role)} />
//                         <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
//                       </div>
//                     </div>
//                   ))}
//                   {filteredUsers.length === 0 && (
//                     <EmptyState label={`No ${userRoleFilter} users found.`} />
//                   )}
//                 </div>
//               </>
//             )}

//           </>
//         )}

//         {/* ── Prices ── */}
//         {tab === "prices" && (
//           <>
//             <div className="flex items-center justify-between mb-4">
//               <h2 className="text-lg font-semibold">{t("masters.priceHistory.title")}</h2>
//               <div className="flex items-center gap-2">
//                 {priceHistory && priceHistory.length >= 2 && (
//                   <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowChangeLog(v => !v)}>
//                     <History className="w-4 h-4" />{showChangeLog ? "Hide" : "Change Log"}
//                   </Button>
//                 )}
//                 {priceHistory && priceHistory.length > 0 && (
//                   <Button size="sm" variant="outline" className="gap-2"
//                     onClick={() => exportPriceHistoryPDF(priceHistory, selectedIngredientName, currencyLabel)}>
//                     <FileDown className="w-4 h-4" />Export PDF
//                   </Button>
//                 )}
//                 <Button size="sm" className="gap-2" onClick={() => openModal("price")} disabled={selectedPeriodClosed}>
//                   <Plus className="w-4 h-4" /> {t("masters.add.price")}
//                 </Button>
//               </div>
//             </div>
//             <div className="mb-4">
//               <Field label={t("masters.field.ingredientHistory")}>
//                 {ingredientLoading ? <div className="h-10 bg-secondary/50 rounded animate-pulse" /> : (
//                 <div className="relative">
//                   <div className="relative">
//                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
//                     <input
//                       className={inputClass + " pl-9"}
//                       placeholder="Search ingredient..."
//                       value={showIngredientDropdown ? ingredientSearch : selectedIngredientName}
//                       onFocus={() => { setIngredientSearch(""); setShowIngredientDropdown(true); }}
//                       onBlur={() => setTimeout(() => setShowIngredientDropdown(false), 150)}
//                       onChange={e => { setIngredientSearch(e.target.value); setShowIngredientDropdown(true); }}
//                     />
//                     {selectedIngredient > 0 && (
//                       <button
//                         onClick={() => { setSelectedIngredient(0); setSelectedIngredientName(""); setIngredientSearch(""); }}
//                         className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
//                       >
//                         <X className="w-3.5 h-3.5" />
//                       </button>
//                     )}
//                   </div>
//                   {showIngredientDropdown && filteredIngredients.length > 0 && (
//                     <div className="absolute z-20 mt-1 w-full bg-background border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
//                       {filteredIngredients.map(i => (
//                         <button
//                           key={i.id}
//                           className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
//                           onMouseDown={() => {
//                             setSelectedIngredient(i.id);
//                             setSelectedIngredientName(i.name);
//                             setIngredientSearch("");
//                             setShowIngredientDropdown(false);
//                             setShowChangeLog(false);
//                           }}
//                         >
//                           <span className="font-medium text-foreground">{i.name}</span>
//                           <span className="text-xs text-muted-foreground font-mono">
//                             {formatCurrency(Number(i.cost_per_unit))} / {i.unit}
//                           </span>
//                         </button>
//                       ))}
//                     </div>
//                   )}
//                 </div>
//                 )}
//                 </Field>
//             </div>
//             {!selectedIngredient ? (
//               <div className="py-12 text-center text-muted-foreground text-sm">{t("masters.empty.selectIngredient")}</div>
//             ) : priceLoading ? <SkeletonRows count={3} />
//               : !priceHistory?.length ? <EmptyState label={t("masters.empty.prices")} />
//               : (
//                 <>
//                   {priceHistory.length >= 2 && (() => {
//                     const latest  = priceHistory[0].price;
//                     const oldest  = priceHistory[priceHistory.length - 1].price;
//                     const diff    = latest - oldest;
//                     const pct     = oldest > 0 ? (diff / oldest) * 100 : 0;

//                     // Standard cost from ingredients list for variance vs market
//                     const stdCost = ingredients?.find(
//                       i => i.id === selectedIngredient
//                     )?.cost_per_unit ?? null;
//                     const latestMarket = priceHistory.find(
//                       r => (r.price_type === "market_price" || !r.price_type) && r.status === "approved"
//                     );
//                     const variance    = stdCost != null && latestMarket
//                       ? latestMarket.price - stdCost
//                       : null;
//                     const variancePct = stdCost && stdCost > 0 && variance != null
//                       ? (variance / stdCost) * 100
//                       : null;

//                     return (
//                       <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
//                         <div className="p-3 rounded-lg bg-secondary/40 border border-border text-xs space-y-1">
//                           <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Latest Price</p>
//                           <p className="font-bold text-foreground text-sm">{formatCurrency(latest)} {currencyLabel}</p>
//                         </div>
//                         <div className="p-3 rounded-lg bg-secondary/40 border border-border text-xs space-y-1">
//                           <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Overall Change</p>
//                           <p className={`font-bold text-sm flex items-center gap-1 ${diff > 0 ? "text-red-500" : diff < 0 ? "text-green-600" : "text-muted-foreground"}`}>
//                             {diff > 0 ? <TrendingUp className="w-3 h-3" /> : diff < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
//                             {diff > 0 ? "+" : ""}{formatCurrency(diff)} ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)
//                           </p>
//                         </div>
//                         <div className="p-3 rounded-lg bg-secondary/40 border border-border text-xs space-y-1">
//                           <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Standard Cost</p>
//                           <p className="font-bold text-foreground text-sm">
//                             {stdCost != null ? `${formatCurrency(stdCost)} ${currencyLabel}` : <span className="text-muted-foreground">—</span>}
//                           </p>
//                         </div>
//                         <div className={`p-3 rounded-lg border text-xs space-y-1 ${variance == null ? "bg-secondary/40 border-border" : variance > 0 ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700/40" : variance < 0 ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/40" : "bg-secondary/40 border-border"}`}>
//                           <p className="text-muted-foreground font-medium uppercase tracking-wider text-[10px]">Market vs Standard</p>
//                           {variance == null ? (
//                             <p className="text-muted-foreground text-sm font-bold">—</p>
//                           ) : (
//                             <p className={`font-bold text-sm flex items-center gap-1 ${variance > 0 ? "text-red-500" : variance < 0 ? "text-green-600" : "text-muted-foreground"}`}>
//                               {variance > 0 ? <TrendingUp className="w-3 h-3" /> : variance < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
//                               {variance > 0 ? "+" : ""}{formatCurrency(variance)} ({variancePct != null ? `${variancePct > 0 ? "+" : ""}${variancePct.toFixed(1)}%` : "—"})
//                             </p>
//                           )}
//                         </div>
//                         <div className="col-span-2 lg:col-span-4 flex justify-end">
//                           <span className="text-xs text-muted-foreground">{priceHistory.length} records</span>
//                         </div>
//                       </div>
//                     );
//                   })()}
//                   <div className="overflow-x-auto">
//                     <table className="w-full text-sm">
//                       <thead className="bg-secondary">
//                         <tr>
//                           <th className="px-4 py-2 text-left font-semibold text-foreground">{t("masters.priceHistory.date")}</th>
//                           <th className="px-4 py-2 text-left font-semibold text-foreground">Status</th>
//                           <th className="px-4 py-2 text-left font-semibold text-foreground">{t("masters.priceHistory.supplier")}</th>
//                           <th className="px-4 py-2 text-left font-semibold text-foreground">Type</th>
//                           <th className="px-4 py-2 text-right font-semibold text-foreground">{t("masters.priceHistory.price").replace("{currency}", currencyLabel)}</th>
//                           <th className="px-4 py-2 text-center font-semibold text-foreground">vs Previous</th>
//                           <th className="px-4 py-2 text-left font-semibold text-foreground">{t("masters.priceHistory.notes")}</th>
//                         </tr>
//                       </thead>
//                       <tbody>
//                         {priceHistory.map((row, i) => {
//                           const prev = priceHistory[i + 1];
//                           const diff = prev ? row.price - prev.price : null;
//                           const pct  = prev && prev.price > 0 ? (diff! / prev.price) * 100 : null;
//                           return (
//                             <tr
//                               key={i}
//                               className={`border-b border-border hover:bg-secondary/50 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/20"}`}
//                             >
//                               <td className="px-4 py-3 text-foreground text-xs">{row.purchase_date}</td>
//                               <td className="px-4 py-3">
//                                 {row.status === "pending" && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
//                                     Pending
//                                   </span>
//                                 )}
//                                 {row.status === "approved" && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
//                                     Approved
//                                   </span>
//                                 )}
//                                 {row.status === "rejected" && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
//                                     Rejected
//                                   </span>
//                                 )}
//                               </td>
//                               <td className="px-4 py-3 font-medium text-foreground">{row.supplier_name}</td>

//                               <td className="px-4 py-3">
//                                 {row.price_type === "initial_cost" && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
//                                     Initial
//                                   </span>
//                                 )}
//                                 {(row.price_type === "market_price" || !row.price_type) && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
//                                     Market
//                                   </span>
//                                 )}
//                                 {row.price_type === "contract_price" && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
//                                     Contract
//                                   </span>
//                                 )}
//                                 {row.price_type === "spot_price" && (
//                                   <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
//                                     Spot
//                                   </span>
//                                 )}
//                               </td>

//                               <td className="px-4 py-3 text-right font-bold text-primary">
//                                 {formatCurrency(row.price)}
//                               </td>

//                               <td className="px-4 py-3 text-center">
//                                 {diff === null ? (
//                                   <span className="text-muted-foreground text-xs">—</span>
//                                 ) : diff > 0 ? (
//                                   <span className="flex items-center justify-center gap-1 text-red-500 text-xs font-semibold">
//                                     <TrendingUp className="w-3 h-3" />
//                                     +{formatCurrency(diff)} ({pct!.toFixed(1)}%)
//                                   </span>
//                                 ) : diff < 0 ? (
//                                   <span className="flex items-center justify-center gap-1 text-green-600 text-xs font-semibold">
//                                     <TrendingDown className="w-3 h-3" />
//                                     {formatCurrency(diff)} ({pct!.toFixed(1)}%)
//                                   </span>
//                                 ) : (
//                                   <span className="text-muted-foreground text-xs">No change</span>
//                                 )}
//                               </td>

//                               <td className="px-4 py-3 text-muted-foreground text-xs">{row.notes || "—"}</td>
//                             </tr>
//                           );
//                         })}
//                       </tbody>
//                     </table>
//                   </div>
//                   {showChangeLog && <PriceChangeHistory rows={priceHistory} currencyLabel={currencyLabel} />}
//                 </>
//               )}
//           </>
//         )}

//         {/* ── SKU Prefixes ── */}
//         {tab === "skuPrefixes" && (
//           <SkuPrefixManager
//             prefixes={skuPrefixes}
//             loading={skuPrefixLoading}
//             onRefresh={() => refetchSkuPrefixes?.()}
//             selectedPeriodClosed={selectedPeriodClosed}
//           />
//         )}

//       </div>
//     </div>
//   );
// }
import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, X, Package, Truck, Users, Loader2, AlertCircle, FileDown, History,
  TrendingUp, TrendingDown, Minus, Lock, Search, ChevronLeft, Eye, Phone,
  Mail, MapPin, Globe, Tag, Upload, Pencil, Activity, CheckCircle,
} from "lucide-react";
import { useCachedQuery, readCachedQuery, writeCachedQuery, invalidateCachedQueries } from "@/hooks/useCachedQuery";
import {
  getBranches, getSuppliers, getItems, getUsers,
  addBranch, addSupplier, addItem, addUser,
  deleteSupplier, deleteBranch, apiCall, apiUpload, assetUrl,
  getSkuPrefixes, addSkuPrefix, deleteSkuPrefix, seedSkuPrefixes,
  type SkuPrefixRow,
} from "@/lib/api";
import type { Branch, UserRow, ItemRow, SupplierRow } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency, getCurrencyLabel } from "@/lib/localization";
import { useWorkingPeriod } from "@/contexts/Workingperiodcontext";

const MASTER_CACHE_TTL = 5 * 60_000;

// ─── Types & constants ────────────────────────────────────────────────────────

type ModalType = "branch" | "supplier" | "item" | "editItem" | "user" | "price" | "skuPrefix" | null;
type Tab = "branches" | "suppliers" | "items" | "users" | "prices" | "skuPrefixes";
type SkuType = "raw_material" | "finished_good" | "both";

interface PriceHistoryRow {
  id: number;
  purchase_date: string;
  supplier_name: string;
  price: number;
  price_type: "initial_cost" | "market_price" | "contract_price" | "spot_price" | null;
  status: "pending" | "approved" | "rejected";
  notes: string;
}

interface IngredientOption { id: number; name: string; unit: string; cost_per_unit: number }

const VALID_TABS: Tab[] = ["branches", "suppliers", "items", "users", "prices", "skuPrefixes"];

const PAGE_INFO: Record<Tab, { title: string; subtitle: string }> = {
  branches:    { title: "Branches",     subtitle: "Manage your company branches" },
  suppliers:   { title: "Suppliers",    subtitle: "Manage supplier information and purchasing relationships" },
  items:       { title: "Items",        subtitle: "Manage raw materials and finished goods" },
  users:       { title: "Users",        subtitle: "Manage system users and roles" },
  prices:      { title: "Prices",       subtitle: "Manage ingredient price history" },
  skuPrefixes: { title: "SKU Prefixes", subtitle: "Manage SKU numbering prefixes" },
};

const SUPPLIER_CATEGORIES = [
  "Food & Ingredients", "Beverages", "Dairy", "Meat & Poultry", "Seafood", "Bakery",
  "Frozen Goods", "Dry Goods", "Packaging", "Equipment", "Cleaning & Hygiene", "General",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  "Food & Ingredients": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "Beverages":          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Dairy":              "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  "Meat & Poultry":     "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Seafood":            "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  "Bakery":             "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "Frozen Goods":       "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  "Dry Goods":          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Packaging":          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "Equipment":          "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  "Cleaning & Hygiene": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
};
const supplierCatColor = (c?: string | null) => CATEGORY_COLORS[c ?? ""] ?? "bg-secondary text-muted-foreground";

const SKU_TYPE_LABEL: Record<SkuType, string> = { raw_material: "Raw Material", finished_good: "Finished Good", both: "Both" };
const SKU_TYPE_COLOR: Record<SkuType, string> = {
  raw_material:  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  finished_good: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  both:          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const ROLE_COLOR: Record<string, string> = {
  owner:   "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  admin:   "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  manager: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};
const roleColor = (role: string) => ROLE_COLOR[role] ?? "bg-secondary text-muted-foreground";

const PRICE_STATUS: Record<string, { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};
const PRICE_TYPE: Record<string, { label: string; cls: string }> = {
  initial_cost:   { label: "Initial",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  market_price:   { label: "Market",   cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  contract_price: { label: "Contract", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" },
  spot_price:     { label: "Spot",     cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
};

interface CountryPhone { code: string; name: string; dialCode: string; pattern: RegExp; placeholder: string; example: string }
const COUNTRY_PHONES: CountryPhone[] = [
  { code: "EG", name: "Egypt",        dialCode: "+20",  pattern: /^1[0-9]{9}$/,      placeholder: "1xxxxxxxxx",   example: "+20 10 1234 5678"  },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966", pattern: /^5[0-9]{8}$/,      placeholder: "5xxxxxxxx",    example: "+966 50 123 4567"  },
  { code: "AE", name: "UAE",          dialCode: "+971", pattern: /^5[0-9]{8}$/,      placeholder: "5xxxxxxxx",    example: "+971 50 123 4567"  },
  { code: "JO", name: "Jordan",       dialCode: "+962", pattern: /^7[789][0-9]{7}$/, placeholder: "7xxxxxxxx",    example: "+962 79 123 4567"  },
  { code: "KW", name: "Kuwait",       dialCode: "+965", pattern: /^[569][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+965 5123 4567"    },
  { code: "QA", name: "Qatar",        dialCode: "+974", pattern: /^[357][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+974 3312 3456"    },
  { code: "BH", name: "Bahrain",      dialCode: "+973", pattern: /^[369][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+973 3612 3456"    },
  { code: "OM", name: "Oman",         dialCode: "+968", pattern: /^[79][0-9]{7}$/,   placeholder: "xxxxxxxx",     example: "+968 9912 3456"    },
  { code: "LB", name: "Lebanon",      dialCode: "+961", pattern: /^[37][0-9]{7}$/,   placeholder: "xxxxxxxx",     example: "+961 3123 4567"    },
  { code: "IQ", name: "Iraq",         dialCode: "+964", pattern: /^7[0-9]{9}$/,      placeholder: "7xxxxxxxxx",   example: "+964 770 123 4567" },
  { code: "SY", name: "Syria",        dialCode: "+963", pattern: /^9[0-9]{8}$/,      placeholder: "9xxxxxxxx",    example: "+963 944 123 456"  },
  { code: "LY", name: "Libya",        dialCode: "+218", pattern: /^9[0-9]{8}$/,      placeholder: "9xxxxxxxx",    example: "+218 91 123 4567"  },
  { code: "TN", name: "Tunisia",      dialCode: "+216", pattern: /^[2-9][0-9]{7}$/,  placeholder: "xxxxxxxx",     example: "+216 20 123 456"   },
  { code: "DZ", name: "Algeria",      dialCode: "+213", pattern: /^[567][0-9]{8}$/,  placeholder: "xxxxxxxxx",    example: "+213 550 123 456"  },
  { code: "MA", name: "Morocco",      dialCode: "+212", pattern: /^[67][0-9]{8}$/,   placeholder: "xxxxxxxxx",    example: "+212 612 345 678"  },
  { code: "TR", name: "Turkey",       dialCode: "+90",  pattern: /^5[0-9]{9}$/,      placeholder: "5xxxxxxxxx",   example: "+90 530 123 4567"  },
  { code: "GB", name: "UK",           dialCode: "+44",  pattern: /^7[0-9]{9}$/,      placeholder: "7xxxxxxxxx",   example: "+44 7911 123456"   },
  { code: "US", name: "USA",          dialCode: "+1",   pattern: /^[2-9][0-9]{9}$/,  placeholder: "xxxxxxxxxx",   example: "+1 212 123 4567"   },
  { code: "DE", name: "Germany",      dialCode: "+49",  pattern: /^1[0-9]{10,11}$/,  placeholder: "1xxxxxxxxxxx", example: "+49 151 12345678"  },
  { code: "FR", name: "France",       dialCode: "+33",  pattern: /^[67][0-9]{8}$/,   placeholder: "xxxxxxxxx",    example: "+33 6 12 34 56 78" },
  { code: "IN", name: "India",        dialCode: "+91",  pattern: /^[6-9][0-9]{9}$/,  placeholder: "xxxxxxxxxx",   example: "+91 98765 43210"   },
  { code: "CN", name: "China",        dialCode: "+86",  pattern: /^1[3-9][0-9]{9}$/, placeholder: "1xxxxxxxxxx",  example: "+86 131 2345 6789" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().split("T")[0];
const localNumber = (value: number | null | undefined, fallback: number) => String(value ?? fallback).padStart(5, "0");
const initials = (name: string) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
const cacheKey = (scope: string, name: string) => `master:${scope}:${name}`;

function validatePhone(local: string, country: CountryPhone | null): string {
  if (!local || !country) return "";
  const digits = local.replace(/[\s\-().]/g, "");
  return country.pattern.test(digits) ? "" : `Invalid number for ${country.name}. Expected format: ${country.example}`;
}

function buildPhone(local: string, countryCode: string): string {
  if (!local) return "";
  const country = COUNTRY_PHONES.find(c => c.code === countryCode);
  return country ? `${country.dialCode} ${local.replace(/[\s\-().]/g, "")}` : local;
}

const inputClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

const redBtn =
  "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold " +
  "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 " +
  "dark:hover:bg-red-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

const ACTIVE_BADGE = "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400";

// ─── PDF export ───────────────────────────────────────────────────────────────

const PDF_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e293b;padding:40px}.header{border-bottom:3px solid #9c2177;padding-bottom:16px;margin-bottom:24px}.brand{font-size:11px;font-weight:700;letter-spacing:3px;color:#9c2177;text-transform:uppercase}h1{font-size:22px;font-weight:700;color:#0f172a;margin-top:6px}.sub{color:#64748b;font-size:12px;margin-top:4px}.stats{display:flex;gap:16px;margin-bottom:24px}.stat{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 20px;flex:1}.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#94a3b8}.stat-value{font-size:20px;font-weight:700;color:#0f172a;margin-top:4px}.stat-value.up{color:#16a34a}.stat-value.down{color:#dc2626}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;text-align:left;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#475569}td{padding:10px 12px;border-bottom:1px solid #f1f5f9}tr.even td{background:#fafafa}.right{text-align:right}.center{text-align:center}.bold{font-weight:700}.muted{color:#94a3b8}.up{color:#16a34a;font-weight:600}.down{color:#dc2626;font-weight:600}.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600}.fg{background:#dcfce7;color:#15803d}.rm{background:#fef3c7;color:#b45309}.footer{margin-top:32px;color:#94a3b8;font-size:11px;text-align:center}@media print{body{padding:20px}}`;

function printReport(title: string, heading: string, subtitle: string, statsHtml: string, tableHtml: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title><style>${PDF_CSS}</style></head><body>` +
    `<div class="header"><div class="brand">STARK AI — Enterprise Costing System</div><h1>${heading}</h1><div class="sub">${subtitle}</div></div>` +
    `<div class="stats">${statsHtml}</div>${tableHtml}` +
    `<div class="footer">STARK AI · Confidential · ${new Date().toISOString()}</div></body></html>`
  );
  win.document.close(); win.focus(); setTimeout(() => win.print(), 400);
}

const pdfStat = (label: string, value: string | number, cls = "") =>
  `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div></div>`;

function exportPriceHistoryPDF(rows: PriceHistoryRow[], name: string, cur: string) {
  const body = rows.map((r, i) => {
    const next = rows[i + 1];
    let change = `<td class="center muted">—</td>`;
    if (next) {
      const diff = r.price - next.price;
      const pct = next.price > 0 ? (Math.abs(diff) / next.price) * 100 : 0;
      change = diff > 0 ? `<td class="center up">▲ ${formatCurrency(diff)} (${pct.toFixed(1)}%)</td>`
             : diff < 0 ? `<td class="center down">▼ ${formatCurrency(Math.abs(diff))} (${pct.toFixed(1)}%)</td>`
             : `<td class="center muted">— No change</td>`;
    }
    return `<tr class="${i % 2 === 0 ? "even" : ""}"><td>${r.purchase_date}</td><td>${r.supplier_name}</td><td class="right bold">${formatCurrency(r.price)} ${cur}</td>${change}<td class="muted">${r.notes || "—"}</td></tr>`;
  }).join("");
  const latest = rows[0]?.price ?? 0, oldest = rows[rows.length - 1]?.price ?? 0, overall = latest - oldest;
  const pct = oldest > 0 ? Math.abs((overall / oldest) * 100).toFixed(1) : "0";
  printReport(
    `Price History — ${name}`, `Price History: ${name}`,
    `Generated on ${new Date().toLocaleDateString()} · ${rows.length} price records`,
    pdfStat("Latest Price", `${formatCurrency(latest)} ${cur}`) +
    pdfStat("Oldest Price", `${formatCurrency(oldest)} ${cur}`) +
    pdfStat("Overall Change", `${overall >= 0 ? "▲" : "▼"} ${formatCurrency(Math.abs(overall))} (${pct}%)`, overall >= 0 ? "up" : "down") +
    pdfStat("Total Records", rows.length),
    `<table><thead><tr><th>Date</th><th>Supplier</th><th class="right">Price (${cur})</th><th class="center">Change vs Previous</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`
  );
}

function exportItemsPDF(items: ItemRow[], cur: string) {
  const body = items.map((it, i) => {
    const fg = it.category === "finished_good";
    return `<tr class="${i % 2 === 0 ? "even" : ""}"><td class="bold">${it.name}</td><td class="muted">${it.sku || "—"}</td><td><span class="badge ${fg ? "fg" : "rm"}">${fg ? "Finished Good" : "Raw Material"}</span></td><td class="center">${it.unit}</td><td class="right bold">${formatCurrency(it.standard_cost ?? 0)} ${cur}</td><td class="right">${fg ? `${formatCurrency(it.sale_price ?? 0)} ${cur}` : `${it.reorder_level ?? 0} ${it.unit}`}</td></tr>`;
  }).join("");
  printReport(
    "Items — STARK AI", "Items / Ingredients Master List",
    `Generated on ${new Date().toLocaleDateString()} · ${items.length} items`,
    pdfStat("Total Items", items.length) +
    pdfStat("Raw Materials", items.filter(i => i.category === "raw_material").length) +
    pdfStat("Finished Goods", items.filter(i => i.category === "finished_good").length),
    `<table><thead><tr><th>Name</th><th>SKU</th><th>Category</th><th class="center">Unit</th><th class="right">Cost (${cur})</th><th class="right">Sale Price / Reorder</th></tr></thead><tbody>${body}</tbody></table>`
  );
}

// ─── Shared layout components (every tab uses these) ─────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest pt-1">{label}</p>;
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{message}</p>;
}

function EmptyState({ label }: { label: string }) {
  return <div className="py-12 text-center text-muted-foreground text-sm">{label}</div>;
}

function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
          <div className="flex gap-3">
            <div className="w-11 h-11 rounded-full bg-secondary/70 shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-16 bg-secondary/70 rounded" />
              <div className="h-4 w-32 bg-secondary/70 rounded" />
            </div>
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <div className="h-8 flex-1 bg-secondary/70 rounded-lg" />
            <div className="h-8 flex-1 bg-secondary/70 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => <div key={i} className="h-14 bg-secondary/50 rounded-lg animate-pulse" />)}
    </div>
  );
}

interface Stat { label: string; value: number | string; color: string }

function StatsRow({ stats }: { stats: Stat[] }) {
  return (
    <div className={`grid grid-cols-2 gap-4 mb-6 ${stats.length === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3"}`}>
      {stats.map(s => (
        <Card key={s.label} className="p-4">
          <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
          <p className={`text-2xl lg:text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
        </Card>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full lg:flex-1 lg:max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <input className={inputClass + " pl-9"} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function FilterPills({ options, value, onChange }: {
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
            value === o.value ? "bg-primary text-primary-foreground border-primary"
                              : "bg-secondary text-muted-foreground border-border hover:border-primary"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Same layout for every tab: Stats → Toolbar (filters left / actions right) → Content */
function MasterSection({
  stats, left, actions, loading, total, shown, emptyLabel, noMatchLabel, onClear, wide, plain, children,
}: {
  stats: Stat[]; left: React.ReactNode; actions: React.ReactNode;
  loading: boolean; total: number; shown: number;
  emptyLabel: string; noMatchLabel: string; onClear?: () => void;
  wide?: boolean;    // 4-column card grid (items)
  plain?: boolean;   // render children as-is instead of a card grid (prices table)
  children: React.ReactNode;
}) {
  return (
    <>
      {!loading && total > 0 && <StatsRow stats={stats} />}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 flex-1 min-w-0">{left}</div>
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      </div>
      {loading ? (plain ? <SkeletonRows /> : <SkeletonCards count={wide ? 8 : 3} />)
        : !total ? <EmptyState label={emptyLabel} />
        : !shown ? (
          <div className="py-16 text-center space-y-2">
            <p className="text-sm text-muted-foreground">{noMatchLabel}</p>
            {onClear && <button onClick={onClear} className="text-xs text-primary hover:underline">Clear search</button>}
          </div>
        )
        : plain ? <>{children}</>
        : <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${wide ? "lg:grid-cols-3 xl:grid-cols-4" : "lg:grid-cols-3"}`}>{children}</div>}
    </>
  );
}

/** Base card used by branches, suppliers, users and SKU prefixes */
function EntityCard({ avatar, avatarClass, code, title, lines, body, onShow, onDelete, closed, highlight }: {
  avatar: React.ReactNode; avatarClass: string; code: string; title: string;
  lines?: React.ReactNode; body?: React.ReactNode;
  onShow?: () => void; onDelete?: () => void; closed: boolean; highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-card p-5 flex flex-col gap-4 hover:shadow-md hover:border-primary/40 transition-all duration-200 ${highlight ? "border-primary/30" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${avatarClass}`}>{avatar}</div>
          <div className="min-w-0">
            <p className="text-[11px] font-mono text-primary leading-none mb-1">{code}</p>
            <p className="text-base font-bold text-foreground leading-snug truncate">{title}</p>
            {lines}
          </div>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${ACTIVE_BADGE}`}>Active</span>
      </div>
      {body && <div className="flex flex-col gap-1">{body}</div>}
      {(onShow || onDelete) && (
        <div className="flex gap-2 pt-1 border-t border-border mt-auto">
          {onShow && (
            <button onClick={onShow} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-foreground bg-secondary/60 hover:bg-secondary transition-colors">
              <Eye className="w-3.5 h-3.5" />View Details
            </button>
          )}
          {onDelete && (
            <button disabled={closed} onClick={onDelete} className={redBtn}>
              <X className="w-3.5 h-3.5" />Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const MetaLine = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">{icon}{text}</p>
);

function DetailRow({ icon, label, value, isLink }: { icon: React.ReactNode; label: string; value: string; isLink?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-muted-foreground font-medium mb-0.5">{label}</p>
        {isLink && value !== "—"
          ? <a href={value} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline truncate block">{value}</a>
          : <p className="text-sm font-semibold text-foreground break-words">{value}</p>}
      </div>
    </div>
  );
}

/** Shared detail page shell for branches and suppliers */
function DetailShell({ backLabel, deleteLabel, avatarClass, name, code, closed, onBack, onDelete, children }: {
  backLabel: string; deleteLabel: string; avatarClass: string; name: string; code: string;
  closed: boolean; onBack: () => void; onDelete: () => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />{backLabel}
        </button>
        <button disabled={closed} onClick={onDelete} className={redBtn.replace("flex-1 ", "") + " py-1.5"}>
          <X className="w-3.5 h-3.5" />{deleteLabel}
        </button>
      </div>
      <div className="flex items-center gap-4">
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0 ${avatarClass}`}>{initials(name)}</div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-foreground">{name}</h2>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${ACTIVE_BADGE}`}>Active</span>
          </div>
          <p className="text-sm text-primary font-mono mt-0.5">{code}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

function Modal({ title, onClose, onSave, saving, children, cancelLabel, saveLabel }: {
  title: string; onClose: () => void; onSave: () => void; saving: boolean;
  children: React.ReactNode; cancelLabel: string; saveLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg p-6 border border-border max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto flex-1 pr-1">{children}</div>
        <div className="flex justify-end gap-2 pt-4 mt-2 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={saving}>{cancelLabel}</Button>
          <Button onClick={onSave} disabled={saving} className="min-w-[80px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Form widgets ─────────────────────────────────────────────────────────────

function PhoneInput({ value, countryCode, onValueChange, onCountryChange, error }: {
  value: string; countryCode: string; onValueChange: (v: string) => void;
  onCountryChange: (code: string) => void; error?: string;
}) {
  const country = COUNTRY_PHONES.find(c => c.code === countryCode) ?? null;
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select className="px-2 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-36 shrink-0"
          value={countryCode} onChange={e => onCountryChange(e.target.value)}>
          <option value="">Country</option>
          {COUNTRY_PHONES.map(c => <option key={c.code} value={c.code}>{c.dialCode} {c.name}</option>)}
        </select>
        <div className="relative flex-1">
          {country && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none select-none">{country.dialCode}</span>}
          <input className={`${inputClass} ${country ? "pl-12" : ""} ${error ? "border-red-400 focus:ring-red-400" : ""}`}
            placeholder={country?.placeholder ?? "Enter number"} value={value} onChange={e => onValueChange(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3 shrink-0" />{error}</p>}
      {!error && country && value && <p className="text-xs text-muted-foreground">Full: {country.dialCode} {value}</p>}
    </div>
  );
}

function SkuSelector({ prefixes, loading, category, selectedPrefix, manualSku, onPrefixChange, onManualSkuChange }: {
  prefixes: SkuPrefixRow[]; loading: boolean; category: string; selectedPrefix: string; manualSku: string;
  onPrefixChange: (p: string) => void; onManualSkuChange: (s: string) => void;
}) {
  const filtered = prefixes.filter(p => p.item_type === category || p.item_type === "both");
  return (
    <div className="space-y-3 p-3 rounded-lg bg-secondary/30 border border-border">
      <div className="flex items-center gap-2">
        <Tag className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground">SKU</span>
        <span className="text-[11px] text-muted-foreground">— pick a prefix; number auto-increments</span>
      </div>
      <Field label="Prefix">
        {loading ? <div className="h-9 bg-secondary/50 rounded-md animate-pulse" /> : (
          <select className={inputClass} value={selectedPrefix}
            onChange={e => { onPrefixChange(e.target.value); onManualSkuChange(""); }}>
            <option value="">— Auto (default prefix) —</option>
            {filtered.map(p => <option key={p.id} value={p.prefix}>{p.label} · {p.prefix}-XXXXX</option>)}
          </select>
        )}
        {selectedPrefix && !manualSku && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Will generate: <span className="font-mono font-semibold text-primary">{selectedPrefix}-00001</span>,{" "}
            <span className="font-mono text-primary">{selectedPrefix}-00002</span>, …
          </p>
        )}
      </Field>
      <Field label="Manual SKU (optional — overrides auto)">
        <input className={inputClass} value={manualSku} onChange={e => onManualSkuChange(e.target.value)}
          placeholder={selectedPrefix ? `${selectedPrefix}-XXXXX or leave blank` : "Leave blank to auto-generate"} />
        {manualSku && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 shrink-0" />Manual SKU — auto-increment disabled for this item.
          </p>
        )}
      </Field>
    </div>
  );
}

// ─── Item card ────────────────────────────────────────────────────────────────

function ItemCard({ item, suppliers, closed, currencyLabel, onDelete, onEdit, onImageUploaded }: {
  item: ItemRow; suppliers: SupplierRow[]; closed: boolean; currencyLabel: string;
  onDelete: () => void; onEdit: () => void; onImageUploaded: () => void;
}) {
  const isFG = item.category === "finished_good";
  const [uploading, setUploading] = useState(false);
  const supplierName = item.supplier_name ?? suppliers.find(s => s.id === item.supplier_id)?.name ?? "";

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await apiUpload<{ image_url?: string }>(
        `/api/products/${item.id}/image?category=${isFG ? "finished_good" : "raw_material"}`, formData
      );
      if (result?.image_url) item.image_url = result.image_url;
      onImageUploaded();
    } catch {
      alert("Image upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  const Cell = ({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) => (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-0.5">{label}</p>
      {children}
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md hover:border-primary/40 transition-all duration-200 flex flex-col group">
      <div className="relative h-36 bg-secondary/40 flex items-center justify-center shrink-0 overflow-hidden">
        {item.image_url ? (
          <img src={assetUrl(item.image_url)} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 select-none pointer-events-none">
            <Package className="w-10 h-10 text-muted-foreground/30" />
            <span className="text-[10px] font-semibold text-muted-foreground/40 tracking-widest uppercase">No Image</span>
          </div>
        )}
        {!closed && (
          <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
            {uploading ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : (
              <div className="flex flex-col items-center gap-1 text-white">
                <Upload className="w-5 h-5" /><span className="text-[10px] font-semibold">Upload Image</span>
              </div>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageUpload} disabled={uploading} />
          </label>
        )}
        <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${SKU_TYPE_COLOR[isFG ? "finished_good" : "raw_material"]}`}>
          {isFG ? "Finished Good" : "Raw Material"}
        </span>
        <span className={`absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${ACTIVE_BADGE}`}>Active</span>
      </div>
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div>
          <p className="text-[11px] font-mono text-primary leading-none mb-1">{isFG ? "FG" : "RM"}-{localNumber(item.display_number, item.id)}</p>
          <p className="text-sm font-bold text-foreground leading-snug">{item.name}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {item.sku && <Cell label="SKU" span><p className="text-xs font-semibold text-foreground font-mono">{item.sku}</p></Cell>}
          <Cell label="Unit"><p className="text-xs font-semibold text-foreground">{item.unit}</p></Cell>
          {item.category_label && <Cell label="Category"><p className="text-xs font-semibold text-foreground">{item.category_label}</p></Cell>}
          <Cell label="Cost"><p className="text-xs font-bold text-primary">{formatCurrency(item.standard_cost ?? 0)} {currencyLabel}</p></Cell>
          {isFG
            ? <Cell label="Sale Price"><p className="text-xs font-bold text-green-600 dark:text-green-400">{formatCurrency(item.sale_price ?? 0)} {currencyLabel}</p></Cell>
            : <Cell label="Reorder At"><p className="text-xs font-bold text-orange-600 dark:text-orange-400">{item.reorder_level ?? 0} {item.unit}</p></Cell>}
        </div>
        {supplierName && (
          <div className="pt-2 border-t border-border">
            <Cell label="Supplier">
              <p className="text-xs font-medium text-foreground flex items-center gap-1"><Truck className="w-3 h-3 text-muted-foreground shrink-0" />{supplierName}</p>
            </Cell>
          </div>
        )}
        <div className="flex gap-2 mt-auto pt-2 border-t border-border">
          <button disabled={closed} onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button disabled={closed} onClick={onDelete} className={redBtn}><X className="w-3.5 h-3.5" /> Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── Price change log ─────────────────────────────────────────────────────────

function PriceChangeHistory({ rows }: { rows: PriceHistoryRow[] }) {
  if (rows.length < 2) return null;
  const changes = rows.slice(0, -1).map((r, i) => {
    const from = rows[i + 1].price, to = r.price, diff = to - from;
    return { date: r.purchase_date, supplier: r.supplier_name, from, to, diff, pct: from > 0 ? (diff / from) * 100 : 0 };
  });
  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Price Change Log</h3>
      </div>
      {changes.map((c, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border text-xs">
          <div className="text-muted-foreground w-24 shrink-0">{c.date}</div>
          <div className="font-medium text-foreground shrink-0">{c.supplier}</div>
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-muted-foreground">{formatCurrency(c.from)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-semibold text-foreground">{formatCurrency(c.to)}</span>
          </div>
          <TrendText diff={c.diff} pct={c.pct} />
        </div>
      ))}
    </div>
  );
}

function TrendText({ diff, pct }: { diff: number; pct: number | null }) {
  const color = diff > 0 ? "text-red-500" : diff < 0 ? "text-green-600" : "text-muted-foreground";
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const sign = diff > 0 ? "+" : "";
  return (
    <span className={`flex items-center gap-1 font-semibold shrink-0 ${color}`}>
      <Icon className="w-3 h-3" />
      {sign}{formatCurrency(diff)}{pct != null && ` (${sign}${pct.toFixed(1)}%)`}
    </span>
  );
}

// ─── Initial form state ───────────────────────────────────────────────────────

const emptyBranchForm   = { name: "", location: "", manager: "" };
const emptySupplierForm = {
  name: "", phone: "", phoneCountry: "EG", agentPhone: "", agentPhoneCountry: "EG",
  email: "", address: "", website: "", commercial_reg_number: "", agent_name: "", category: "", notes: "",
};
const emptyItemForm = {
  name: "", sku: "", sku_prefix: "", category: "raw_material", unit: "",
  sale_price: 0, reorder_level: 0, standard_cost: 0, supplier_id: 0,
};
const emptyUserForm   = { username: "", display_name: "", role: "clerk" };
const emptySkuForm    = { label: "", prefix: "", item_type: "raw_material" as SkuType };
const emptyPriceForm  = () => ({ supplier_id: 0, ingredient_id: 0, price: 0, purchase_date: today(), notes: "" });

const tabFromQuery = (q: string): Tab | null => {
  const v = new URLSearchParams(q).get("tab");
  return VALID_TABS.includes(v as Tab) ? (v as Tab) : null;
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function Masters() {
  const { language, t } = useLanguage();
  const search = useSearch();
  const currencyLabel = getCurrencyLabel(language);
  const { workingPeriod, periodStatus } = useWorkingPeriod();

  // ── Tab (synced with ?tab=) ──
  const [tab, setTab] = useState<Tab>(() => tabFromQuery(window.location.search) ?? "branches");
  useEffect(() => {
    const next = tabFromQuery(search);
    if (next) setTab(next);
    else if (!new URLSearchParams(search).get("tab")) setTab("branches");
  }, [search]);
  const pageInfo = PAGE_INFO[tab];

  // ── Period lock state ──
  const periodState = periodStatus ?? "unknown";
  const closed = periodStatus === null || periodState === "closed" || periodState === "locked";
  const locked = periodState === "locked";

  // ── Current user / cache scope ──
  const authUser = (() => { try { return JSON.parse(localStorage.getItem("auth_user") ?? "{}"); } catch { return {}; } })();
  const currentUserId = Number(authUser.id ?? 0);
  const companyId = String(authUser.company_id ?? authUser.company?.id ?? "unknown");
  const scope = `${companyId}:${currentUserId}`;
  const key = (name: string) => cacheKey(scope, name);

  // ── Data ──
  const { data: branches,   loading: branchLoading,     error: branchError,     refetch: refetchBranches }    = useCachedQuery(key("branches"),     getBranches);
  const { data: suppliers,  loading: supplierLoading,   error: supplierError,   refetch: refetchSuppliers }   = useCachedQuery(key("suppliers"),    getSuppliers);
  const { data: items,      loading: itemLoading,       error: itemError,       refetch: refetchItems }       = useCachedQuery(key("items"),        getItems);
  const { data: users,      loading: userLoading,       error: userError,       refetch: refetchUsers }       = useCachedQuery(key("users"),        getUsers);
  const { data: ingredients, loading: ingredientLoading, error: ingredientError, refetch: refetchIngredients } = useCachedQuery(key("ingredients"), () => apiCall<IngredientOption[]>("/api/ingredients"));
  const { data: skuData,    loading: skuLoading,        error: skuError,        refetch: refetchSku }         = useCachedQuery(key("sku-prefixes"), getSkuPrefixes);

  const branchList   = (branches as Branch[])      ?? [];
  const supplierList = (suppliers as SupplierRow[]) ?? [];
  const itemList     = (items as ItemRow[])         ?? [];
  const userList     = (users as UserRow[])         ?? [];
  const skuPrefixes: SkuPrefixRow[] = skuData ?? [];

  // ── UI state ──
  const [modal, setModal]   = useState<ModalType>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [phoneError, setPhoneError]           = useState("");
  const [agentPhoneError, setAgentPhoneError] = useState("");

  const [branchSearch, setBranchSearch]   = useState("");
  const [branchView, setBranchView]       = useState<Branch | null>(null);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierCategoryFilter, setSupplierCategoryFilter] = useState("");
  const [supplierView, setSupplierView]   = useState<SupplierRow | null>(null);
  const [itemSearch, setItemSearch]       = useState("");
  const [itemFilter, setItemFilter]       = useState("all");
  const [userSearch, setUserSearch]       = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [skuSearch, setSkuSearch]         = useState("");
  const [skuFilter, setSkuFilter]         = useState("all");
  const [seeding, setSeeding]             = useState(false);

  // ── Forms ──
  const [branchForm, setBranchForm]     = useState(emptyBranchForm);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [itemForm, setItemForm]         = useState(emptyItemForm);
  const [userForm, setUserForm]         = useState(emptyUserForm);
  const [skuForm, setSkuForm]           = useState(emptySkuForm);
  const [priceForm, setPriceForm]       = useState(emptyPriceForm);
  const [editingItem, setEditingItem]   = useState<ItemRow | null>(null);
  const [editItemForm, setEditItemForm] = useState({ name: "", sku: "", sku_prefix: "", unit: "", sale_price: 0, reorder_level: 0, standard_cost: 0 });

  // ── Price history ──
  const [selectedIngredient, setSelectedIngredient]         = useState(0);
  const [selectedIngredientName, setSelectedIngredientName] = useState("");
  const [ingredientSearch, setIngredientSearch]             = useState("");
  const [showIngredientDropdown, setShowIngredientDropdown] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryRow[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError]     = useState("");
  const [showChangeLog, setShowChangeLog] = useState(false);
  const priceRequestRef = useRef(0);

  const fetchPriceHistory = useCallback(async (ingredientId: number, force = false) => {
    const request = ++priceRequestRef.current;
    if (!ingredientId) { setPriceHistory([]); setPriceLoading(false); return; }
    const k = cacheKey(scope, `price-history:${ingredientId}`);
    const cached = readCachedQuery<PriceHistoryRow[]>(k);
    setPriceHistory((cached?.value as PriceHistoryRow[] | undefined) ?? []);
    setPriceError("");
    if (cached && !force && Date.now() - cached.timestamp < MASTER_CACHE_TTL) { setPriceLoading(false); return; }
    setPriceLoading(!cached);
    try {
      const rows = await apiCall<PriceHistoryRow[]>(`/api/suppliers/price-history/${ingredientId}`);
      if (request !== priceRequestRef.current) return;
      const safe = Array.isArray(rows) ? rows : [];
      writeCachedQuery(k, safe);
      setPriceHistory(safe);
    } catch (err) {
      if (request === priceRequestRef.current) setPriceError(err instanceof Error ? err.message : "Failed to load price history");
    } finally {
      if (request === priceRequestRef.current) setPriceLoading(false);
    }
  }, [scope]);

  useEffect(() => { fetchPriceHistory(selectedIngredient); }, [selectedIngredient, fetchPriceHistory]);

  // ── Helpers ──
  const openModal = (type: ModalType) => { setError(""); setPhoneError(""); setAgentPhoneError(""); setModal(type); };
  const closeModal = () => { setModal(null); setEditingItem(null); };
  const modalProps = { saving, cancelLabel: t("masters.cancel"), saveLabel: t("masters.save") };

  const refreshItems = async () => {
    invalidateCachedQueries(key("items"));
    invalidateCachedQueries(key("ingredients"));
    await Promise.all([refetchItems?.(), refetchIngredients?.()]);
  };

  const addButton = (type: Exclude<ModalType, null>, label: string) => (
    <Button size="sm" className="gap-2" onClick={() => openModal(type)} disabled={closed}>
      <Plus className="w-4 h-4" />{label}
    </Button>
  );

  // ── Save handlers ──
  async function handleSaveBranch() {
    if (!branchForm.name.trim()) { setError(t("masters.err.branchName")); return; }
    setSaving(true); setError("");
    const ok = await addBranch({ ...branchForm, user_id: currentUserId });
    setSaving(false);
    if (!ok) { setError(t("masters.err.branchSave")); return; }
    invalidateCachedQueries(key("branches"));
    refetchBranches?.();
    closeModal(); setBranchForm(emptyBranchForm);
  }

  async function handleSaveSupplier() {
    if (!supplierForm.name.trim()) { setError(t("masters.err.supplierName")); return; }
    const pErr  = supplierForm.phone      ? validatePhone(supplierForm.phone,      COUNTRY_PHONES.find(c => c.code === supplierForm.phoneCountry) ?? null) : "";
    const apErr = supplierForm.agentPhone ? validatePhone(supplierForm.agentPhone, COUNTRY_PHONES.find(c => c.code === supplierForm.agentPhoneCountry) ?? null) : "";
    setPhoneError(pErr); setAgentPhoneError(apErr);
    if (pErr || apErr) return;
    setSaving(true); setError("");
    const ok = await addSupplier({
      name: supplierForm.name,
      phone: buildPhone(supplierForm.phone, supplierForm.phoneCountry),
      email: supplierForm.email, address: supplierForm.address, website: supplierForm.website,
      commercial_reg_number: supplierForm.commercial_reg_number, agent_name: supplierForm.agent_name,
      agent_phone: buildPhone(supplierForm.agentPhone, supplierForm.agentPhoneCountry),
      category: supplierForm.category, notes: supplierForm.notes, user_id: currentUserId,
    });
    setSaving(false);
    if (!ok) { setError(t("masters.err.supplierSave")); return; }
    invalidateCachedQueries(key("suppliers"));
    refetchSuppliers?.();
    closeModal(); setSupplierForm(emptySupplierForm);
  }

  async function handleSaveItem() {
    if (!itemForm.name.trim() || !itemForm.unit.trim()) { setError(t("masters.err.itemRequired")); return; }
    setSaving(true); setError("");
    const { name: savedName, supplier_id: savedSupplierId, standard_cost: savedCost } = itemForm;

    const result = await addItem({
      name: itemForm.name, unit: itemForm.unit, category: itemForm.category,
      sale_price: itemForm.sale_price, reorder_level: itemForm.reorder_level, standard_cost: itemForm.standard_cost,
      sku: itemForm.sku || "", sku_prefix: itemForm.sku_prefix || undefined, user_id: currentUserId,
    });
    if (!result) { setError(t("masters.err.itemSave")); setSaving(false); return; }

    const recordInitialPrice = !!(result.id && savedSupplierId && savedCost > 0);
    if (recordInitialPrice) {
      try {
        const d = new Date(); d.setDate(d.getDate() - 1);
        await apiCall("/api/suppliers/price", {
          method: "POST",
          body: JSON.stringify({
            ingredient_id: result.id, supplier_id: savedSupplierId, price: savedCost,
            purchase_date: d.toISOString().split("T")[0],
            notes: "Initial cost on item creation", price_type: "initial_cost",
          }),
        });
      } catch { /* non-blocking */ }
    }

    closeModal(); setItemForm(emptyItemForm);
    if (recordInitialPrice) {
      setSelectedIngredient(result.id); setSelectedIngredientName(savedName); setTab("prices");
      await fetchPriceHistory(result.id, true);
    }
    await refreshItems();
    setSaving(false);
  }

  function openEditItem(item: ItemRow) {
    setEditingItem(item);
    setEditItemForm({
      name: item.name, sku: item.sku ?? "",
      sku_prefix: item.sku?.includes("-") ? item.sku.split("-")[0] : "",
      unit: item.unit, sale_price: item.sale_price ?? 0,
      reorder_level: item.reorder_level ?? 0, standard_cost: item.standard_cost ?? 0,
    });
    openModal("editItem");
  }

  async function handleUpdateItem() {
    if (!editingItem) return;
    if (!editItemForm.name.trim() || !editItemForm.unit.trim()) { setError("Name and unit are required."); return; }
    setSaving(true); setError("");
    const common = { name: editItemForm.name, unit: editItemForm.unit, sku: editItemForm.sku || null, sku_prefix: editItemForm.sku_prefix || null };
    try {
      if (editingItem.category === "finished_good") {
        await apiCall(`/api/products/${editingItem.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...common, sale_price: editItemForm.sale_price, standard_cost: editItemForm.standard_cost }),
        });
      } else {
        await apiCall(`/api/ingredients/${editingItem.id}`, {
          method: "PUT",
          body: JSON.stringify({ ...common, cost_per_unit: editItemForm.standard_cost, reorder_level: editItemForm.reorder_level }),
        });
      }
      closeModal();
      await refreshItems();
    } catch {
      setError("Failed to update item. Please try again.");
    }
    setSaving(false);
  }

  async function handleDeleteItem(item: ItemRow) {
    if (closed || !confirm(`Delete "${item.name}"?`)) return;
    try {
      await apiCall(item.category === "finished_good" ? `/api/products/${item.id}` : `/api/ingredients/${item.id}`, { method: "DELETE" });
      await refreshItems();
    } catch {
      alert("Failed to delete item");
    }
  }

  async function handleSaveUser() {
    if (!userForm.username.trim() || !userForm.display_name.trim()) { setError(t("masters.err.userRequired")); return; }
    setSaving(true); setError("");
    const ok = await addUser({ ...userForm, password: `${userForm.username}123`, user_id: currentUserId });
    setSaving(false);
    if (!ok) { setError(t("masters.err.userSave")); return; }
    invalidateCachedQueries(key("users"));
    refetchUsers?.();
    closeModal(); setUserForm(emptyUserForm);
  }

  async function handleSavePrice() {
    if (!priceForm.supplier_id)   { setError(t("masters.err.selectSupplier"));   return; }
    if (!priceForm.ingredient_id) { setError(t("masters.err.selectIngredient")); return; }
    if (!priceForm.price)         { setError(t("masters.err.enterPrice"));       return; }
    setSaving(true); setError("");
    const id = priceForm.ingredient_id;
    const name = ingredients?.find(i => i.id === id)?.name ?? "";
    try {
      await apiCall("/api/suppliers/price", { method: "POST", body: JSON.stringify({ ...priceForm, price_type: "market_price" }) });
      setPriceForm(emptyPriceForm());
      closeModal();
      setSelectedIngredient(id); setSelectedIngredientName(name); setTab("prices");
      invalidateCachedQueries(key(`price-history:${id}`));
      await Promise.all([fetchPriceHistory(id, true), refreshItems()]);
    } catch {
      setError(t("masters.err.priceSave"));
    }
    setSaving(false);
  }

  async function handleSaveSkuPrefix() {
    const prefix = skuForm.prefix.trim().toUpperCase();
    if (!skuForm.label.trim()) { setError("Label is required."); return; }
    if (!prefix)               { setError("Prefix is required."); return; }
    if (!/^[A-Z0-9]+$/.test(prefix)) { setError("Prefix must be letters/numbers only (e.g. PIZ, BRK2)."); return; }
    setSaving(true); setError("");
    try {
      await addSkuPrefix({ label: skuForm.label.trim(), prefix, item_type: skuForm.item_type });
      invalidateCachedQueries(key("sku-prefixes"));
      refetchSku?.();
      closeModal(); setSkuForm(emptySkuForm);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add prefix. It may already exist.");
    }
    setSaving(false);
  }

  async function handleDeleteSkuPrefix(p: SkuPrefixRow) {
    if (closed || !confirm(`Delete prefix "${p.prefix}"? Items with this SKU prefix won't be affected.`)) return;
    if (await deleteSkuPrefix(p.id)) { invalidateCachedQueries(key("sku-prefixes")); refetchSku?.(); }
    else alert("Failed to delete prefix.");
  }

  async function handleSeedDefaults() {
    if (!confirm("This will add all default prefixes for your company. Existing ones won't be changed. Continue?")) return;
    setSeeding(true);
    if (await seedSkuPrefixes()) { invalidateCachedQueries(key("sku-prefixes")); refetchSku?.(); }
    else alert("Failed to seed defaults.");
    setSeeding(false);
  }

  async function handleDeleteSupplier(s: SupplierRow) {
    if (closed || !confirm(t("masters.confirm.deleteSupplier").replace("{name}", s.name))) return;
    if (await deleteSupplier(s.id)) { invalidateCachedQueries(key("suppliers")); refetchSuppliers?.(); setSupplierView(null); }
  }

  async function handleDeleteBranch(b: Branch) {
    if (closed || !confirm(t("masters.confirm.deleteBranch").replace("{name}", b.name))) return;
    if (await deleteBranch(b.id)) { invalidateCachedQueries(key("branches")); refetchBranches?.(); setBranchView(null); }
  }

  // ── Derived / filtered lists ──
  const has = (value: string | null | undefined, q: string) => (value ?? "").toLowerCase().includes(q.toLowerCase());

  const filteredBranches = branchList.filter(b =>
    has(b.name, branchSearch) || has(b.location, branchSearch) || has(b.manager, branchSearch) ||
    `br-${localNumber(b.branch_number, b.id)}`.includes(branchSearch.toLowerCase())
  );

  const activeCategories = [...new Set(supplierList.map(s => s.category || "General"))].sort();
  const filteredSuppliers = supplierList.filter(s =>
    (has(s.name, supplierSearch) || has(s.phone, supplierSearch) || has(s.email, supplierSearch) || has(s.notes, supplierSearch)) &&
    (!supplierCategoryFilter || (s.category || "General") === supplierCategoryFilter)
  );

  const filteredItems = itemList.filter(i =>
    (has(i.name, itemSearch) || has(i.sku, itemSearch)) && (itemFilter === "all" || i.category === itemFilter)
  );

  const filteredUsers = userList.filter(u =>
    (has(u.display_name, userSearch) || has(u.username, userSearch)) && (!userRoleFilter || u.role === userRoleFilter)
  );

  const filteredPrefixes = skuPrefixes.filter(p =>
    (has(p.prefix, skuSearch) || has(p.label, skuSearch)) && (skuFilter === "all" || p.item_type === skuFilter)
  );

  const filteredIngredients = (ingredients ?? []).filter(i => has(i.name, ingredientSearch));

  // Price stats
  const priceStats: Stat[] = (() => {
    if (!priceHistory.length) return [];
    const latest = priceHistory[0].price, oldest = priceHistory[priceHistory.length - 1].price;
    const diff = latest - oldest, pct = oldest > 0 ? (diff / oldest) * 100 : 0;
    const std = ingredients?.find(i => i.id === selectedIngredient)?.cost_per_unit ?? null;
    const market = priceHistory.find(r => (r.price_type === "market_price" || !r.price_type) && r.status === "approved");
    const variance = std != null && market ? market.price - std : null;
    const variancePct = std && std > 0 && variance != null ? (variance / std) * 100 : null;
    const trendColor = (n: number) => n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-muted-foreground";
    const sign = (n: number) => (n > 0 ? "+" : "");
    return [
      { label: "Latest Price",   value: `${formatCurrency(latest)} ${currencyLabel}`, color: "text-foreground" },
      { label: "Overall Change", value: `${sign(diff)}${formatCurrency(diff)} (${sign(pct)}${pct.toFixed(1)}%)`, color: trendColor(diff) },
      { label: "Standard Cost",  value: std != null ? `${formatCurrency(std)} ${currencyLabel}` : "—", color: "text-foreground" },
      { label: "Market vs Standard",
        value: variance == null ? "—" : `${sign(variance)}${formatCurrency(variance)}${variancePct != null ? ` (${sign(variancePct)}${variancePct.toFixed(1)}%)` : ""}`,
        color: variance == null ? "text-muted-foreground" : trendColor(variance) },
    ];
  })();

  const anyError = branchError || supplierError || itemError || userError || ingredientError || skuError || priceError;

  // ── Render ──
  return (
    <div className="space-y-6">
      {anyError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">{anyError}</div>}

      {/* ═════════ Modals ═════════ */}
      {modal === "branch" && (
        <Modal title={t("masters.modal.addBranch")} onClose={closeModal} onSave={handleSaveBranch} {...modalProps}>
          <ErrorLine message={error} />
          <Field label={t("masters.field.branchName")}>
            <input className={inputClass} placeholder={t("masters.ph.branchName")} value={branchForm.name} autoFocus
              onChange={e => setBranchForm({ ...branchForm, name: e.target.value })} />
          </Field>
          <Field label={t("masters.field.location")}>
            <input className={inputClass} placeholder={t("masters.ph.location")} value={branchForm.location}
              onChange={e => setBranchForm({ ...branchForm, location: e.target.value })} />
          </Field>
          <Field label={t("masters.field.manager")}>
            <input className={inputClass} placeholder={t("masters.ph.manager")} value={branchForm.manager}
              onChange={e => setBranchForm({ ...branchForm, manager: e.target.value })} />
          </Field>
        </Modal>
      )}

      {modal === "supplier" && (
        <Modal title={t("masters.modal.addSupplier")} onClose={closeModal} onSave={handleSaveSupplier} {...modalProps}>
          <ErrorLine message={error} />
          <SectionLabel label="Supplier Details" />
          <Field label={t("masters.field.supplierName")}>
            <input className={inputClass} placeholder={t("masters.ph.supplierName")} value={supplierForm.name} autoFocus
              onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <select className={inputClass} value={supplierForm.category} onChange={e => setSupplierForm({ ...supplierForm, category: e.target.value })}>
              <option value="">Select category...</option>
              {SUPPLIER_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Phone Number">
            <PhoneInput value={supplierForm.phone} countryCode={supplierForm.phoneCountry} error={phoneError}
              onValueChange={v => { setSupplierForm({ ...supplierForm, phone: v }); setPhoneError(""); }}
              onCountryChange={c => { setSupplierForm({ ...supplierForm, phoneCountry: c }); setPhoneError(""); }} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputClass} placeholder="supplier@example.com" value={supplierForm.email}
              onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} />
          </Field>
          <Field label="Address">
            <input className={inputClass} placeholder="Cairo, Egypt" value={supplierForm.address}
              onChange={e => setSupplierForm({ ...supplierForm, address: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website">
              <input className={inputClass} placeholder="https://..." value={supplierForm.website}
                onChange={e => setSupplierForm({ ...supplierForm, website: e.target.value })} />
            </Field>
            <Field label="Commercial Reg. No.">
              <input className={inputClass} placeholder="e.g. 226564656" value={supplierForm.commercial_reg_number}
                onChange={e => setSupplierForm({ ...supplierForm, commercial_reg_number: e.target.value })} />
            </Field>
          </div>
          <SectionLabel label="Agent / Business Details" />
          <Field label="Agent Name">
            <input className={inputClass} placeholder="Agent name" value={supplierForm.agent_name}
              onChange={e => setSupplierForm({ ...supplierForm, agent_name: e.target.value })} />
          </Field>
          <Field label="Agent Phone">
            <PhoneInput value={supplierForm.agentPhone} countryCode={supplierForm.agentPhoneCountry} error={agentPhoneError}
              onValueChange={v => { setSupplierForm({ ...supplierForm, agentPhone: v }); setAgentPhoneError(""); }}
              onCountryChange={c => { setSupplierForm({ ...supplierForm, agentPhoneCountry: c }); setAgentPhoneError(""); }} />
          </Field>
          <Field label={t("masters.field.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("masters.ph.notes")} value={supplierForm.notes}
              onChange={e => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {modal === "item" && (
        <Modal title={t("masters.modal.addItem")} onClose={closeModal} onSave={handleSaveItem} {...modalProps}>
          <ErrorLine message={error} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("masters.field.itemName")}>
              <input className={inputClass} placeholder={t("masters.ph.itemName")} value={itemForm.name} autoFocus
                onChange={e => setItemForm({ ...itemForm, name: e.target.value })} />
            </Field>
            <Field label={t("masters.field.category")}>
              <select className={inputClass} value={itemForm.category}
                onChange={e => setItemForm(p => ({ ...p, category: e.target.value, sku_prefix: "", sku: "" }))}>
                <option value="raw_material">{t("masters.cat.rawMaterial")}</option>
                <option value="finished_good">{t("masters.cat.finishedGood")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("masters.field.unit")}>
            <input className={inputClass} placeholder={t("masters.ph.unit")} value={itemForm.unit}
              onChange={e => setItemForm(p => ({ ...p, unit: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("masters.field.standardCost")}>
              <input className={inputClass} type="number" min={0} step={0.01} placeholder={t("masters.ph.price")}
                value={itemForm.standard_cost || ""} onChange={e => setItemForm(p => ({ ...p, standard_cost: Number(e.target.value) }))} />
            </Field>
            {itemForm.category === "finished_good" ? (
              <Field label={t("masters.field.salePrice")}>
                <input className={inputClass} type="number" min={0} step={0.01} placeholder={t("masters.ph.price")}
                  value={itemForm.sale_price || ""} onChange={e => setItemForm(p => ({ ...p, sale_price: Number(e.target.value) }))} />
              </Field>
            ) : (
              <Field label={t("masters.field.reorderLevel")}>
                <input className={inputClass} type="number" min={0} placeholder="0"
                  value={itemForm.reorder_level || ""} onChange={e => setItemForm(p => ({ ...p, reorder_level: Number(e.target.value) }))} />
              </Field>
            )}
          </div>
          <SkuSelector prefixes={skuPrefixes} loading={skuLoading} category={itemForm.category}
            selectedPrefix={itemForm.sku_prefix} manualSku={itemForm.sku}
            onPrefixChange={p => setItemForm(prev => ({ ...prev, sku_prefix: p, sku: "" }))}
            onManualSkuChange={sku => setItemForm(prev => ({ ...prev, sku }))} />
          {itemForm.category === "raw_material" && (
            <Field label="Initial Supplier (optional — auto-records starting price)">
              <select className={inputClass} value={itemForm.supplier_id || ""}
                onChange={e => setItemForm(p => ({ ...p, supplier_id: Number(e.target.value) }))}>
                <option value="">— Skip (no price record) —</option>
                {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {itemForm.supplier_id > 0 && itemForm.standard_cost > 0 && (
                <p className="text-[11px] text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 shrink-0" />
                  Will auto-record {formatCurrency(itemForm.standard_cost)} {currencyLabel} to price history on save.
                </p>
              )}
            </Field>
          )}
        </Modal>
      )}

      {modal === "editItem" && editingItem && (
        <Modal title={`Edit ${editingItem.category === "finished_good" ? "Finished Good" : "Raw Material"}`}
          onClose={closeModal} onSave={handleUpdateItem} {...modalProps}>
          <ErrorLine message={error} />
          <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SKU_TYPE_COLOR[editingItem.category as SkuType] ?? SKU_TYPE_COLOR.both}`}>
              {editingItem.category === "finished_good" ? "Finished Good" : "Raw Material"}
            </span>
            {editingItem.sku && <span className="text-xs text-muted-foreground font-mono">{editingItem.sku}</span>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Item Name">
              <input className={inputClass} placeholder="Item name" value={editItemForm.name} autoFocus
                onChange={e => setEditItemForm(p => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="Unit">
              <input className={inputClass} placeholder="kg / pcs / L" value={editItemForm.unit}
                onChange={e => setEditItemForm(p => ({ ...p, unit: e.target.value }))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Standard Cost (${currencyLabel})`}>
              <input className={inputClass} type="number" min={0} step={0.01} value={editItemForm.standard_cost || ""}
                onChange={e => setEditItemForm(p => ({ ...p, standard_cost: Number(e.target.value) }))} />
            </Field>
            {editingItem.category === "finished_good" ? (
              <Field label={`Sale Price (${currencyLabel})`}>
                <input className={inputClass} type="number" min={0} step={0.01} value={editItemForm.sale_price || ""}
                  onChange={e => setEditItemForm(p => ({ ...p, sale_price: Number(e.target.value) }))} />
              </Field>
            ) : (
              <Field label="Reorder Level">
                <input className={inputClass} type="number" min={0} value={editItemForm.reorder_level || ""}
                  onChange={e => setEditItemForm(p => ({ ...p, reorder_level: Number(e.target.value) }))} />
              </Field>
            )}
          </div>
          <SkuSelector prefixes={skuPrefixes} loading={skuLoading} category={editingItem.category}
            selectedPrefix={editItemForm.sku_prefix} manualSku={editItemForm.sku}
            onPrefixChange={p => setEditItemForm(prev => ({ ...prev, sku_prefix: p, sku: "" }))}
            onManualSkuChange={sku => setEditItemForm(prev => ({ ...prev, sku }))} />
        </Modal>
      )}

      {modal === "user" && (
        <Modal title={t("masters.modal.addUser")} onClose={closeModal} onSave={handleSaveUser} {...modalProps}>
          <ErrorLine message={error} />
          <Field label={t("masters.field.username")}>
            <input className={inputClass} placeholder={t("masters.ph.username")} value={userForm.username} autoFocus
              onChange={e => setUserForm({ ...userForm, username: e.target.value })} />
          </Field>
          <Field label={t("masters.field.displayName")}>
            <input className={inputClass} placeholder={t("masters.ph.displayName")} value={userForm.display_name}
              onChange={e => setUserForm({ ...userForm, display_name: e.target.value })} />
          </Field>
          <Field label={t("masters.field.role")}>
            <select className={inputClass} value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value })}>
              <option value="clerk">{t("masters.role.clerk")}</option>
              <option value="manager">{t("masters.role.manager")}</option>
              <option value="admin">{t("masters.role.admin")}</option>
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            {t("masters.defaultPassword")} <code className="bg-secondary px-1 rounded">{userForm.username || "username"}123</code>
          </p>
        </Modal>
      )}

      {modal === "price" && (
        <Modal title={t("masters.modal.recordPrice")} onClose={closeModal} onSave={handleSavePrice} {...modalProps}>
          <ErrorLine message={error} />
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              This price will be recorded as <strong>pending</strong> and requires manager approval before updating the standard cost.
            </p>
          </div>
          <Field label={t("masters.field.ingredient")}>
            <select className={inputClass} value={priceForm.ingredient_id || ""}
              onChange={e => setPriceForm({ ...priceForm, ingredient_id: Number(e.target.value) })}>
              <option value="">{t("masters.ph.selectIngredient")}</option>
              {ingredients?.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
          </Field>
          <Field label={t("masters.field.supplier")}>
            <select className={inputClass} value={priceForm.supplier_id || ""}
              onChange={e => setPriceForm({ ...priceForm, supplier_id: Number(e.target.value) })}>
              <option value="">{t("masters.ph.selectSupplier")}</option>
              {supplierList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("masters.field.price").replace("{currency}", currencyLabel)}>
              <input type="number" min={0} step={0.01} className={inputClass} placeholder={t("masters.ph.price")}
                value={priceForm.price || ""} onChange={e => setPriceForm({ ...priceForm, price: Number(e.target.value) })} />
            </Field>
            <Field label={t("masters.field.date")}>
              <input type="date" className={inputClass} value={priceForm.purchase_date}
                onChange={e => setPriceForm({ ...priceForm, purchase_date: e.target.value })} />
            </Field>
          </div>
          <Field label={t("masters.field.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("masters.ph.priceNotes")} value={priceForm.notes}
              onChange={e => setPriceForm({ ...priceForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {modal === "skuPrefix" && (
        <Modal title="Add SKU Prefix" onClose={closeModal} onSave={handleSaveSkuPrefix} {...modalProps}>
          <ErrorLine message={error} />
          <Field label="Label (display name)">
            <input className={inputClass} placeholder="e.g. Wraps & Rolls" value={skuForm.label} autoFocus
              onChange={e => setSkuForm({ ...skuForm, label: e.target.value })} />
          </Field>
          <Field label="Prefix (short code)">
            <div className="relative">
              <input className={inputClass + " uppercase font-mono"} placeholder="e.g. WRAP" maxLength={8} value={skuForm.prefix}
                onChange={e => setSkuForm({ ...skuForm, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
              {skuForm.prefix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono">→ {skuForm.prefix}-00001</span>}
            </div>
          </Field>
          <Field label="Applies To">
            <select className={inputClass} value={skuForm.item_type} onChange={e => setSkuForm({ ...skuForm, item_type: e.target.value as SkuType })}>
              <option value="raw_material">Raw Materials only</option>
              <option value="finished_good">Finished Goods only</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            Deleting a prefix won't affect existing items — their SKUs are stored permanently. The counter resets if you re-add the same prefix later.
          </p>
        </Modal>
      )}

      {/* ═════════ Page header ═════════ */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">{pageInfo.title}</h1>
          <p className="text-muted-foreground mt-1">{pageInfo.subtitle}</p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
          locked ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
          : closed ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
          : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"}`}>
          {closed ? <Lock className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
          {periodState.toUpperCase()}
        </span>
      </div>

      {closed && (
        <Card className={`p-4 ${locked ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20" : "border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20"}`}>
          <p className={`flex items-center gap-2 text-sm ${locked ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
            <Lock className="h-4 w-4 flex-shrink-0" />
            {locked ? `${workingPeriod} is locked. No master data changes are allowed.`
                    : `${workingPeriod} is closed. Adding or deleting records is restricted.`}
          </p>
        </Card>
      )}

      {/* ═════════ Tabs — all share <MasterSection> ═════════ */}
      <div>
        {/* Branches */}
        {tab === "branches" && (branchView ? (
          <DetailShell backLabel="Back to Branches" deleteLabel="Delete Branch" avatarClass="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
            name={branchView.name} code={`BR-${localNumber(branchView.branch_number, branchView.id)}`}
            closed={closed} onBack={() => setBranchView(null)} onDelete={() => handleDeleteBranch(branchView)}>
            <Card className="p-4">
              <DetailRow icon={<MapPin className="w-4 h-4" />} label="Location" value={branchView.location || "—"} />
              <DetailRow icon={<Users className="w-4 h-4" />}  label="Manager"  value={branchView.manager  || "—"} />
            </Card>
          </DetailShell>
        ) : (
          <MasterSection
            stats={[
              { label: "Total Branches",    value: branchList.length, color: "text-green-600 dark:text-green-400" },
              { label: "Active",            value: branchList.filter(b => b.is_active !== false).length, color: "text-blue-600 dark:text-blue-400" },
              { label: "Managers Assigned", value: branchList.filter(b => b.manager?.trim()).length, color: "text-violet-600 dark:text-violet-400" },
            ]}
            left={<SearchBox value={branchSearch} onChange={setBranchSearch} placeholder="Search branches..." />}
            actions={addButton("branch", t("masters.add.branch"))}
            loading={branchLoading} total={branchList.length} shown={filteredBranches.length}
            emptyLabel={t("masters.empty.branches")} noMatchLabel="No branches match your search."
            onClear={() => setBranchSearch("")}>
            {filteredBranches.map(b => (
              <EntityCard key={b.id} closed={closed}
                avatar={initials(b.name)} avatarClass="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                code={`BR-${localNumber(b.branch_number, b.id)}`} title={b.name}
                lines={b.manager && <MetaLine icon={<Users className="w-3 h-3 shrink-0" />} text={b.manager} />}
                body={b.location
                  ? <MetaLine icon={<MapPin className="w-3 h-3 shrink-0" />} text={`Location: ${b.location}`} />
                  : <span className="text-xs text-muted-foreground">No location set</span>}
                onShow={() => setBranchView(b)} onDelete={() => handleDeleteBranch(b)} />
            ))}
          </MasterSection>
        ))}

        {/* Suppliers */}
        {tab === "suppliers" && (supplierView ? (
          <DetailShell backLabel="Back to Suppliers" deleteLabel="Delete Supplier" avatarClass="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
            name={supplierView.name} code={`SP-${localNumber(supplierView.supplier_number, supplierView.id)}`}
            closed={closed} onBack={() => setSupplierView(null)} onDelete={() => handleDeleteSupplier(supplierView)}>
            <Card className="p-5">
              <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">Supplier Details</p>
              <DetailRow icon={<Phone className="w-3.5 h-3.5" />}  label="Phone Number" value={supplierView.phone || "—"} />
              <DetailRow icon={<Mail className="w-3.5 h-3.5" />}   label="Email"        value={supplierView.email || "—"} />
              <DetailRow icon={<MapPin className="w-3.5 h-3.5" />} label="Address"      value={supplierView.address || "—"} />
              <DetailRow icon={<Globe className="w-3.5 h-3.5" />}  label="Website"      value={supplierView.website || "—"} isLink />
              <DetailRow icon={<span className="text-[13px]">📄</span>} label="Commercial Reg. Number" value={supplierView.commercial_reg_number || "—"} />
            </Card>
            <Card className="p-5">
              <p className="text-xs font-bold text-primary uppercase tracking-widest mb-4">Business Details</p>
              <DetailRow icon={<Users className="w-3.5 h-3.5" />} label="Agent Name"  value={supplierView.agent_name  || "—"} />
              <DetailRow icon={<Phone className="w-3.5 h-3.5" />} label="Agent Phone" value={supplierView.agent_phone || "—"} />
              <div className="py-2.5 border-b border-border last:border-0">
                <p className="text-[11px] text-muted-foreground font-medium mb-1">Category</p>
                <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${supplierCatColor(supplierView.category)}`}>{supplierView.category || "General"}</span>
              </div>
              {supplierView.notes && <DetailRow icon={<span className="text-[13px]">📝</span>} label="Notes" value={supplierView.notes} />}
            </Card>
          </DetailShell>
        ) : (
          <MasterSection
            stats={[
              { label: "Total Suppliers", value: supplierList.length, color: "text-green-600 dark:text-green-400" },
              { label: "Active",          value: supplierList.length, color: "text-blue-600 dark:text-blue-400" },
              { label: "Categories",      value: activeCategories.length, color: "text-violet-600 dark:text-violet-400" },
            ]}
            left={<>
              <SearchBox value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />
              {activeCategories.length > 1 && (
                <FilterPills value={supplierCategoryFilter} onChange={v => setSupplierCategoryFilter(v === supplierCategoryFilter ? "" : v)}
                  options={[{ value: "", label: `All (${supplierList.length})` },
                    ...activeCategories.map(c => ({ value: c, label: `${c} (${supplierList.filter(s => (s.category || "General") === c).length})` }))]} />
              )}
            </>}
            actions={addButton("supplier", t("masters.add.supplier"))}
            loading={supplierLoading} total={supplierList.length} shown={filteredSuppliers.length}
            emptyLabel={t("masters.empty.suppliers")} noMatchLabel="No suppliers match your search."
            onClear={() => { setSupplierSearch(""); setSupplierCategoryFilter(""); }}>
            {filteredSuppliers.map(s => (
              <EntityCard key={s.id} closed={closed}
                avatar={initials(s.name)} avatarClass="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                code={`SP-${localNumber(s.supplier_number, s.id)}`} title={s.name}
                lines={<>
                  {s.phone && <MetaLine icon={<Phone className="w-3 h-3 shrink-0" />} text={s.phone} />}
                  {s.email && <MetaLine icon={<Mail className="w-3 h-3 shrink-0" />} text={s.email} />}
                </>}
                body={<>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${supplierCatColor(s.category)}`}>{s.category || "General"}</span>
                    {s.commercial_reg_number && <span className="text-xs text-muted-foreground font-mono">Reg: {s.commercial_reg_number}</span>}
                  </div>
                  {s.address && <MetaLine icon={<MapPin className="w-3 h-3 shrink-0" />} text={s.address} />}
                </>}
                onShow={() => setSupplierView(s)} onDelete={() => handleDeleteSupplier(s)} />
            ))}
          </MasterSection>
        ))}

        {/* Items */}
        {tab === "items" && (
          <MasterSection wide
            stats={[
              { label: "Total Items",    value: itemList.length, color: "text-green-600 dark:text-green-400" },
              { label: "Raw Materials",  value: itemList.filter(i => i.category === "raw_material").length, color: "text-amber-600 dark:text-amber-400" },
              { label: "Finished Goods", value: itemList.filter(i => i.category === "finished_good").length, color: "text-violet-600 dark:text-violet-400" },
            ]}
            left={<>
              <SearchBox value={itemSearch} onChange={setItemSearch} placeholder="Search by name or SKU..." />
              <FilterPills value={itemFilter} onChange={setItemFilter}
                options={[{ value: "all", label: "All" }, { value: "raw_material", label: "Raw Materials" }, { value: "finished_good", label: "Finished Goods" }]} />
            </>}
            actions={<>
              {itemList.length > 0 && (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => exportItemsPDF(itemList, currencyLabel)}>
                  <FileDown className="w-4 h-4" />Export PDF
                </Button>
              )}
              {addButton("item", t("masters.add.item"))}
            </>}
            loading={itemLoading} total={itemList.length} shown={filteredItems.length}
            emptyLabel={t("masters.empty.items")} noMatchLabel="No items match your search."
            onClear={() => { setItemSearch(""); setItemFilter("all"); }}>
            {filteredItems.map(item => (
              <ItemCard key={item.id} item={item} suppliers={supplierList} closed={closed} currencyLabel={currencyLabel}
                onImageUploaded={() => { invalidateCachedQueries(key("items")); refetchItems?.(); }}
                onEdit={() => openEditItem(item)} onDelete={() => handleDeleteItem(item)} />
            ))}
          </MasterSection>
        )}

        {/* Users */}
        {tab === "users" && (
          <MasterSection
            stats={[
              { label: "Total Users",     value: userList.length, color: "text-green-600 dark:text-green-400" },
              { label: "Admins / Owners", value: userList.filter(u => u.role === "admin" || u.role === "owner").length, color: "text-purple-600 dark:text-purple-400" },
              { label: "Managers",        value: userList.filter(u => u.role === "manager").length, color: "text-blue-600 dark:text-blue-400" },
            ]}
            left={<>
              <SearchBox value={userSearch} onChange={setUserSearch} placeholder="Search users..." />
              <FilterPills value={userRoleFilter} onChange={setUserRoleFilter}
                options={["", "owner", "admin", "manager", "accountant", "clerk"]
                  .filter(r => !r || userList.some(u => u.role === r))
                  .map(r => ({ value: r, label: `${r ? r[0].toUpperCase() + r.slice(1) : "All"} (${r ? userList.filter(u => u.role === r).length : userList.length})` }))} />
            </>}
            actions={addButton("user", t("masters.add.user"))}
            loading={userLoading} total={userList.length} shown={filteredUsers.length}
            emptyLabel={t("masters.empty.users")} noMatchLabel="No users match your search."
            onClear={() => { setUserSearch(""); setUserRoleFilter(""); }}>
            {filteredUsers.map(u => (
              <EntityCard key={u.id} closed={closed} highlight={u.id === currentUserId}
                avatar={u.display_name.charAt(0).toUpperCase()} avatarClass="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400"
                code={`US-${localNumber(u.user_number, u.id)}`}
                title={u.display_name}
                lines={<MetaLine icon={<span>@</span>} text={`${u.username}${u.id === currentUserId ? " · You" : ""}`} />}
                body={<span className={`self-start text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${roleColor(u.role)}`}>{u.role}</span>} />
            ))}
          </MasterSection>
        )}

        {/* Prices */}
        {tab === "prices" && (
          <MasterSection plain
            stats={priceStats}
            left={
              ingredientLoading ? <div className="h-10 w-full lg:max-w-xl bg-secondary/50 rounded animate-pulse" /> : (
                <div className="relative w-full lg:flex-1 lg:max-w-xl">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input className={inputClass + " pl-9"} placeholder="Search ingredient..."
                    value={showIngredientDropdown ? ingredientSearch : selectedIngredientName}
                    onFocus={() => { setIngredientSearch(""); setShowIngredientDropdown(true); }}
                    onBlur={() => setTimeout(() => setShowIngredientDropdown(false), 150)}
                    onChange={e => { setIngredientSearch(e.target.value); setShowIngredientDropdown(true); }} />
                  {selectedIngredient > 0 && (
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => { setSelectedIngredient(0); setSelectedIngredientName(""); setIngredientSearch(""); }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {showIngredientDropdown && filteredIngredients.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-background border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {filteredIngredients.map(i => (
                        <button key={i.id} className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                          onMouseDown={() => {
                            setSelectedIngredient(i.id); setSelectedIngredientName(i.name);
                            setIngredientSearch(""); setShowIngredientDropdown(false); setShowChangeLog(false);
                          }}>
                          <span className="font-medium text-foreground">{i.name}</span>
                          <span className="text-xs text-muted-foreground font-mono">{formatCurrency(Number(i.cost_per_unit))} / {i.unit}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            actions={<>
              {priceHistory.length >= 2 && (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowChangeLog(v => !v)}>
                  <History className="w-4 h-4" />{showChangeLog ? "Hide" : "Change Log"}
                </Button>
              )}
              {priceHistory.length > 0 && (
                <Button size="sm" variant="outline" className="gap-2" onClick={() => exportPriceHistoryPDF(priceHistory, selectedIngredientName, currencyLabel)}>
                  <FileDown className="w-4 h-4" />Export PDF
                </Button>
              )}
              {addButton("price", t("masters.add.price"))}
            </>}
            loading={priceLoading} total={priceHistory.length} shown={priceHistory.length}
            emptyLabel={selectedIngredient ? t("masters.empty.prices") : t("masters.empty.selectIngredient")}
            noMatchLabel="">
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    {[t("masters.priceHistory.date"), "Status", t("masters.priceHistory.supplier"), "Type"].map(h => (
                      <th key={h} className="px-4 py-2 text-left font-semibold text-foreground">{h}</th>
                    ))}
                    <th className="px-4 py-2 text-right font-semibold text-foreground">{t("masters.priceHistory.price").replace("{currency}", currencyLabel)}</th>
                    <th className="px-4 py-2 text-center font-semibold text-foreground">vs Previous</th>
                    <th className="px-4 py-2 text-left font-semibold text-foreground">{t("masters.priceHistory.notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map((row, i) => {
                    const prev = priceHistory[i + 1];
                    const diff = prev ? row.price - prev.price : null;
                    const pct = prev && prev.price > 0 ? (diff! / prev.price) * 100 : null;
                    const status = PRICE_STATUS[row.status];
                    const type = PRICE_TYPE[row.price_type ?? "market_price"];
                    return (
                      <tr key={row.id ?? i} className={`border-b border-border hover:bg-secondary/50 transition-colors ${i % 2 ? "bg-secondary/20" : ""}`}>
                        <td className="px-4 py-3 text-foreground text-xs">{row.purchase_date}</td>
                        <td className="px-4 py-3">{status && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{row.supplier_name}</td>
                        <td className="px-4 py-3">{type && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${type.cls}`}>{type.label}</span>}</td>
                        <td className="px-4 py-3 text-right font-bold text-primary">{formatCurrency(row.price)}</td>
                        <td className="px-4 py-3 text-center text-xs">
                          {diff === null ? <span className="text-muted-foreground">—</span>
                            : diff === 0 ? <span className="text-muted-foreground">No change</span>
                            : <span className="inline-flex justify-center"><TrendText diff={diff} pct={pct} /></span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{row.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
            {showChangeLog && <PriceChangeHistory rows={priceHistory} />}
          </MasterSection>
        )}

        {/* SKU Prefixes */}
        {tab === "skuPrefixes" && (
          <MasterSection
            stats={[
              { label: "Total Prefixes", value: skuPrefixes.length, color: "text-green-600 dark:text-green-400" },
              { label: "Raw Materials",  value: skuPrefixes.filter(p => p.item_type === "raw_material").length, color: "text-amber-600 dark:text-amber-400" },
              { label: "Finished Goods", value: skuPrefixes.filter(p => p.item_type === "finished_good").length, color: "text-violet-600 dark:text-violet-400" },
            ]}
            left={<>
              <SearchBox value={skuSearch} onChange={setSkuSearch} placeholder="Search prefixes..." />
              <FilterPills value={skuFilter} onChange={setSkuFilter}
                options={[{ value: "all", label: "All" }, { value: "raw_material", label: "Raw Materials" }, { value: "finished_good", label: "Finished Goods" }, { value: "both", label: "Both" }]} />
            </>}
            actions={<>
              <Button size="sm" variant="outline" className="gap-2" onClick={handleSeedDefaults} disabled={seeding || closed}>
                {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Seed Defaults
              </Button>
              {addButton("skuPrefix", "Add Prefix")}
            </>}
            loading={skuLoading} total={skuPrefixes.length} shown={filteredPrefixes.length}
            emptyLabel="No prefixes yet. Click Seed Defaults to add the standard F&B prefixes, or add your own."
            noMatchLabel="No prefixes match your search."
            onClear={() => { setSkuSearch(""); setSkuFilter("all"); }}>
            {filteredPrefixes.map(p => (
              <EntityCard key={p.id} closed={closed}
                avatar={<Tag className="w-4 h-4" />} avatarClass="bg-primary/10 text-primary"
                code={`${p.prefix}-00001`} title={p.label}
                body={<span className={`self-start text-xs font-semibold px-2.5 py-0.5 rounded-full ${SKU_TYPE_COLOR[p.item_type as SkuType]}`}>{SKU_TYPE_LABEL[p.item_type as SkuType]}</span>}
                onDelete={() => handleDeleteSkuPrefix(p)} />
            ))}
          </MasterSection>
        )}
      </div>
    </div>
  );
}