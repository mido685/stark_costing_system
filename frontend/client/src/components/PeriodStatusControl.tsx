/**
 * PeriodStatusControl
 * A self-contained topbar widget that lets any user with the right role
 * open, close, or lock the company-wide accounting period.
 *
 * Drop it into DashboardLayout's topbar — it needs no props.
 *
 * Usage:
 *   import PeriodStatusControl from "@/components/PeriodStatusControl";
 *   <PeriodStatusControl />
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Lock, LockOpen, ShieldAlert, ChevronDown,
  CheckCircle, Loader2, X, Calendar, AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { getPeriodStatus, setPeriodStatus } from "@/lib/api";
import type { PeriodStatusValue, PeriodStatusRow } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransitionDef {
  value:  PeriodStatusValue;
  labelKey: string;
  descKey:  string;
  color:  string;
}

// ─── Module-level constants (no JSX, no translations) ─────────────────────────
// Icons are rendered in JSX below; only the metadata that is safe at
// module-load time lives here.

const STATUS_PILL: Record<PeriodStatusValue, { pill: string; ring: string; badge: string }> = {
  open: {
    pill:  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/40",
    ring:  "hover:ring-emerald-400/40",
    badge: "bg-emerald-500",
  },
  closed: {
    pill:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/40",
    ring:  "hover:ring-amber-400/40",
    badge: "bg-amber-500",
  },
  locked: {
    pill:  "bg-red-500/15 text-red-600 dark:text-red-400 border-red-400/40",
    ring:  "hover:ring-red-400/40",
    badge: "bg-red-500",
  },
};

const TRANSITIONS: Record<PeriodStatusValue, TransitionDef[]> = {
  open: [
    { value: "closed", labelKey: "period.action.close",  descKey: "period.desc.close",  color: "text-amber-600   dark:text-amber-400"   },
    { value: "locked", labelKey: "period.action.lock",   descKey: "period.desc.lock",   color: "text-red-600     dark:text-red-400"     },
  ],
  closed: [
    { value: "open",   labelKey: "period.action.reopen", descKey: "period.desc.reopen", color: "text-emerald-600 dark:text-emerald-400" },
    { value: "locked", labelKey: "period.action.lock",   descKey: "period.desc.lock",   color: "text-red-600     dark:text-red-400"     },
  ],
  locked: [
    { value: "open",   labelKey: "period.action.unlockOpen",  descKey: "period.desc.unlockOpen",  color: "text-emerald-600 dark:text-emerald-400" },
    { value: "closed", labelKey: "period.action.unlockClose", descKey: "period.desc.unlockClose", color: "text-amber-600   dark:text-amber-400"   },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtPeriod(p: string, locale: string): string {
  try {
    const [y, m] = p.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString(locale, {
      month: "short",
      year:  "numeric",
    });
  } catch {
    return p;
  }
}

// Render the correct icon for each status value
function StatusIcon({ status, className = "w-3.5 h-3.5" }: { status: PeriodStatusValue; className?: string }) {
  if (status === "open")   return <LockOpen    className={className} />;
  if (status === "closed") return <Lock        className={className} />;
  return                          <ShieldAlert className={className} />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PeriodStatusControl() {
  const { t, language } = useLanguage();

  const [period,    setPeriod]    = useState(currentPeriod);
  const [statusRow, setStatusRow] = useState<PeriodStatusRow | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [isOpen,    setIsOpen]    = useState(false);   // renamed from `open` to avoid shadowing
  const [saving,    setSaving]    = useState(false);
  const [confirmTx, setConfirmTx] = useState<TransitionDef | null>(null);
  const [notes,     setNotes]     = useState("");
  const [flash,     setFlash]     = useState<"success" | "error" | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef  = useRef<HTMLButtonElement>(null);

  // ── Fetch status whenever period changes ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPeriodStatus(period)
      .then((row) => { if (!cancelled) setStatusRow(row); })
      .catch(()   => { if (!cancelled) setStatusRow(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  // ── Close dropdown on outside click or Escape ──────────────────────────────
  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setConfirmTx(null);
    setNotes("");
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current  && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current   && !triggerRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDropdown();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown",   handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown",   handleKey);
    };
  }, [isOpen, closeDropdown]);

  // ── Apply a status transition ──────────────────────────────────────────────
  const applyTransition = useCallback(async (tx: TransitionDef) => {
    setSaving(true);
    try {
      const updated = await setPeriodStatus({ period, status: tx.value, notes: notes.trim() });
      setStatusRow(updated);
      setFlash("success");
      setTimeout(() => setFlash(null), 2000);
    } catch {
      setFlash("error");
      setTimeout(() => setFlash(null), 2500);
    } finally {
      setSaving(false);
      closeDropdown();
    }
  }, [period, notes, closeDropdown]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const currentStatus: PeriodStatusValue = statusRow?.status ?? "open";
  const meta        = STATUS_PILL[currentStatus];
  const transitions = TRANSITIONS[currentStatus];
  const periodLabel = fmtPeriod(period, language === "ar" ? "ar-EG" : "en-US");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative">

      {/* ── Pill trigger ── */}
      <button
        ref={triggerRef}
        onClick={() => { setIsOpen((o) => !o); setConfirmTx(null); setNotes(""); }}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label={`${t("period.label")}: ${periodLabel} — ${t(`period.status.${currentStatus}`)}`}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold
          select-none transition-all duration-150
          ring-2 ring-transparent
          ${meta.pill} ${meta.ring}
          ${flash === "success" ? "ring-emerald-400/60 bg-emerald-500/20" : ""}
          ${flash === "error"   ? "ring-red-400/60    bg-red-500/20"      : ""}
        `}
        title={`${t("period.label")}: ${periodLabel} — ${t(`period.status.${currentStatus}`)}`}
      >
        {/* Live dot */}
        <span className={`w-1.5 h-1.5 rounded-full ${meta.badge} ${currentStatus === "open" ? "animate-pulse" : ""}`} />

        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <StatusIcon status={currentStatus} />
        }

        <span className="hidden sm:inline">{periodLabel}</span>
        <span className="font-bold">{t(`period.status.${currentStatus}`)}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />

        {flash === "success" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 ml-0.5" />}
        {flash === "error"   && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-0.5" />}
      </button>

      {/* ── Dropdown ── */}
      {isOpen && (
        <div
          ref={dropdownRef}
          role="dialog"
          aria-label={t("period.label")}
          className="
            absolute right-0 top-full mt-2 z-[200]
            w-80 rounded-xl border border-border bg-card shadow-2xl
            overflow-hidden
            animate-in fade-in slide-in-from-top-2 duration-150
          "
        >

          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t("period.heading")}
              </span>
            </div>
            <button
              onClick={closeDropdown}
              aria-label={t("common.dismiss")}
              className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Period picker */}
          <div className="px-4 py-3 border-b border-border">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
              {t("period.label")}
            </label>
            <input
              type="month"
              value={period}
              onChange={(e) => { setPeriod(e.target.value); setConfirmTx(null); setNotes(""); }}
              className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-sm
                         focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            />
          </div>

          {/* Current status */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                  {t("period.currentStatus")}
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${meta.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.badge} ${currentStatus === "open" ? "animate-pulse" : ""}`} />
                  <StatusIcon status={currentStatus} />
                  {t(`period.status.${currentStatus}`)}
                </span>
              </div>
              {statusRow?.updated_by_name && (
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">{t("period.lastChangedBy")}</p>
                  <p className="text-xs font-medium text-foreground">{statusRow.updated_by_name}</p>
                </div>
              )}
            </div>
            {statusRow?.notes && (
              <p className="mt-2 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-1.5 border border-border">
                {statusRow.notes}
              </p>
            )}
          </div>

          {/* ── Transition list OR confirm step ── */}
          {!confirmTx ? (
            <div className="px-4 py-3 space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
                {t("period.changeTo")}
              </span>
              {transitions.map((tx) => (
                <button
                  key={tx.value}
                  onClick={() => { setConfirmTx(tx); setNotes(""); }}
                  className="
                    w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border border-border
                    bg-secondary/30 hover:bg-secondary/60 hover:border-primary/20
                    text-left transition-all duration-100 group
                  "
                >
                  <div className={`mt-0.5 ${tx.color}`}>
                    <StatusIcon status={tx.value} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tx.color}`}>{t(tx.labelKey)}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{t(tx.descKey)}</p>
                  </div>
                  <span className="mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">›</span>
                </button>
              ))}
            </div>
          ) : (
            /* ── Confirm step ── */
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setConfirmTx(null); setNotes(""); }}
                  className="text-muted-foreground hover:text-foreground transition-colors text-xs flex items-center gap-1"
                  aria-label={t("common.back")}
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>{t("common.back")}</span>
                </button>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t("period.confirm")}: {t(confirmTx.labelKey)}
                </span>
              </div>

              {/* Visual before → after summary */}
              <div className="flex items-center justify-center gap-3 py-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${meta.pill}`}>
                  <StatusIcon status={currentStatus} />
                  {t(`period.status.${currentStatus}`)}
                </span>
                <span className="text-muted-foreground text-sm font-mono">→</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_PILL[confirmTx.value].pill}`}>
                  <StatusIcon status={confirmTx.value} />
                  {t(`period.status.${confirmTx.value}`)}
                </span>
              </div>

              {/* Optional notes */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                  {t("period.reasonOptional")}
                </label>
                <textarea
                  rows={2}
                  placeholder={t("period.reasonPlaceholder")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-input bg-background
                             focus:outline-none focus:ring-2 focus:ring-ring resize-none
                             placeholder:text-muted-foreground"
                />
              </div>

              {/* Confirm button */}
              <button
                onClick={() => applyTransition(confirmTx)}
                disabled={saving}
                className={`
                  w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                  text-sm font-semibold text-white transition-all duration-150
                  disabled:opacity-60 disabled:cursor-not-allowed
                  ${confirmTx.value === "open"
                    ? "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800"
                    : confirmTx.value === "closed"
                      ? "bg-amber-600 hover:bg-amber-700 active:bg-amber-800"
                      : "bg-red-600   hover:bg-red-700   active:bg-red-800"
                  }
                `}
              >
                {saving
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <StatusIcon status={confirmTx.value} className="w-4 h-4" />
                }
                {saving ? t("common.saving") : `${t("period.confirm")} ${t(confirmTx.labelKey)}`}
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border bg-secondary/20">
            <p className="text-[10px] text-muted-foreground text-center">
              {t("period.footerNote").replace("{period}", periodLabel)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}