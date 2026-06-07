/**
 * PeriodStatusControl
 *
 * Topbar badge + dropdown panel for period management.
 * Selecting a period updates the global WorkingPeriodContext,
 * which filters all period-sensitive pages in the system.
 *
 * Tabs: Actions | History | Past periods
 *
 * API shape:
 *   GET  /api/period/status?period=YYYY-MM   → { success, data: { status, ... } }
 *   POST /api/period/status                  → { success, data: { status, ... } }
 *   GET  /api/period/history?period=YYYY-MM  → { success, data: HistoryEntry[] }
 *   GET  /api/period/list                    → { success, data: PeriodRow[] }
 *   GET  /api/period/validate?period=YYYY-MM → 200 | 422
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronDown, CheckCircle, Lock, LockOpen, Eye,
  SlidersHorizontal, ArrowLeft, Clock, ChevronLeft, ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { apiCall } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkingPeriod } from "@/contexts/Workingperiodcontext";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "open" | "closed" | "locked";
type Tab    = "actions" | "history" | "past";

interface PeriodRow {
  period: string;
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

function currentPeriod(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

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

/** Unwrap { success, data: T } or return raw if already T */
function unwrap<T>(r: any, fallback: T): T {
  if (r && typeof r === "object" && "data" in r) return r.data ?? fallback;
  return r ?? fallback;
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

const MONTH_CELL_STYLES: Record<Status, string> = {
  open:   "text-foreground hover:bg-accent",
  closed: "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
  locked: "bg-red-500/10   text-red-600   dark:text-red-400   hover:bg-red-500/20",
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── StatusPill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${PILL_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── TransitionPill ───────────────────────────────────────────────────────────

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

// ─── HistoryList ──────────────────────────────────────────────────────────────

function HistoryList({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  if (loading) return (
    <div className="py-6 text-center text-[12px] text-muted-foreground">Loading…</div>
  );
  if (!entries.length) return (
    <div className="py-6 text-center text-[12px] text-muted-foreground">No transitions recorded yet.</div>
  );

  const DOT_COLOR: Record<Status, string> = {
    open:   "border-emerald-500 text-emerald-500 bg-emerald-500/10",
    closed: "border-amber-500  text-amber-500  bg-amber-500/10",
    locked: "border-red-500    text-red-500    bg-red-500/10",
  };
  const ICON: Record<Status, React.ReactNode> = {
    open:   <LockOpen size={8} />,
    closed: <Lock size={8} />,
    locked: <Lock size={8} />,
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

// ─── ActionBtn ────────────────────────────────────────────────────────────────

function ActionBtn({
  icon, label, desc, danger = false, disabled = false, onClick,
}: {
  icon: React.ReactNode; label: string; desc: string;
  danger?: boolean; disabled?: boolean; onClick: () => void;
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

// ─── PeriodPicker ─────────────────────────────────────────────────────────────

function PeriodPicker({
  selected, statusMap, todayPeriod, onChange,
}: {
  selected:    string;
  statusMap:   Record<string, Status>;
  todayPeriod: string;
  onChange:    (p: string) => void;
}) {
  const [viewYear, setViewYear] = useState(() => Number(selected.split("-")[0]));

  const todayYear  = Number(todayPeriod.split("-")[0]);
  const todayMonth = Number(todayPeriod.split("-")[1]);

  function isFuture(month: number): boolean {
    if (viewYear > todayYear) return true;
    if (viewYear === todayYear && month > todayMonth) return true;
    return false;
  }

  function cellPeriod(month: number): string {
    return `${viewYear}-${String(month).padStart(2, "0")}`;
  }

  return (
    <div className="px-2 pt-1 pb-2">

      {/* Year navigation */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setViewYear((y) => y - 1)}
          className="p-1 rounded-md text-muted-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft size={13} />
        </button>
        <span className="text-[12px] font-semibold text-foreground">{viewYear}</span>
        <button
          onClick={() => setViewYear((y) => y + 1)}
          disabled={viewYear >= todayYear}
          className="p-1 rounded-md text-muted-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-4 gap-1">
        {MONTH_NAMES.map((name, idx) => {
          const month      = idx + 1;
          const p          = cellPeriod(month);
          const future     = isFuture(month);
          const st         = statusMap[p] ?? "open";
          const isSelected = p === selected;
          const isToday    = p === todayPeriod;

          return (
            <button
              key={p}
              disabled={future}
              onClick={() => onChange(p)}
              className={`
                relative py-1.5 rounded-md text-[11px] font-medium transition-colors
                disabled:opacity-30 disabled:cursor-not-allowed
                ${isSelected
                  ? "ring-2 ring-emerald-500 ring-offset-1 ring-offset-card bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : MONTH_CELL_STYLES[st]
                }
              `}
            >
              {name}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-500" />
              )}
              {!future && st !== "open" && (
                <span className={`absolute top-0.5 right-0.5 w-1 h-1 rounded-full ${st === "locked" ? "bg-red-500" : "bg-amber-500"}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 px-0.5">
        {(["open", "closed", "locked"] as Status[]).map((s) => (
          <span key={s} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${DOT_STYLES[s]}`} />
            {STATUS_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PeriodStatusControl() {
  const { user } = useAuth();
  const { workingPeriod, setWorkingPeriod, isCurrentPeriod } = useWorkingPeriod();

  const todayPeriod = currentPeriod();

  // ── State ─────────────────────────────────────────────────────────────────

  const [open,         setOpen]         = useState(false);
  const [tab,          setTab]          = useState<Tab>("actions");
  const [acting,       setActing]       = useState(false);
  const [status,       setStatus]       = useState<Status>("open");
  const [statusMap,    setStatusMap]    = useState<Record<string, Status>>({});
  const [pastPeriods,  setPastPeriods]  = useState<PeriodRow[]>([]);
  const [history,      setHistory]      = useState<HistoryEntry[]>([]);
  const [histLoading,  setHistLoading]  = useState(false);
  const [drillPeriod,  setDrillPeriod]  = useState<PeriodRow | null>(null);
  const [drillHist,    setDrillHist]    = useState<HistoryEntry[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const trigRef  = useRef<HTMLButtonElement>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async (p: string) => {
    try {
      const r = await apiCall<any>(`/api/period/status?period=${p}`);
      const row = unwrap<any>(r, {});
      const s: Status = row?.status ?? "open";
      setStatus(s);
      setStatusMap((prev) => ({ ...prev, [p]: s }));
    } catch {
      setStatus("open");
    }
  }, []);

  const fetchPast = useCallback(async () => {
    try {
      const r    = await apiCall<any>("/api/period/list");
      const rows: PeriodRow[] = unwrap<PeriodRow[]>(r, []);
      setPastPeriods(rows.filter((p) => p.period !== todayPeriod));
      const map: Record<string, Status> = {};
      rows.forEach((p) => { map[p.period] = p.status; });
      setStatusMap((prev) => ({ ...prev, ...map }));
    } catch {
      setPastPeriods([]);
    }
  }, [todayPeriod]);

  const fetchHistory = useCallback(async (p: string) => {
    setHistLoading(true);
    try {
      const r = await apiCall<any>(`/api/period/history?period=${p}`);
      setHistory(unwrap<HistoryEntry[]>(r, []));
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(workingPeriod); }, [workingPeriod, fetchStatus]);
  useEffect(() => { fetchPast(); },              [fetchPast]);
  useEffect(() => {
    if (open && tab === "history") fetchHistory(workingPeriod);
  }, [open, tab, workingPeriod, fetchHistory]);

  // ── Close on outside click / Escape ──────────────────────────────────────

  const closePanel = useCallback(() => {
    setOpen(false);
    setDrillPeriod(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        trigRef.current  && !trigRef.current.contains(e.target as Node)
      ) closePanel();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePanel(); };
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
        : `Set ${fmtShortPeriod(workingPeriod)} to "${newStatus}"?`
    );
    if (!confirmed) return;

    setActing(true);
    try {
      await apiCall("/api/period/status", {
        method: "POST",
        body: JSON.stringify({ period: workingPeriod, status: newStatus }),
      });
      setStatus(newStatus);
      setStatusMap((prev) => ({ ...prev, [workingPeriod]: newStatus }));
      fetchPast();
      if (tab === "history") fetchHistory(workingPeriod);
    } catch (err: any) {
      alert(err?.message ?? "Failed to update period status.");
    } finally {
      setActing(false);
    }
  }

  // ── Pre-close validation ──────────────────────────────────────────────────

  async function runValidation() {
    try {
      await apiCall(`/api/period/validate?period=${workingPeriod}`);
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
      const r = await apiCall<any>(`/api/period/history?period=${row.period}`);
      setDrillHist(unwrap<HistoryEntry[]>(r, []));
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
        {fmtShortPeriod(workingPeriod)} · {STATUS_LABELS[status]}
        {!isCurrentPeriod && (
          <AlertTriangle size={10} className="text-amber-400 ml-0.5" />
        )}
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
        >
          {drillPeriod ? (

            /* ── Drill view: past period history ── */
            <>
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border">
                <button
                  onClick={() => setDrillPeriod(null)}
                  className="p-1 rounded-md text-muted-foreground hover:bg-accent transition-colors"
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
                  <p className="text-[13px] font-medium text-foreground">{fmtPeriod(workingPeriod)}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {status === "open"   && "All modules open for entry"}
                    {status === "closed" && "Soft closed · Writes blocked"}
                    {status === "locked" && "Hard locked · Read-only forever"}
                  </p>
                </div>
                <StatusPill status={status} />
              </div>

              {/* Past-period warning banner */}
              {!isCurrentPeriod && (
                <div className="flex items-center gap-2 px-3.5 py-2 bg-amber-500/10 border-b border-amber-500/20">
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    System filtered to <span className="font-semibold">{fmtShortPeriod(workingPeriod)}</span>.
                    All pages show this period's data.
                  </p>
                </div>
              )}

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
                <div className="flex flex-col">

                  {/* Period picker */}
                  <div className="border-b border-border">
                    <PeriodPicker
                      selected={workingPeriod}
                      statusMap={statusMap}
                      todayPeriod={todayPeriod}
                      onChange={setWorkingPeriod}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="p-2 flex flex-col gap-1.5">

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
                    <p className="py-4 text-center text-[12px] text-muted-foreground">No past periods.</p>
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