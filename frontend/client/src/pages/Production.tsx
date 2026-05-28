import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus, X, Loader2, AlertCircle, RefreshCw,
  ChefHat, Layers, ArrowRightLeft, Lock,
} from "lucide-react";
import { useApi } from "@/hooks/useApi";
import { getBranches, apiCall, getPeriodStatus } from "@/lib/api";
import type { PeriodStatusRow } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatCurrency as formatCurrencyValue, getCurrencyLabel } from "@/lib/localization";

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalType   = "kitchen" | "transfer" | "production" | null;
type ActivityTab = "kitchen" | "production" | "transfers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split("T")[0];
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

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

// ─── Error Banner ─────────────────────────────────────────────────────────────

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="text-red-400 hover:text-red-600 ml-auto">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  title, onClose, onSave, saving, children, cancelLabel, saveLabel,
}: {
  title: string; onClose: () => void; onSave: () => void;
  saving: boolean; children: React.ReactNode;
  cancelLabel: string; saveLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-5 border border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving}>{cancelLabel}</Button>
          <Button onClick={onSave} disabled={saving} className="min-w-[80px]">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Production() {
  const { language, t } = useLanguage();
  const currentUserId   = Number(localStorage.getItem("user_id") ?? 1);
  const currencyLabel   = getCurrencyLabel(language);

  // ── Period status (mirrors Inventory / Masters / Recipes) ─────────────────
  const [period, setPeriod] = useState(currentPeriod);

  const { data: companyPeriodStatus } =
    useApi<PeriodStatusRow>(() => getPeriodStatus(period), { deps: [period] });

  const selectedPeriodState  = companyPeriodStatus?.status ?? "open";
  const selectedPeriodClosed = selectedPeriodState === "closed" || selectedPeriodState === "locked";
  const selectedPeriodLocked = selectedPeriodState === "locked";

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: branches }    = useApi(getBranches);
  const { data: ingredients } = useApi(() => apiCall<any[]>("/api/ingredients"));
  const { data: products }    = useApi(() => apiCall<any[]>("/api/products"));

  const { data: kitchenIssues,  loading: issuesLoading,      refetch: refetchIssues      } = useApi(() => apiCall<any[]>("/api/stock-issues"));
  const { data: productions,    loading: productionsLoading, refetch: refetchProductions  } = useApi(() => apiCall<any[]>("/api/production"));
  const { data: transfers,      loading: transfersLoading,   refetch: refetchTransfers    } = useApi(() => apiCall<any[]>("/api/transfers/by-branch"));

  // ── Modal state ───────────────────────────────────────────────────────────

  const [modal,     setModal]     = useState<ModalType>(null);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState("");
  const [activeTab, setActiveTab] = useState<ActivityTab>("kitchen");

  // ── Form state ────────────────────────────────────────────────────────────

  const [kitchenForm, setKitchenForm] = useState({
    branch_id: 0, ingredient_id: 0,
    entry_date: today(), qty_issued: 0,
    station: "", notes: "",
  });

  const [transferForm, setTransferForm] = useState({
    from_branch_id: 0, to_branch_id: 0, ingredient_id: 0,
    entry_date: today(), quantity: 0, notes: "",
  });

  const [productionForm, setProductionForm] = useState({
    branch_id: 0, product_id: 0,
    entry_date: today(), quantity: 0,
    direct_labor: 0, overhead: 0, notes: "",
  });

  // ── Stats ─────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const thisMonth = today().slice(0, 7);
    const monthProductions = (productions ?? []).filter(
      (p: any) => String(p.entry_date || "").slice(0, 7) === thisMonth
    );
    return {
      totalBatches: productions?.length  ?? 0,
      monthBatches: monthProductions.length,
      totalIssues:  kitchenIssues?.length ?? 0,
      recipes:      products?.length      ?? 0,
    };
  }, [productions, kitchenIssues, products]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  function openModal(type: ModalType) {
    if (selectedPeriodClosed) return;
    setFormError("");
    setModal(type);
  }

  function closeModal() {
    setModal(null);
    setFormError("");
  }

  function refetchAll() {
    refetchIssues?.();
    refetchProductions?.();
    refetchTransfers?.();
  }

  // ── Save: Kitchen Issue ───────────────────────────────────────────────────

  async function handleSaveKitchen() {
    if (selectedPeriodClosed) return;
    if (!kitchenForm.branch_id)      { setFormError(t("prod.err.branch"));      return; }
    if (!kitchenForm.ingredient_id)  { setFormError(t("prod.err.ingredient"));  return; }
    if (!kitchenForm.qty_issued)     { setFormError(t("prod.err.quantity"));     return; }
    if (!kitchenForm.station.trim()) { setFormError(t("prod.err.station"));      return; }

    setSaving(true);
    setFormError("");
    try {
      await apiCall("/api/stock-issues", {
        method: "POST",
        body: JSON.stringify({ ...kitchenForm, issued_to: kitchenForm.station, user_id: currentUserId }),
      });
      closeModal();
      setKitchenForm({ branch_id: 0, ingredient_id: 0, entry_date: today(), qty_issued: 0, station: "", notes: "" });
      refetchIssues?.();
    } catch {
      setFormError(t("prod.err.saveKitchen"));
    } finally {
      setSaving(false);
    }
  }

  // ── Save: Transfer ────────────────────────────────────────────────────────

  async function handleSaveTransfer() {
    if (selectedPeriodClosed) return;
    if (!transferForm.from_branch_id) { setFormError(t("prod.err.fromBranch")); return; }
    if (!transferForm.to_branch_id)   { setFormError(t("prod.err.toBranch"));   return; }
    if (transferForm.from_branch_id === transferForm.to_branch_id) {
      setFormError(t("prod.err.sameBranch")); return;
    }
    if (!transferForm.ingredient_id)  { setFormError(t("prod.err.ingredient")); return; }
    if (!transferForm.quantity)       { setFormError(t("prod.err.quantity"));    return; }

    setSaving(true);
    setFormError("");
    try {
      await apiCall("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ ...transferForm, user_id: currentUserId }),
      });
      closeModal();
      setTransferForm({ from_branch_id: 0, to_branch_id: 0, ingredient_id: 0, entry_date: today(), quantity: 0, notes: "" });
      refetchTransfers?.();
    } catch {
      setFormError(t("prod.err.saveTransfer"));
    } finally {
      setSaving(false);
    }
  }

  // ── Save: Production Batch ────────────────────────────────────────────────

  async function handleSaveProduction() {
    if (selectedPeriodClosed) return;
    if (!productionForm.branch_id)  { setFormError(t("prod.err.branch"));   return; }
    if (!productionForm.product_id) { setFormError(t("prod.err.product"));  return; }
    if (!productionForm.quantity)   { setFormError(t("prod.err.quantity")); return; }

    setSaving(true);
    setFormError("");
    try {
      await apiCall("/api/production", {
        method: "POST",
        body: JSON.stringify({
          branch_id:     productionForm.branch_id,
          product_id:    productionForm.product_id,
          entry_date:    productionForm.entry_date,
          quantity:      productionForm.quantity,
          labor_cost:    productionForm.direct_labor,
          overhead_cost: productionForm.overhead,
          notes:         productionForm.notes,
          user_id:       currentUserId,
        }),
      });
      closeModal();
      setProductionForm({ branch_id: 0, product_id: 0, entry_date: today(), quantity: 0, direct_labor: 0, overhead: 0, notes: "" });
      refetchProductions?.();
    } catch {
      setFormError(t("prod.err.saveProduction"));
    } finally {
      setSaving(false);
    }
  }

  const modalProps = { saving, cancelLabel: t("prod.cancel"), saveLabel: t("prod.save") };

  const lockedTitle = selectedPeriodLocked
    ? "Period is locked — no changes allowed"
    : selectedPeriodClosed
      ? "Period is closed — no changes allowed"
      : undefined;

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Kitchen Issue Modal ── */}
      {modal === "kitchen" && (
        <Modal title={t("prod.modal.kitchen")} onClose={closeModal} onSave={handleSaveKitchen} {...modalProps}>
          {formError && <ErrorBanner message={formError} onDismiss={() => setFormError("")} />}
          <Field label={t("prod.field.branch")}>
            <select className={inputClass} value={kitchenForm.branch_id || ""}
              onChange={e => setKitchenForm({ ...kitchenForm, branch_id: Number(e.target.value) })}>
              <option value="">{t("prod.ph.selectBranch")}</option>
              {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label={t("prod.field.ingredient")}>
            <select className={inputClass} value={kitchenForm.ingredient_id || ""}
              onChange={e => setKitchenForm({ ...kitchenForm, ingredient_id: Number(e.target.value) })}>
              <option value="">{t("prod.ph.selectIngredient")}</option>
              {ingredients?.map((i: any) => (
                <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("prod.field.date")}>
              <input type="date" className={inputClass} value={kitchenForm.entry_date}
                onChange={e => setKitchenForm({ ...kitchenForm, entry_date: e.target.value })} />
            </Field>
            <Field label={t("prod.field.qtyIssued")}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0.000" value={kitchenForm.qty_issued || ""}
                onChange={e => setKitchenForm({ ...kitchenForm, qty_issued: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("prod.field.station")}>
            <input className={inputClass} placeholder={t("prod.ph.station")}
              value={kitchenForm.station}
              onChange={e => setKitchenForm({ ...kitchenForm, station: e.target.value })} />
          </Field>
          <Field label={t("prod.field.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("prod.ph.notes")}
              value={kitchenForm.notes}
              onChange={e => setKitchenForm({ ...kitchenForm, notes: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">{t("prod.note.kitchen")}</p>
        </Modal>
      )}

      {/* ── Transfer Modal ── */}
      {modal === "transfer" && (
        <Modal title={t("prod.modal.transfer")} onClose={closeModal} onSave={handleSaveTransfer} {...modalProps}>
          {formError && <ErrorBanner message={formError} onDismiss={() => setFormError("")} />}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("prod.field.fromBranch")}>
              <select className={inputClass} value={transferForm.from_branch_id || ""}
                onChange={e => setTransferForm({ ...transferForm, from_branch_id: Number(e.target.value) })}>
                <option value="">{t("prod.ph.selectBranchShort")}</option>
                {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label={t("prod.field.toBranch")}>
              <select className={inputClass} value={transferForm.to_branch_id || ""}
                onChange={e => setTransferForm({ ...transferForm, to_branch_id: Number(e.target.value) })}>
                <option value="">{t("prod.ph.selectBranchShort")}</option>
                {branches?.filter(b => b.id !== transferForm.from_branch_id)
                  .map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t("prod.field.ingredient")}>
            <select className={inputClass} value={transferForm.ingredient_id || ""}
              onChange={e => setTransferForm({ ...transferForm, ingredient_id: Number(e.target.value) })}>
              <option value="">{t("prod.ph.selectIngredient")}</option>
              {ingredients?.map((i: any) => (
                <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("prod.field.date")}>
              <input type="date" className={inputClass} value={transferForm.entry_date}
                onChange={e => setTransferForm({ ...transferForm, entry_date: e.target.value })} />
            </Field>
            <Field label={t("prod.field.quantity")}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0.000" value={transferForm.quantity || ""}
                onChange={e => setTransferForm({ ...transferForm, quantity: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("prod.field.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("prod.ph.transferNotes")}
              value={transferForm.notes}
              onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">{t("prod.note.transfer")}</p>
        </Modal>
      )}

      {/* ── Production Batch Modal ── */}
      {modal === "production" && (
        <Modal title={t("prod.modal.production")} onClose={closeModal} onSave={handleSaveProduction} {...modalProps}>
          {formError && <ErrorBanner message={formError} onDismiss={() => setFormError("")} />}
          <Field label={t("prod.field.branch")}>
            <select className={inputClass} value={productionForm.branch_id || ""}
              onChange={e => setProductionForm({ ...productionForm, branch_id: Number(e.target.value) })}>
              <option value="">{t("prod.ph.selectBranch")}</option>
              {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label={t("prod.field.product")}>
            <select className={inputClass} value={productionForm.product_id || ""}
              onChange={e => setProductionForm({ ...productionForm, product_id: Number(e.target.value) })}>
              <option value="">{t("prod.ph.selectProduct")}</option>
              {products?.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("prod.field.date")}>
              <input type="date" className={inputClass} value={productionForm.entry_date}
                onChange={e => setProductionForm({ ...productionForm, entry_date: e.target.value })} />
            </Field>
            <Field label={t("prod.field.qtyProduced")}>
              <input type="number" min={0} step={0.001} className={inputClass}
                placeholder="0.000" value={productionForm.quantity || ""}
                onChange={e => setProductionForm({ ...productionForm, quantity: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("prod.field.laborCost").replace("{currency}", currencyLabel)}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00" value={productionForm.direct_labor || ""}
                onChange={e => setProductionForm({ ...productionForm, direct_labor: Number(e.target.value) })} />
            </Field>
            <Field label={t("prod.field.overheadCost").replace("{currency}", currencyLabel)}>
              <input type="number" min={0} step={0.01} className={inputClass}
                placeholder="0.00" value={productionForm.overhead || ""}
                onChange={e => setProductionForm({ ...productionForm, overhead: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label={t("prod.field.notes")}>
            <textarea className={inputClass} rows={2} placeholder={t("prod.ph.productionNotes")}
              value={productionForm.notes}
              onChange={e => setProductionForm({ ...productionForm, notes: e.target.value })} />
          </Field>
        </Modal>
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary">{t("prod.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("prod.subtitle")}</p>
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
          <Button variant="outline" size="sm" onClick={refetchAll}>
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
              ? `${period} is locked for the whole company. No production entries are allowed.`
              : `${period} is closed for the whole company. Production entries are restricted.`}
          </p>
        </Card>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground">{t("prod.kpi.recipes")}</p>
          <p className="text-3xl font-bold text-primary mt-2">{stats.recipes}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("prod.kpi.recipesDesc")}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground">{t("prod.kpi.batches")}</p>
          <p className="text-3xl font-bold text-primary mt-2">{stats.totalBatches}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("prod.kpi.batchesDesc")}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground">{t("prod.kpi.thisMonth")}</p>
          <p className="text-3xl font-bold text-primary mt-2">{stats.monthBatches}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("prod.kpi.thisMonthDesc")}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-muted-foreground">{t("prod.kpi.kitchenIssues")}</p>
          <p className="text-3xl font-bold text-primary mt-2">{stats.totalIssues}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("prod.kpi.kitchenIssuesDesc")}</p>
        </Card>
      </div>

      {/* ── Operations ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">{t("prod.ops.title")}</h2>
          <div className="space-y-3">
            {[
              {
                key:   "kitchen"    as ModalType,
                op:    t("prod.ops.kitchen"),
                desc:  t("prod.ops.kitchenDesc"),
                icon:  <ChefHat className="w-6 h-6" />,
                color: "bg-orange-100 text-orange-700",
              },
              {
                key:   "transfer"   as ModalType,
                op:    t("prod.ops.transfer"),
                desc:  t("prod.ops.transferDesc"),
                icon:  <ArrowRightLeft className="w-6 h-6" />,
                color: "bg-blue-100 text-blue-700",
              },
              {
                key:   "production" as ModalType,
                op:    t("prod.ops.production"),
                desc:  t("prod.ops.productionDesc"),
                icon:  <Layers className="w-6 h-6" />,
                color: "bg-purple-100 text-purple-700",
              },
            ].map(item => (
              <div
                key={item.op}
                className={`p-4 bg-secondary/50 rounded-lg border border-border transition-colors flex items-center justify-between ${
                  selectedPeriodClosed
                    ? "opacity-60"
                    : "hover:border-primary/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`${item.color} p-2 rounded-lg`}>{item.icon}</div>
                  <div>
                    <p className="font-medium text-foreground">{item.op}</p>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openModal(item.key)}
                  disabled={selectedPeriodClosed}
                  title={lockedTitle}
                >
                  <Plus className="w-4 h-4 mr-1" /> {t("prod.ops.record")}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        {/* Products list */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">{t("prod.products.title")}</h2>
          {!products?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("prod.products.empty")}</p>
          ) : (
            <div className="space-y-2">
              {(products as any[]).slice(0, 6).map((p: any) => (
                <div key={p.id} className="p-3 bg-secondary/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.unit}</p>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {fmt(Number(p.sale_price || 0))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Recent Activity Tabs ── */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">{t("prod.recent.title")}</h2>
          <div className="flex gap-2">
            {(["kitchen", "production", "transfers"] as ActivityTab[]).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}>
                {tab === "kitchen"
                  ? t("prod.tab.kitchen")
                  : tab === "production"
                  ? t("prod.tab.production")
                  : t("prod.tab.transfers")}
              </button>
            ))}
          </div>
        </div>

        {/* Kitchen Issues Tab */}
        {activeTab === "kitchen" && (
          issuesLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-secondary/50 rounded animate-pulse" />)}</div>
          ) : !kitchenIssues?.length ? (
            <div className="py-10 text-center">
              <ChefHat className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("prod.kitchen.empty")}</p>
              <Button size="sm" className="mt-3 gap-1"
                onClick={() => openModal("kitchen")}
                disabled={selectedPeriodClosed}
                title={lockedTitle}
              >
                <Plus className="w-4 h-4" /> {t("prod.kitchen.cta")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.date")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.branch")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.ingredient")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.station")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("prod.table.qtyIssued")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(kitchenIssues as any[]).slice(0, 20).map((row: any, i: number) => (
                    <tr key={i} className="border-b border-border hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">{row.entry_date}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.branch_name ?? `Branch #${row.branch_id}`}</td>
                      <td className="px-4 py-3 font-medium">{row.ingredient_name ?? `Item #${row.ingredient_id}`}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.issued_to ?? row.station ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {Number(row.qty_issued ?? row.quantity ?? 0).toFixed(3)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{row.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Production Tab */}
        {activeTab === "production" && (
          productionsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-secondary/50 rounded animate-pulse" />)}</div>
          ) : !productions?.length ? (
            <div className="py-10 text-center">
              <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("prod.production.empty")}</p>
              <Button size="sm" className="mt-3 gap-1"
                onClick={() => openModal("production")}
                disabled={selectedPeriodClosed}
                title={lockedTitle}
              >
                <Plus className="w-4 h-4" /> {t("prod.production.cta")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.date")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.branch")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.product")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("prod.table.quantity")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("prod.table.material")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("prod.table.labor")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("prod.table.totalCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(productions as any[]).slice(0, 20).map((row: any, i: number) => {
                    const total = Number(row.material_cost || 0) +
                                  Number(row.labor_cost    || 0) +
                                  Number(row.overhead_cost || 0);
                    return (
                      <tr key={i} className="border-b border-border hover:bg-secondary/50 transition-colors">
                        <td className="px-4 py-3">{row.entry_date}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.branch_name ?? `Branch #${row.branch_id}`}</td>
                        <td className="px-4 py-3 font-medium">{row.product_name ?? `Product #${row.product_id}`}</td>
                        <td className="px-4 py-3 text-right">{Number(row.quantity).toFixed(3)} {row.unit ?? ""}</td>
                        <td className="px-4 py-3 text-right">{fmt(Number(row.material_cost || 0))}</td>
                        <td className="px-4 py-3 text-right">{fmt(Number(row.labor_cost    || 0))}</td>
                        <td className="px-4 py-3 text-right font-semibold text-primary">{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Transfers Tab */}
        {activeTab === "transfers" && (
          transfersLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-secondary/50 rounded animate-pulse" />)}</div>
          ) : !transfers?.length ? (
            <div className="py-10 text-center">
              <ArrowRightLeft className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("prod.transfers.empty")}</p>
              <Button size="sm" className="mt-3 gap-1"
                onClick={() => openModal("transfer")}
                disabled={selectedPeriodClosed}
                title={lockedTitle}
              >
                <Plus className="w-4 h-4" /> {t("prod.transfers.cta")}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.date")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.from")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.to")}</th>
                    <th className="px-4 py-2 text-left font-semibold">{t("prod.table.ingredient")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("prod.table.quantity")}</th>
                    <th className="px-4 py-2 text-center font-semibold">{t("prod.table.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(transfers as any[]).slice(0, 20).map((row: any, i: number) => (
                    <tr key={i} className="border-b border-border hover:bg-secondary/50 transition-colors">
                      <td className="px-4 py-3">{row.entry_date}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.from_branch_name ?? `Branch #${row.from_branch_id}`}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.to_branch_name   ?? `Branch #${row.to_branch_id}`}</td>
                      <td className="px-4 py-3 font-medium">{row.ingredient_name ?? `Item #${row.ingredient_id}`}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">{Number(row.quantity).toFixed(3)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                          row.status === "approved"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
