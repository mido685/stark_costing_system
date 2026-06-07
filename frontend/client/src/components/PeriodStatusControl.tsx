/**
 * PeriodStatusControl
 *
 * Topbar badge + dropdown panel for period management.
 * Tabs: Actions | History | Past periods
 * Past periods → drill into per-period history view.
 *
 * API shape expected:
 *   GET /api/period/status?period=YYYY-MM
 *     → { status, period, updated_by_name, updated_at, notes }
 *   POST /api/period/status
 *     → { status, period, ... }
 *   GET /api/period/history?period=YYYY-MM
 *     → [ { from_status, to_status, changed_by_name, changed_at, note } ]
 *   GET /api/period/list
 *     → [ { period, status } ]   (sorted DESC, last 24 months)
 *   GET /api/period/validate?period=YYYY-MM
 *     → 200 OK or 422 with error message
 */

import {
  useState, useEffect, useRef, useCallback,
} from "react";
import {
  ChevronDown, CheckCircle, Lock, LockOpen, Eye,
  SlidersHorizontal, ArrowLeft, Clock,
} from "lucide-react";
import { apiCall } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "open" | "closed" | "locked";
type Tab    = "actions" | "history" | "past";

interface PeriodRow {
  period: string;   // "YYYY-MM"
  status: Status;
}

interface HistoryEntry {
  from_status:     Status;
  to_status:       Status;
  changed_by_name: string;
  changed_at:      string;
  note:            string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPeriod(p: string): string {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", {
    month: "long", year: "numeric",
  });
}

function fmtShortPeriod(p: string): string {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", {
    month: "short", year: "numeric",
  });
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("default", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function currentPeriod(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<Status, string> = {
  open:   "bg-emerald-500/10 border-emerald-500/40 text-emerald-400",
  closed: "bg-amber-500/10  border-amber-500/40  text-amber-400",
  locked: "bg-red-500/10    border-red-500/40    text-red-400",
};

const DOT_STYLES: Record<Status, string> = {
  open:   "bg-emerald-500",
  closed: "bg-amber-500",
  locked: "bg-red-500",
};

const PILL_STYLES: Record<Status, string> = {
  open:   "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  closed: "bg-amber-500/10  text-amber-600  dark:text-amber-400",
  locked: "bg-red-500/10    text-red-600    dark:text-red-400",
};

const STATUS_LABELS: Record<Status, string> = {
  open: "Open", closed: "Closed", locked: "Locked",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${PILL_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function TransitionPill({ status }: { status: Status }) {
  const cls: Record<Status, string> = {
    open:   "bg-emerald-500/10 text-emerald-500",
    closed: "bg-amber-500/10  text-amber-500",
    locked: "bg-red-500/10    text-red-500",
  };
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${cls[status]}`}>
      {status}
    </span>
  );
}

function HistoryList({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  if (loading) {
    return <div className="py-6 text-center text-[12px] text-muted-foreground">Loading…</div>;
  }
  if (!entries.length) {
    return <div className="py-6 text-center text-[12px] text-muted-foreground">No transitions recorded yet.</div>;
  }

  const DOT_COLOR: Record<Status, string> = {
    open:   "border-emerald-500 text-emerald-500 bg-emerald-500/10",
    closed: "border-amber-500  text-amber-500  bg-amber-500/10",
    locked: "border-red-500    text-red-500    bg-red-500/10",
  };

  const ICON: Record<Status, React.ReactNode> = {
    open:   <LockOpen size={8} />,
    closed: <Lock     size={8} />,
    locked: <Lock     size={8} />,
  };

  return (
    <div>
      {entries.map((e, i) => (
        <div key={i} className="flex gap-2.5 px-3.5 py-2.5 border-b border-border last:border-0 relative">
          {i < entries.length - 1 && (
            <div className="absolute left-[21px] top-[26px] bottom-[-10px] w-px bg-border" />
          )}
          <div className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center border-[1.5px] mt-0.5 ${DOT_COLOR[e.to_status]}`}>
            {ICON[e.to_status]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-medium text-foreground">{e.changed_by_name}</p>
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              <TransitionPill status={e.from_status} />
              <span className="text-[9px] text-muted-foreground">→</span>
              <TransitionPill status={e.to_status} />
            </div>
            {e.note && (
              <p className="text-[11px] text-muted-foreground italic mt-1">"{e.note}"</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">{fmtDatetime(e.changed_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionBtn({
  icon, label, desc, danger = false, disabled = false, onClick,
}: {
  icon:      React.ReactNode;
  label:     string;
  desc:      string;
  danger?:   boolean;
  disabled?: boolean;
  onClick:   () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left
        border border-border bg-muted/40 transition-colors
        disabled:opacity-35 disabled:cursor-not-allowed
        ${danger
          ? "hover:bg-destructive/5 enabled:hover:border-destructive/30"
          : "hover:bg-accent enabled:hover:border-border"
        }
      `}
    >
      <span className={`shrink-0 ${danger ? "text-destructive" : "text-muted-foreground"}`}>
        {icon}
      </span>
      <div>
        <p className={`text-[12px] font-medium ${danger ? "text-destructive" : "text-foreground"}`}>
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PeriodStatusControl() {
  const { user } = useAuth();

  const todayPeriod = currentPeriod();

  // ── State ─────────────────────────────────────────────────────────────────

  const [open,           setOpen]           = useState(false);
  const [tab,            setTab]            = useState<Tab>("actions");
  const [acting,         setActing]         = useState(false);

  // The period the user has chosen to act on (defaults to current month)
  const [selectedPeriod, setSelectedPeriod] = useState<string>(todayPeriod);

  // Status of the selected period
  const [status,         setStatus]         = useState<Status>("open");

  // Past periods list (excludes current month)
  const [pastPeriods,    setPastPeriods]    = useState<PeriodRow[]>([]);

  // History for the current-period history tab
  const [history,        setHistory]        = useState<HistoryEntry[]>([]);
  const [histLoading,    setHistLoading]    = useState(false);

  // Drill-in: past period history
  const [drillPeriod,    setDrillPeriod]    = useState<PeriodRow | null>(null);
  const [drillHist,      setDrillHist]      = useState<HistoryEntry[]>([]);
  const [drillLoading,   setDrillLoading]   = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const trigRef  = useRef<HTMLButtonElement>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async (p: string) => {
    try {
      const r = await apiCall<any>(`/api/period/status?period=${p}`);
      setStatus(r.status ?? "open");
    } catch {
      setStatus("open");
    }
  }, []);

  const fetchPast = useCallback(async () => {
    try {
      const r = await apiCall<PeriodRow[]>("/api/period/list");
      setPastPeriods((r ?? []).filter((p) => p.period !== todayPeriod));
    } catch {
      setPastPeriods([]);
    }
  }, [todayPeriod]);

  const fetchHistory = useCallback(async (p: string) => {
    setHistLoading(true);
    try {
      const r = await apiCall<HistoryEntry[]>(`/api/period/history?period=${p}`);
      setHistory(r ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, []);

  // Reload status whenever the selected period changes
  useEffect(() => {
    fetchStatus(selectedPeriod);
  }, [selectedPeriod, fetchStatus]);

  // Load past periods list on mount
  useEffect(() => {
    fetchPast();
  }, [fetchPast]);

  // Load history tab data when visible
  useEffect(() => {
    if (open && tab === "history") fetchHistory(selectedPeriod);
  }, [open, tab, selectedPeriod, fetchHistory]);

  // ── Close on outside click / Escape ──────────────────────────────────────

  const closePanel = useCallback(() => {
    setOpen(false);
    setDrillPeriod(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        trigRef.current  && !trigRef.current.contains(e.target as Node)
      ) closePanel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown",   onKey);
    };
  }, [open, closePanel]);

  // ── Period transition ─────────────────────────────────────────────────────

  async function transition(newStatus: Status) {
    if (acting) return;
    const confirmed = window.confirm(
      newStatus === "locked"
        ? "Hard lock is irreversible. The period will be frozen permanently. Continue?"
        : `Set ${fmtShortPeriod(selectedPeriod)} to "${newStatus}"?`
    );
    if (!confirmed) return;

    setActing(true);
    try {
      await apiCall("/api/period/status", {
        method: "POST",
        body: JSON.stringify({ period: selectedPeriod, status: newStatus }),
      });
      setStatus(newStatus);
      fetchPast();
      if (tab === "history") fetchHistory(selectedPeriod);
    } catch (err: any) {
      alert(err?.message ?? "Failed to update period status.");
    } finally {
      setActing(false);
    }
  }

  // ── Pre-close validation ──────────────────────────────────────────────────

  async function runValidation() {
    try {
      await apiCall(`/api/period/validate?period=${selectedPeriod}`);
      alert("All pre-close checks passed.");
    } catch (err: any) {
      alert(err?.message ?? "Validation failed.");
    }
  }

  // ── Drill into past period history ────────────────────────────────────────

  async function openDrill(row: PeriodRow) {
    setDrillPeriod(row);
    setDrillLoading(true);
    try {
      const r = await apiCall<HistoryEntry[]>(`/api/period/history?period=${row.period}`);
      setDrillHist(r ?? []);
    } catch {
      setDrillHist([]);
    } finally {
      setDrillLoading(false);
    }
  }

  // ── Role guards ───────────────────────────────────────────────────────────

  const canClose  = ["admin", "manager"].includes(user?.role ?? "");
  const canLock   = ["admin"].includes(user?.role ?? "");
  const canReopen = ["admin", "manager"].includes(user?.role ?? "");

  // ── All periods available in the selector (current + past) ────────────────

  const allPeriods: PeriodRow[] = [
    { period: todayPeriod, status: selectedPeriod === todayPeriod ? status : "open" },
    ...pastPeriods,
  ];

  // ── Badge label reflects the selected period, not just today ──────────────

  const badgeLabel = `${fmtShortPeriod(selectedPeriod)} · ${STATUS_LABELS[status]}`;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="relative">

      {/* ── Badge trigger ── */}
      <button
        ref={trigRef}
        onClick={() => { setOpen((o) => !o); setDrillPeriod(null); }}
        aria-haspopup="true"
        aria-expanded={open}
        className={`
          flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
          border transition-opacity hover:opacity-85 select-none
          ${BADGE_STYLES[status]}
        `}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${DOT_STYLES[status]}`} />
        {badgeLabel}
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          ref={panelRef}
          className="
            absolute right-0 top-full mt-1.5 z-50
            w-72 rounded-xl border border-border bg-card
            shadow-lg overflow-hidden
          "
        >
          {drillPeriod ? (
            /* ── Drill view: past period history ── */
            <>
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                <button
                  onClick={() => setDrillPeriod(null)}
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent transition-colors"
                  aria-label="Back"
                >
                  <ArrowLeft size={14} />
                </button>
                <div>
                  <p className="text-[13px] font-medium text-foreground">
                    {fmtShortPeriod(drillPeriod.period)} · History
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {STATUS_LABELS[drillPeriod.status]} · {drillHist.length} transition{drillHist.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <HistoryList entries={drillHist} loading={drillLoading} />
              </div>
            </>
          ) : (
            /* ── Main panel ── */
            <>
              {/* Header */}
              <div className="flex items-start justify-between px-3.5 py-2.5 border-b border-border">
                <div>
                  <p className="text-[13px] font-medium text-foreground">{fmtPeriod(selectedPeriod)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {status === "open"   && "Current period · All modules affected"}
                    {status === "closed" && "Soft closed · Writes blocked"}
                    {status === "locked" && "Hard locked · Read-only forever"}
                  </p>
                </div>
                <StatusPill status={status} />
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border">
                {(["actions", "history", "past"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`
                      flex-1 py-2 text-[11px] font-medium capitalize transition-colors
                      border-b-2 -mb-px
                      ${tab === t
                        ? "text-foreground border-emerald-500"
                        : "text-muted-foreground border-transparent hover:text-foreground"
                      }
                    `}
                  >
                    {t === "past" ? "Past periods" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* ── Tab: Actions ── */}
              {tab === "actions" && (
                <div className="p-2 flex flex-col gap-1.5">

                  {/* Period selector */}
                  <select
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    disabled={acting}
                    className="
                      w-full text-[12px] px-2.5 py-1.5 rounded-lg
                      border border-border bg-muted/40 text-foreground
                      disabled:opacity-50
                    "
                  >
                    <option value={todayPeriod}>
                      {fmtShortPeriod(todayPeriod)} (current)
                    </option>
                    {pastPeriods.map((p) => (
                      <option key={p.period} value={p.period}>
                        {fmtShortPeriod(p.period)} · {STATUS_LABELS[p.status]}
                      </option>
                    ))}
                  </select>

                  {/* Actions for open period */}
                  {status === "open" && (
                    <>
                      <ActionBtn
                        icon={<CheckCircle size={14} />}
                        label="Run pre-close checks"
                        desc="Validate before closing"
                        disabled={acting}
                        onClick={runValidation}
                      />
                      {canClose && (
                        <ActionBtn
                          icon={<LockOpen size={14} />}
                          label="Soft close"
                          desc="Block writes, stay reviewable"
                          disabled={acting}
                          onClick={() => transition("closed")}
                        />
                      )}
                      <div className="h-px bg-border my-0.5" />
                      {canLock && (
                        <ActionBtn
                          icon={<Lock size={14} />}
                          label="Hard lock"
                          desc="Freeze forever, no re-open"
                          danger
                          disabled={acting}
                          onClick={() => transition("locked")}
                        />
                      )}
                    </>
                  )}

                  {/* Actions for closed period */}
                  {status === "closed" && (
                    <>
                      {canReopen && (
                        <ActionBtn
                          icon={<LockOpen size={14} />}
                          label="Re-open period"
                          desc="Allow writes again"
                          disabled={acting}
                          onClick={() => transition("open")}
                        />
                      )}
                      <ActionBtn
                        icon={<Eye size={14} />}
                        label="View snapshot"
                        desc="Figures at close time"
                        disabled={acting}
                        onClick={() => setTab("history")}
                      />
                      <div className="h-px bg-border my-0.5" />
                      {canLock && (
                        <ActionBtn
                          icon={<Lock size={14} />}
                          label="Hard lock"
                          desc="Freeze forever, no re-open"
                          danger
                          disabled={acting}
                          onClick={() => transition("locked")}
                        />
                      )}
                    </>
                  )}

                  {/* Actions for locked period */}
                  {status === "locked" && (
                    <>
                      <ActionBtn
                        icon={<Eye size={14} />}
                        label="View snapshot"
                        desc="Figures frozen at lock time"
                        disabled={acting}
                        onClick={() => setTab("history")}
                      />
                      <ActionBtn
                        icon={<SlidersHorizontal size={14} />}
                        label="Post adjusting entry"
                        desc="Correction in current period"
                        disabled={acting}
                        onClick={() => {}}
                      />
                      <ActionBtn
                        icon={<Lock size={14} />}
                        label="Re-open"
                        desc="Not allowed on locked period"
                        disabled
                        onClick={() => {}}
                      />
                    </>
                  )}
                </div>
              )}

              {/* ── Tab: History ── */}
              {tab === "history" && (
                <div className="max-h-72 overflow-y-auto">
                  <HistoryList entries={history} loading={histLoading} />
                </div>
              )}

              {/* ── Tab: Past periods ── */}
              {tab === "past" && (
                <div className="p-2">
                  {pastPeriods.length === 0 ? (
                    <p className="py-4 text-center text-[12px] text-muted-foreground">
                      No past periods.
                    </p>
                  ) : pastPeriods.map((row) => (
                    <div
                      key={row.period}
                      className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                    >
                      <span className="text-[12px] text-foreground">{fmtShortPeriod(row.period)}</span>
                      <div className="flex items-center gap-2">
                        <StatusPill status={row.status} />
                        <button
                          onClick={() => openDrill(row)}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <Clock size={10} />
                          History
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}