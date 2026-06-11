import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, X, Loader2, AlertCircle, ChevronDown, ChevronUp,
  RefreshCw, BookOpen, Pencil, Trash2, Search, FileDown, Lock,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { apiCall, getPeriodStatus, removeRecipeIngredient } from "@/lib/api";
import type { PeriodStatusRow } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency as formatCurrencyValue, formatDate } from "@/lib/localization";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

const labelClass = "block text-xs font-medium text-muted-foreground mb-1";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

function fmt(n: number) {
  return formatCurrencyValue(n, { maximumFractionDigits: 2 });
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function buildRecipePDF(product: any, recipe: any, cost: any) {
  const ingredients = recipe.ingredients ?? [];
  const now = formatDate(new Date(), { year: "numeric", month: "long", day: "numeric" });

  const rows = ingredients.map((ing: any) => `
    <tr>
      <td>${ing.ingredient_name}</td>
      <td style="text-align:right">${Number(ing.qty_required).toFixed(3)} ${ing.unit}</td>
      <td style="text-align:right">${fmt(Number(ing.cost_per_unit))}</td>
      <td style="text-align:right;font-weight:600">${fmt(Number(ing.line_cost))}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Recipe — ${product.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',sans-serif;font-size:13px;color:#1a1a2e;background:#fff;padding:40px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #e5e7eb}
  .title{font-size:24px;font-weight:700;color:#1a1a2e}
  .subtitle{font-size:13px;color:#6b7280;margin-top:4px}
  .date{font-size:12px;color:#9ca3af}
  .badge{display:inline-block;background:#f3e8ff;color:#7c3aed;font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;margin-bottom:8px}
  .meta-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
  .meta-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center}
  .meta-label{font-size:11px;color:#6b7280;margin-bottom:4px}
  .meta-value{font-size:18px;font-weight:700;color:#1a1a2e}
  .cost-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
  .cost-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px}
  .cost-label{font-size:11px;color:#6b7280;margin-bottom:4px}
  .cost-value{font-size:20px;font-weight:800;color:#7c3aed}
  .cost-margin{color:#16a34a}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#f3e8ff;color:#7c3aed;font-weight:700;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  th:not(:first-child){text-align:right}
  td{padding:9px 12px;border-bottom:1px solid #f3f4f6}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even){background:#fafafa}
  .notes{margin-top:20px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px}
  .notes-label{font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px}
  .fc-ok{color:#16a34a;font-weight:700}
  .fc-high{color:#dc2626;font-weight:700}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="badge">📋 Recipe Sheet</div>
    <div class="title">${product.name}</div>
    <div class="subtitle">Sale Price: ${fmt(Number(product.sale_price || 0))} · Unit: ${product.unit}</div>
  </div>
  <div class="date">Generated: ${now}</div>
</div>
<div class="meta-grid">
  <div class="meta-box"><div class="meta-label">Yield %</div><div class="meta-value">${recipe.yield_pct}%</div></div>
  <div class="meta-box"><div class="meta-label">Portion Size</div><div class="meta-value">${recipe.portion_size} ${recipe.portion_unit}</div></div>
  <div class="meta-box"><div class="meta-label">Food Cost %</div><div class="meta-value ${Number(cost?.food_cost_pct) > 35 ? "fc-high" : "fc-ok"}">${cost?.food_cost_pct ?? 0}%</div></div>
</div>
<div class="cost-grid">
  <div class="cost-box"><div class="cost-label">Raw Cost / Portion</div><div class="cost-value">${fmt(Number(cost?.raw_cost ?? 0))}</div></div>
  <div class="cost-box"><div class="cost-label">Gross Margin</div><div class="cost-value cost-margin">${fmt(Number(cost?.gross_margin ?? 0))}</div></div>
</div>
<div class="section-title">Ingredients</div>
<table>
  <thead><tr><th>Ingredient</th><th style="text-align:right">Qty Required</th><th style="text-align:right">Unit Cost</th><th style="text-align:right">Line Cost</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:20px">No ingredients added</td></tr>'}</tbody>
</table>
${recipe.notes ? `<div class="notes"><div class="notes-label">📝 Notes</div>${recipe.notes}</div>` : ""}
<div class="footer">Generated by STARK AI Restaurant Management System</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Recipe_${product.name.replace(/\s+/g, "_")}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  message, onConfirm, onCancel, loading, t,
}: {
  message: string; onConfirm: () => void; onCancel: () => void;
  loading: boolean; t: (key: string) => string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-sm p-6 border border-border space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{t("recipes.confirm.areYouSure")}</p>
            <p className="text-sm text-muted-foreground mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
            {t("recipes.confirm.cancel")}
          </Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} disabled={loading} className="min-w-[80px]">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("recipes.confirm.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  title, onClose, onSave, saving, children, t,
}: {
  title: string; onClose: () => void; onSave: () => void;
  saving: boolean; children: React.ReactNode; t: (key: string) => string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-5 border border-border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("recipes.modal.cancel")}</Button>
          <Button onClick={onSave} disabled={saving} className="min-w-[80px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("recipes.modal.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Recipe Card ──────────────────────────────────────────────────────────────

function RecipeCard({
  product, ingredients, selectedPeriodClosed, selectedPeriodLocked,
  onCreateRecipe, onAddIngredient, onEditRecipe, onDeleteRecipe, t,
}: {
  product: any;
  ingredients: any[];
  selectedPeriodClosed: boolean;
  selectedPeriodLocked: boolean;
  onCreateRecipe: (product: any) => void;
  onAddIngredient: (product: any, recipeId: number) => void;
  onEditRecipe: (product: any, recipe: any) => void;
  onDeleteRecipe: (product: any, recipeId: number) => void;
  t: (key: string) => string;
}) {
  const [removingIngId, setRemovingIngId] = useState<number | null>(null);
  const [removeError,   setRemoveError]   = useState<string>("");
  const [expanded,      setExpanded]      = useState(false);
  const [recipe,        setRecipe]        = useState<any>(null);
  const [loading,       setLoading]       = useState(false);
  const [fetched,       setFetched]       = useState(false);
  const [confirm,       setConfirm]       = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  async function loadRecipe() {
    if (fetched) { setExpanded(e => !e); return; }
    setLoading(true);
    try {
      const data = await apiCall<any>(`/api/recipes/${product.id}`);
      setRecipe(data);
    } catch {
      setRecipe(null);
    }
    setFetched(true);
    setLoading(false);
    setExpanded(true);
  }

  const hasRecipe = recipe?.recipe;
  const cost      = recipe?.cost;

  async function handleDelete() {
    setDeleting(true);
    await onDeleteRecipe(product, recipe.recipe.id);
    setRecipe(null);
    setFetched(false);
    setExpanded(false);
    setConfirm(false);
    setDeleting(false);
  }

  async function handleRemoveIngredient(ingredientId: number) {
    if (!recipe?.recipe || selectedPeriodClosed) return;
    setRemovingIngId(ingredientId);
    setRemoveError("");
    try {
      const ok = await removeRecipeIngredient(product.id, ingredientId);
      if (ok) {
        // ✅ Reload full recipe + cost from backend instead of local update
        const data = await apiCall<any>(`/api/recipes/${product.id}`);
        setRecipe(data);
      }
    } catch {
      setRemoveError(t("recipes.err.removeIngredientFailed") || "Failed to remove ingredient.");
    } finally {
      setRemovingIngId(null);
    }
  }

  const lockedTitle = selectedPeriodLocked
    ? "Period is locked — no changes allowed"
    : selectedPeriodClosed
      ? "Period is closed — no changes allowed"
      : undefined;

  return (
    <>
      {confirm && (
        <ConfirmDialog
          message={t("recipes.confirm.deleteMessage").replace("{name}", product.name)}
          onConfirm={handleDelete}
          onCancel={() => setConfirm(false)}
          loading={deleting}
          t={t}
        />
      )}
      <Card className="p-0 overflow-hidden">
        {/* Header row */}
        <div
          className="flex items-center justify-between p-4 cursor-pointer hover:bg-secondary/30 transition-colors"
          onClick={loadRecipe}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
              FG
            </div>
            <div>
              <p className="font-medium text-foreground">{product.name}</p>
              <p className="text-xs text-muted-foreground">
                {product.unit} · {t("recipes.card.sale")}: {fmt(Number(product.sale_price || 0))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              : fetched
                ? hasRecipe
                  ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                      {t("recipes.card.hasRecipe")}
                    </span>
                  : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      {t("recipes.card.noRecipe")}
                    </span>
                : <span className="text-xs text-muted-foreground">{t("recipes.card.clickToLoad")}</span>
            }
            {expanded
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />
            }
          </div>
        </div>

        {/* Expanded content */}
        {expanded && fetched && (
          <div className="border-t border-border p-4 space-y-4 bg-secondary/10">
            {!hasRecipe ? (
              <div className="text-center py-4">
                <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-3">{t("recipes.card.noRecipeDefined")}</p>
                <Button
                  size="sm"
                  onClick={() => onCreateRecipe(product)}
                  disabled={selectedPeriodClosed}
                  title={lockedTitle}
                >
                  <Plus className="w-4 h-4 mr-1" /> {t("recipes.card.createRecipe")}
                </Button>
              </div>
            ) : (
              <>
                {/* Remove ingredient inline error */}
                {removeError && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{removeError}</span>
                    <button onClick={() => setRemoveError("")} className="ml-auto text-red-400 hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Recipe meta */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-background rounded-lg border border-border text-center">
                    <p className="text-xs text-muted-foreground">{t("recipes.card.yield")}</p>
                    <p className="font-semibold text-foreground">{recipe.recipe.yield_pct}%</p>
                  </div>
                  <div className="p-3 bg-background rounded-lg border border-border text-center">
                    <p className="text-xs text-muted-foreground">{t("recipes.card.portion")}</p>
                    <p className="font-semibold text-foreground">
                      {recipe.recipe.portion_size} {recipe.recipe.portion_unit}
                    </p>
                  </div>
                  <div className="p-3 bg-background rounded-lg border border-border text-center">
                    <p className="text-xs text-muted-foreground">{t("recipes.card.foodCostPct")}</p>
                    <p className={`font-semibold ${Number(cost?.food_cost_pct) > 35 ? "text-red-600" : "text-green-600"}`}>
                      {cost?.food_cost_pct ?? 0}%
                    </p>
                  </div>
                </div>

                {/* Cost summary */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-background rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground">{t("recipes.card.rawCostPerPortion")}</p>
                    <p className="text-lg font-bold text-primary">{fmt(Number(cost?.raw_cost ?? 0))}</p>
                  </div>
                  <div className="p-3 bg-background rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground">{t("recipes.card.grossMargin")}</p>
                    <p className="text-lg font-bold text-green-600">{fmt(Number(cost?.gross_margin ?? 0))}</p>
                  </div>
                </div>

                {/* Ingredients table */}
                {recipe.recipe.ingredients?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      {t("recipes.card.ingredients")}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-secondary">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-foreground">{t("recipes.card.col.ingredient")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-foreground">{t("recipes.card.col.qtyRequired")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-foreground">{t("recipes.card.col.unitCost")}</th>
                            <th className="px-3 py-2 text-right font-semibold text-foreground">{t("recipes.card.col.lineCost")}</th>
                            {!selectedPeriodClosed && (
                              <th className="px-3 py-2 text-center font-semibold text-foreground w-10" />
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.recipe.ingredients.map((ing: any, i: number) => (
                            <tr key={i} className="border-b border-border hover:bg-secondary/50">
                              <td className="px-3 py-2 font-medium">{ing.ingredient_name}</td>
                              <td className="px-3 py-2 text-right">{Number(ing.qty_required).toFixed(3)} {ing.unit}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{fmt(Number(ing.cost_per_unit))}</td>
                              <td className="px-3 py-2 text-right font-semibold text-primary">{fmt(Number(ing.line_cost))}</td>
                              {!selectedPeriodClosed && (
                                <td className="px-3 py-2 text-center">
                                  <button
                                    onClick={() => handleRemoveIngredient(ing.ingredient_id)}
                                    disabled={removingIngId === ing.ingredient_id}
                                    className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40"
                                    title={t("recipes.card.removeIngredient") || "Remove"}
                                  >
                                    {removingIngId === ing.ingredient_id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <X className="w-3.5 h-3.5" />
                                    }
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {recipe.recipe.notes && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-semibold text-amber-800 mb-1">{t("recipes.card.notes")}</p>
                    <p className="text-xs text-amber-700">{recipe.recipe.notes}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => onAddIngredient(product, recipe.recipe.id)}
                    disabled={selectedPeriodClosed}
                    title={lockedTitle}
                  >
                    <Plus className="w-4 h-4 mr-1" /> {t("recipes.card.addIngredient")}
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => onEditRecipe(product, recipe.recipe)}
                    disabled={selectedPeriodClosed}
                    title={lockedTitle}
                  >
                    <Pencil className="w-4 h-4 mr-1" /> {t("recipes.card.editRecipe")}
                  </Button>
                  {/* Export is always allowed — read-only action */}
                  <Button
                    size="sm" variant="outline"
                    className="text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => buildRecipePDF(product, recipe.recipe, cost)}
                  >
                    <FileDown className="w-4 h-4 mr-1" /> {t("recipes.card.exportPdf")}
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="text-red-600 border-red-300 hover:bg-red-50 ml-auto"
                    onClick={() => setConfirm(true)}
                    disabled={selectedPeriodClosed}
                    title={lockedTitle}
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> {t("recipes.card.delete")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Recipes() {
  const { t } = useLanguage();
  const [modal,            setModal]            = useState<"recipe" | "ingredient" | null>(null);
  const [saving,           setSaving]           = useState(false);
  const [formError,        setFormError]        = useState("");
  const [selectedProduct,  setSelectedProduct]  = useState<any>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number>(0);
  const [refreshKey,       setRefreshKey]       = useState(0);
  const [isEditing,        setIsEditing]        = useState(false);
  const [search,           setSearch]           = useState("");
  const [filterStatus,     setFilterStatus]     = useState<"all" | "has_recipe" | "no_recipe">("all");

  // ── Period status (mirrors Inventory / Masters) ────────────────────────────
  const [period, setPeriod] = useState(currentPeriod);

  const { data: companyPeriodStatus } =
    useApi<PeriodStatusRow>(() => getPeriodStatus(period), { deps: [period] });

  const selectedPeriodState  = companyPeriodStatus?.status ?? "open";
  const selectedPeriodClosed = selectedPeriodState === "closed" || selectedPeriodState === "locked";
  const selectedPeriodLocked = selectedPeriodState === "locked";

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: products, loading: productsLoading } = useApi(
    () => apiCall<any[]>("/api/products"),
    { deps: [refreshKey] }
  );

  const { data: ingredients } = useApi(
    () => apiCall<any[]>("/api/ingredients")
  );

  // ── Filtered products ─────────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    if (!products) return [];
    return (products as any[]).filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [products, search]);

  const totalProducts = products?.length ?? 0;

  // ── Recipe form ───────────────────────────────────────────────────────────
  const [recipeForm, setRecipeForm] = useState({
    yield_pct: 100, portion_size: 1, portion_unit: "plate", notes: "",
  });

  // ── Ingredient form ───────────────────────────────────────────────────────
  const [ingForm, setIngForm] = useState({ ingredient_id: 0, qty_required: 0 });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openCreateRecipe(product: any) {
    if (selectedPeriodClosed) return;
    setSelectedProduct(product);
    setIsEditing(false);
    setRecipeForm({ yield_pct: 100, portion_size: 1, portion_unit: product.unit || "plate", notes: "" });
    setFormError("");
    setModal("recipe");
  }

  function openEditRecipe(product: any, recipe: any) {
    if (selectedPeriodClosed) return;
    setSelectedProduct(product);
    setIsEditing(true);
    setSelectedRecipeId(recipe.id);
    setRecipeForm({
      yield_pct:    recipe.yield_pct,
      portion_size: recipe.portion_size,
      portion_unit: recipe.portion_unit,
      notes:        recipe.notes || "",
    });
    setFormError("");
    setModal("recipe");
  }

  function openAddIngredient(product: any, recipeId: number) {
    if (selectedPeriodClosed) return;
    setSelectedProduct(product);
    setSelectedRecipeId(recipeId);
    setIngForm({ ingredient_id: 0, qty_required: 0 });
    setFormError("");
    setModal("ingredient");
  }

  async function handleSaveRecipe() {
    if (!selectedProduct || selectedPeriodClosed) return;
    if (recipeForm.yield_pct <= 0 || recipeForm.yield_pct > 100) { setFormError(t("recipes.err.yieldRange")); return; }
    if (recipeForm.portion_size <= 0)                             { setFormError(t("recipes.err.portionSize")); return; }
    if (!recipeForm.portion_unit.trim())                          { setFormError(t("recipes.err.portionUnit")); return; }

    setSaving(true); setFormError("");
    try {
      await apiCall(`/api/recipes/${selectedProduct.id}`, {
        method: "POST",
        body: JSON.stringify({
          yield_pct: recipeForm.yield_pct, portion_size: recipeForm.portion_size,
          portion_unit: recipeForm.portion_unit, notes: recipeForm.notes,
          created_at: new Date().toISOString().split("T")[0],
        }),
      });
      setModal(null);
      setRefreshKey(k => k + 1);
    } catch {
      setFormError(isEditing ? t("recipes.err.updateFailed") : t("recipes.err.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveIngredient() {
    if (selectedPeriodClosed) return;
    if (!ingForm.ingredient_id) { setFormError(t("recipes.err.selectIngredient")); return; }
    if (ingForm.qty_required <= 0) { setFormError(t("recipes.err.qtyPositive")); return; }

    setSaving(true); setFormError("");
    try {
      await apiCall(`/api/recipes/${selectedProduct?.id}/ingredients`, {
        method: "POST",
        body: JSON.stringify({
          recipe_id: selectedRecipeId, ingredient_id: ingForm.ingredient_id,
          qty_required: ingForm.qty_required, created_at: new Date().toISOString().split("T")[0],
        }),
      });
      setModal(null);
      setRefreshKey(k => k + 1);
    } catch {
      setFormError(t("recipes.err.addIngredientFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRecipe(product: any, recipeId: number) {
    if (selectedPeriodClosed) return;
    try {
      await apiCall(`/api/recipes/${product.id}`, { method: "DELETE" });
      setRefreshKey(k => k + 1);
    } catch { /* silent */ }
  }

  const portionUnits = [
    { value: "plate",   label: t("recipes.unit.plate") },
    { value: "box",     label: t("recipes.unit.box") },
    { value: "cup",     label: t("recipes.unit.cup") },
    { value: "bowl",    label: t("recipes.unit.bowl") },
    { value: "serving", label: t("recipes.unit.serving") },
    { value: "piece",   label: t("recipes.unit.piece") },
    { value: "kg",      label: t("recipes.unit.kg") },
    { value: "litre",   label: t("recipes.unit.litre") },
  ];

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Create / Edit Recipe Modal ── */}
      {modal === "recipe" && selectedProduct && (
        <Modal
          title={
            isEditing
              ? t("recipes.modal.editTitle").replace("{name}", selectedProduct.name)
              : t("recipes.modal.createTitle").replace("{name}", selectedProduct.name)
          }
          onClose={() => { setModal(null); setFormError(""); }}
          onSave={handleSaveRecipe}
          saving={saving}
          t={t}
        >
          {formError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-700 font-medium">{t("recipes.modal.product")} {selectedProduct.name}</p>
            <p className="text-xs text-blue-600">{t("recipes.modal.salePrice")} {fmt(Number(selectedProduct.sale_price || 0))}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("recipes.modal.yieldPct")}>
              <input type="number" min={1} max={100} step={0.1} className={inputClass} placeholder="100"
                value={recipeForm.yield_pct || ""}
                onChange={e => setRecipeForm({ ...recipeForm, yield_pct: Number(e.target.value) })} />
            </Field>
            <Field label={t("recipes.modal.portionSize")}>
              <input type="number" min={0.001} step={0.001} className={inputClass} placeholder="1"
                value={recipeForm.portion_size || ""}
                onChange={e => setRecipeForm({ ...recipeForm, portion_size: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("recipes.modal.portionUnit")}>
            <select className={inputClass} value={recipeForm.portion_unit}
              onChange={e => setRecipeForm({ ...recipeForm, portion_unit: e.target.value })}>
              {portionUnits.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </Field>
          <Field label={t("recipes.modal.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("recipes.modal.notesPh")}
              value={recipeForm.notes}
              onChange={e => setRecipeForm({ ...recipeForm, notes: e.target.value })} />
          </Field>
          {!isEditing && (
            <p className="text-xs text-muted-foreground">{t("recipes.modal.afterCreate")}</p>
          )}
        </Modal>
      )}

      {/* ── Add Ingredient Modal ── */}
      {modal === "ingredient" && selectedProduct && (
        <Modal
          title={t("recipes.modal.addIngredientTitle").replace("{name}", selectedProduct.name)}
          onClose={() => { setModal(null); setFormError(""); }}
          onSave={handleSaveIngredient}
          saving={saving}
          t={t}
        >
          {formError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <Field label={t("recipes.modal.ingredient")}>
            <select className={inputClass} value={ingForm.ingredient_id || ""}
              onChange={e => setIngForm({ ...ingForm, ingredient_id: Number(e.target.value) })}>
              <option value="">{t("recipes.modal.selectIngredient")}</option>
              {(ingredients ?? []).map((i: any) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit}) — {fmt(Number(i.cost_per_unit))} / {i.unit}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("recipes.modal.qtyRequired")}>
            <input type="number" min={0.001} step={0.001} className={inputClass}
              placeholder={t("recipes.modal.qtyPh")}
              value={ingForm.qty_required || ""}
              onChange={e => setIngForm({ ...ingForm, qty_required: Number(e.target.value) })} />
          </Field>
          {ingForm.ingredient_id > 0 && ingForm.qty_required > 0 && (() => {
            const ing = (ingredients ?? []).find((i: any) => i.id === ingForm.ingredient_id);
            if (!ing) return null;
            const lineCost = Number(ing.cost_per_unit) * ingForm.qty_required;
            return (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-700 font-medium">
                  {t("recipes.modal.lineCost").replace("{cost}", fmt(lineCost))}
                </p>
              </div>
            );
          })()}
          <p className="text-xs text-muted-foreground">
            {t("recipes.modal.qtyNote").replace("{product}", selectedProduct.name)}
          </p>
        </Modal>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">{t("recipes.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("recipes.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Period picker + status badge */}
          <input
            type="month"
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm
                       focus:outline-none focus:ring-2 focus:ring-ring w-36"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          />
          <span className={`text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
            selectedPeriodLocked
              ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
              : selectedPeriodClosed
                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400"
                : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
          }`}>
            <Lock className="w-3 h-3" />
            {selectedPeriodState.toUpperCase()}
          </span>
          <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* ── Period closed / locked alert banner ── */}
      {selectedPeriodClosed && (
        <Card className={`p-4 ${
          selectedPeriodLocked
            ? "border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20"
            : "border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-900/20"
        }`}>
          <p className={`flex items-center gap-2 text-sm ${
            selectedPeriodLocked
              ? "text-red-700 dark:text-red-400"
              : "text-amber-700 dark:text-amber-400"
          }`}>
            <Lock className="h-4 w-4 flex-shrink-0" />
            {selectedPeriodLocked
              ? `${period} is locked for the whole company. Recipes are read-only.`
              : `${period} is closed for the whole company. Recipe changes are restricted.`}
          </p>
        </Card>
      )}

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground">{t("recipes.kpi.totalProducts")}</p>
          <p className="text-3xl font-bold text-primary mt-2">{totalProducts}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("recipes.kpi.totalProductsSub")}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground">{t("recipes.kpi.ingredients")}</p>
          <p className="text-3xl font-bold text-primary mt-2">{ingredients?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("recipes.kpi.ingredientsSub")}</p>
        </Card>
        <Card className="p-5 border-l-4 border-l-amber-400">
          <p className="text-sm font-medium text-muted-foreground">{t("recipes.kpi.tip")}</p>
          <p className="text-xs text-foreground mt-2 leading-relaxed">{t("recipes.kpi.tipText")}</p>
        </Card>
      </div>

      {/* ── Search & Filter Bar ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t("recipes.search.placeholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`${inputClass} pl-9`}
          />
          {search && (
            <button onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {(["all", "has_recipe", "no_recipe"] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
                filterStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:bg-secondary"
              }`}
            >
              {s === "all" ? t("recipes.filter.all") : s === "has_recipe" ? t("recipes.filter.hasRecipe") : t("recipes.filter.noRecipe")}
            </button>
          ))}
        </div>
      </div>

      {/* ── Product Recipe List ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">{t("recipes.list.title")}</h2>
          {search && (
            <p className="text-xs text-muted-foreground">
              {t("recipes.list.showing")
                .replace("{shown}", String(filteredProducts.length))
                .replace("{total}", String(totalProducts))}
            </p>
          )}
        </div>

        {productsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 bg-secondary/50 rounded-lg animate-pulse" />)}
          </div>
        ) : !filteredProducts.length ? (
          <Card className="p-8 text-center">
            {search
              ? <p className="text-muted-foreground text-sm">{t("recipes.list.empty.search").replace("{search}", search)}</p>
              : <p className="text-muted-foreground text-sm">{t("recipes.list.empty.default")}</p>
            }
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredProducts.map(product => (
              <RecipeCard
                key={`${product.id}-${refreshKey}`}
                product={product}
                ingredients={ingredients ?? []}
                selectedPeriodClosed={selectedPeriodClosed}
                selectedPeriodLocked={selectedPeriodLocked}
                onCreateRecipe={openCreateRecipe}
                onAddIngredient={openAddIngredient}
                onEditRecipe={openEditRecipe}
                onDeleteRecipe={handleDeleteRecipe}
                t={t}
              />
            ))}
          </div>
        )}  
      </div>
    </div>
  );
}
