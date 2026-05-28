/**
 * PeriodStatusControl
 * A self-contained topbar widget that lets any user with the right role
 * open, close, or lock the company-wide accounting period.
 *
 * Drop it into DashboardLayout's topbar — it needs no props.
 * It reads the current period from its own local state (defaults to
 * this month) and calls the same API used by Finance & Inventory pages.
 *
 * Usage in DashboardLayout:
 *   import PeriodStatusControl from "@/components/PeriodStatusControl";
 *   ...
 *   <PeriodStatusControl />   ← place it in the topbar beside the theme toggle
 */

import { useState, useEffect, useRef } from "react";
import {
  Lock, LockOpen, ShieldAlert, ChevronDown,
  CheckCircle, Loader2, X, Calendar, AlertCircle,
} from "lucide-react";
import { getPeriodStatus, setPeriodStatus } from "@/lib/api";
import type { PeriodStatusValue, PeriodStatusRow } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtPeriod(p: string): string {
  // "2026-05" → "May 2026"
  try {
    const [y, m] = p.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", {
      month: "short",
      year:  "numeric",
    });
  } catch {
    return p;
  }
}

// ─── Status meta ──────────────────────────────────────────────────────────────

const STATUS_META: Record<
  PeriodStatusValue,
  { label: string; icon: React.ReactNode; pill: string; ring: string; badge: string }
> = {
  open: {
    label: "Open",
    icon:  <LockOpen  className="w-3.5 h-3.5" />,
    pill:  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-400/40",
    ring:  "hover:ring-emerald-400/40",
    badge: "bg-emerald-500",
  },
  closed: {
    label: "Closed",
    icon:  <Lock      className="w-3.5 h-3.5" />,
    pill:  "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-400/40",
    ring:  "hover:ring-amber-400/40",
    badge: "bg-amber-500",
  },
  locked: {
    label: "Locked",
    icon:  <ShieldAlert className="w-3.5 h-3.5" />,
    pill:  "bg-red-500/15 text-red-600 dark:text-red-400 border-red-400/40",
    ring:  "hover:ring-red-400/40",
    badge: "bg-red-500",
  },
};

const TRANSITIONS: Record<PeriodStatusValue, { value: PeriodStatusValue; label: string; desc: string; color: string }[]> = {
  open: [
    { value: "closed", label: "Close Period",   desc: "Prevents new entries for this period",          color: "text-amber-600 dark:text-amber-400" },
    { value: "locked", label: "Lock Period",    desc: "Fully frozen — requires admin to reopen",       color: "text-red-600   dark:text-red-400"   },
  ],
  closed: [
    { value: "open",   label: "Reopen Period",  desc: "Allow entries again for this period",           color: "text-emerald-600 dark:text-emerald-400" },
    { value: "locked", label: "Lock Period",    desc: "Fully frozen — requires admin to reopen",       color: "text-red-600   dark:text-red-400"   },
  ],
  locked: [
    { value: "open",   label: "Unlock & Open",  desc: "Remove all restrictions for this period",       color: "text-emerald-600 dark:text-emerald-400" },
    { value: "closed", label: "Unlock & Close", desc: "Reopen with restrictions (no new entries)",     color: "text-amber-600 dark:text-amber-400" },
  ],
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PeriodStatusControl() {
  const [period,     setPeriod]     = useState(currentPeriod);
  const [statusRow,  setStatusRow]  = useState<PeriodStatusRow | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [open,       setOpen]       = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [confirmTx,  setConfirmTx]  = useState<(typeof TRANSITIONS)[PeriodStatusValue][number] | null>(null);
  const [notes,      setNotes]      = useState("");
  const [flash,      setFlash]      = useState<"success" | "error" | null>(null);
  const dropdownRef  = useRef<HTMLDivElement>(null);

  // ── Fetch status whenever period changes ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPeriodStatus(period)
      .then(row => { if (!cancelled) setStatusRow(row); })
      .catch(() => { if (!cancelled) setStatusRow(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmTx(null);
        setNotes("");
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const currentStatus: PeriodStatusValue = statusRow?.status ?? "open";
  const meta = STATUS_META[currentStatus];
  const transitions = TRANSITIONS[currentStatus];

  async function applyTransition(tx: typeof transitions[number]) {
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
      setOpen(false);
      setConfirmTx(null);
      setNotes("");
    }
  }

  // ── Trigger button ─────────────────────────────────────────────────────────
  return (
    <div className="relative" ref={dropdownRef}>

      {/* ── Pill button ── */}
      <button
        onClick={() => { setOpen(o => !o); setConfirmTx(null); setNotes(""); }}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-semibold
          select-none transition-all duration-150
          ring-2 ring-transparent
          ${meta.pill} ${meta.ring}
          ${flash === "success" ? "ring-emerald-400/60 bg-emerald-500/20" : ""}
          ${flash === "error"   ? "ring-red-400/60    bg-red-500/20"      : ""}
        `}
        title={`Period status: ${fmtPeriod(period)} is ${meta.label}`}
      >
        {/* Live dot */}
        <span className={`w-1.5 h-1.5 rounded-full ${meta.badge} ${currentStatus === "open" ? "animate-pulse" : ""}`} />

        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : meta.icon}

        <span className="hidden sm:inline">{fmtPeriod(period)}</span>
        <span className="font-bold">{meta.label}</span>
        <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />

        {/* Flash checkmark */}
        {flash === "success" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 ml-0.5" />}
        {flash === "error"   && <AlertCircle className="w-3.5 h-3.5 text-red-500 ml-0.5" />}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="
          absolute right-0 top-full mt-2 z-[200]
          w-80 rounded-xl border border-border bg-card shadow-2xl
          overflow-hidden
          animate-in fade-in slide-in-from-top-2 duration-150
        ">

          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Accounting Period</span>
            </div>
            <button onClick={() => { setOpen(false); setConfirmTx(null); }}
              className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Period picker */}
          <div className="px-4 py-3 border-b border-border">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
              Period
            </label>
            <input
              type="month"
              value={period}
              onChange={e => { setPeriod(e.target.value); setConfirmTx(null); setNotes(""); }}
              className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-sm
                         focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            />
          </div>

          {/* Current status display */}
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">
                  Current Status
                </span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${meta.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.badge} ${currentStatus === "open" ? "animate-pulse" : ""}`} />
                  {meta.icon}
                  {meta.label}
                </span>
              </div>
              {statusRow?.updated_by_name && (
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Last changed by</p>
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

          {/* ── Transition actions OR confirm step ── */}
          {!confirmTx ? (
            <div className="px-4 py-3 space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
                Change To
              </span>
              {transitions.map(tx => (
                <button
                  key={tx.value}
                  onClick={() => { setConfirmTx(tx); setNotes(""); }}
                  className={`
                    w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border border-border
                    bg-secondary/30 hover:bg-secondary/60 hover:border-primary/20
                    text-left transition-all duration-100 group
                  `}
                >
                  <div className={`mt-0.5 ${tx.color}`}>
                    {STATUS_META[tx.value].icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${tx.color}`}>{tx.label}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{tx.desc}</p>
                  </div>
                  <span className={`mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors`}>›</span>
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
                >
                  ← Back
                </button>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Confirm: {confirmTx.label}
                </span>
              </div>

              {/* Visual summary */}
              <div className="flex items-center justify-center gap-3 py-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${meta.pill}`}>
                  {meta.icon}{meta.label}
                </span>
                <span className="text-muted-foreground text-sm font-mono">→</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${STATUS_META[confirmTx.value].pill}`}>
                  {STATUS_META[confirmTx.value].icon}
                  {STATUS_META[confirmTx.value].label}
                </span>
              </div>

              {/* Optional notes */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Reason (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Month-end close, audit freeze…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
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
                  : STATUS_META[confirmTx.value].icon
                }
                {saving ? "Saving…" : `Confirm ${confirmTx.label}`}
              </button>
            </div>
          )}

          {/* Footer hint */}
          <div className="px-4 py-2.5 border-t border-border bg-secondary/20">
            <p className="text-[10px] text-muted-foreground text-center">
              Changes apply company-wide across all branches for {fmtPeriod(period)}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}