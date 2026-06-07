/**
 * PeriodStatusControl — Enterprise Edition
 * Uses ReactDOM.createPortal — renders into document.body to escape all
 * z-index / overflow / stacking-context issues.
 * Panel position is computed from the badge's getBoundingClientRect(),
 * clamped so it never exits the viewport on either side.
 */

import {
  useState, useEffect, useRef, useCallback, useMemo,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown, CheckCircle, Lock, LockOpen, Eye,
  SlidersHorizontal, ArrowLeft, Clock,
  ChevronLeft, ChevronRight, AlertTriangle, X,
  Zap, Shield, Activity,
} from "lucide-react";
import { apiCall }          from "@/lib/api";
import { useAuth }          from "@/contexts/AuthContext";
import { useWorkingPeriod } from "@/contexts/Workingperiodcontext";

// ─── Types ────────────────────────────────────────────────────────────────────

type Status = "open" | "closed" | "locked";
type Tab    = "actions" | "history" | "past";

interface PeriodRow    { period: string; status: Status; }
interface HistoryEntry {
  from_status: Status; to_status: Status;
  changed_by_name: string; changed_at: string; note: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCurrentPeriod(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function fmtPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "long", year: "numeric" });
}
function fmtShortPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("default", { month: "short", year: "numeric" });
}
function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("default", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function unwrap<T>(r: unknown, fallback: T): T {
  if (r && typeof r === "object" && "data" in r) return (r as { data?: T }).data ?? fallback;
  return (r as T) ?? fallback;
}
function extractError(err: unknown): string {
  if (!err || typeof err !== "object") return "An unexpected error occurred.";
  const e = err as Record<string, unknown>;
  if (typeof e.message === "string" && e.message) return e.message;
  if (typeof e.detail  === "string" && e.detail)  return e.detail;
  return "An unexpected error occurred.";
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const STATUS = {
  open: {
    badge:  "bg-emerald-500/[0.08] border-emerald-500/25 text-emerald-400",
    dot:    "bg-emerald-400",
    pill:   "bg-emerald-500/10 text-emerald-500",
    ring:   "ring-emerald-500",
    cell:   "hover:bg-emerald-500/10 hover:text-emerald-400",
    label:  "Open",
    desc:   "All modules open for data entry",
    icon:   <Activity size={12} />,
  },
  closed: {
    badge:  "bg-amber-500/[0.08] border-amber-500/25 text-amber-400",
    dot:    "bg-amber-400",
    pill:   "bg-amber-500/10 text-amber-500",
    ring:   "ring-amber-500",
    cell:   "bg-amber-500/[0.06] text-amber-400 hover:bg-amber-500/15",
    label:  "Closed",
    desc:   "Soft-closed · Writes blocked",
    icon:   <Lock size={12} />,
  },
  locked: {
    badge:  "bg-red-500/[0.08] border-red-500/25 text-red-400",
    dot:    "bg-red-400",
    pill:   "bg-red-500/10 text-red-500",
    ring:   "ring-red-500",
    cell:   "bg-red-500/[0.06] text-red-400 hover:bg-red-500/15",
    label:  "Locked",
    desc:   "Hard locked · Read-only permanently",
    icon:   <Shield size={12} />,
  },
} satisfies Record<Status, object>;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PANEL_WIDTH = 300;
const VIEWPORT_GAP = 8; // min distance from viewport edges

// ─── Animation CSS ────────────────────────────────────────────────────────────

const css = `
  @keyframes psc-panel-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes psc-toast-in {
    from { opacity: 0; transform: translateX(12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes psc-row-in {
    from { opacity: 0; transform: translateX(-6px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes psc-spin { to { transform: rotate(360deg); } }
  .psc-panel      { animation: psc-panel-in 0.18s cubic-bezier(0.16,1,0.3,1) forwards; }
  .psc-toast      { animation: psc-toast-in 0.22s cubic-bezier(0.16,1,0.3,1) forwards; }
  .psc-row        { animation: psc-row-in 0.15s cubic-bezier(0.16,1,0.3,1) both; }
  .psc-spin       { animation: psc-spin 0.7s linear infinite; }
  .psc-action-btn { transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease; }
  .psc-action-btn:hover:not(:disabled)  { transform: translateY(-1px); box-shadow: 0 4px 12px -2px rgba(0,0,0,0.25); }
  .psc-action-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
  .psc-cal-cell   { transition: background 0.1s ease, color 0.1s ease, transform 0.1s ease; }
  .psc-cal-cell:hover:not(:disabled) { transform: scale(1.08); }
  .psc-tab-bar    { position: relative; }
  .psc-tab-indicator {
    position: absolute; bottom: 0; height: 2px; background: #10b981;
    border-radius: 2px;
    transition: left 0.2s cubic-bezier(0.4,0,0.2,1), width 0.2s cubic-bezier(0.4,0,0.2,1);
  }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full tracking-wide ${STATUS[status].pill}`}>
      {STATUS[status].icon}
      {STATUS[status].label.toUpperCase()}
    </span>
  );
}

function Spinner() {
  return <span className="psc-spin inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent" />;
}

function HistoryList({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  if (loading) return (
    <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground">
      <Spinner /><span className="text-[11px]">Loading history…</span>
    </div>
  );
  if (!entries.length) return (
    <div className="py-8 text-center text-[11px] text-muted-foreground">No transitions recorded yet.</div>
  );
  return (
    <div className="py-1">
      {entries.map((e, i) => (
        <div key={i} className="psc-row flex gap-3 px-3.5 py-2.5 relative" style={{ animationDelay: `${i * 40}ms` }}>
          {i < entries.length - 1 && <div className="absolute left-[26px] top-[28px] bottom-0 w-px bg-border/50" />}
          <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 ${STATUS[e.to_status].pill} ring-1 ring-inset ${STATUS[e.to_status].ring}/30`}>
            <span className="text-[8px]">{STATUS[e.to_status].icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS[e.from_status].pill}`}>{STATUS[e.from_status].label}</span>
              <span className="text-[9px] text-muted-foreground">→</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS[e.to_status].pill}`}>{STATUS[e.to_status].label}</span>
            </div>
            <p className="text-[12px] font-medium text-foreground mt-0.5">{e.changed_by_name}</p>
            {e.note && <p className="text-[11px] text-muted-foreground italic mt-0.5">"{e.note}"</p>}
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{fmtDatetime(e.changed_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionBtn({
  icon, label, desc, danger = false, disabled = false, loading = false, onClick,
}: {
  icon: React.ReactNode; label: string; desc: string;
  danger?: boolean; disabled?: boolean; loading?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        psc-action-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left
        border transition-colors
        disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none
        ${danger
          ? "border-red-500/20 bg-red-500/[0.04] hover:bg-red-500/10 hover:border-red-500/40"
          : "border-border/60 bg-muted/30 hover:bg-muted/60 hover:border-border"
        }
      `}
    >
      <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${danger ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
        {loading ? <Spinner /> : icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-[12px] font-semibold ${danger ? "text-red-400" : "text-foreground"}`}>{label}</p>
        <p className="text-[11px] text-muted-foreground truncate">{desc}</p>
      </div>
      {!disabled && !loading && <ChevronRight size={12} className="shrink-0 text-muted-foreground/50" />}
    </button>
  );
}

function AdjustingEntryForm({ period, onClose, onSuccess }: {
  period: string; onClose: () => void; onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!parsed || isNaN(parsed)) { setError("Enter a valid amount."); return; }
    if (!reason.trim())           { setError("Reason is required."); return; }
    setSaving(true); setError(null);
    try {
      await apiCall("/api/period/adjusting-entry", {
        method: "POST",
        body: JSON.stringify({ references_period: period, amount: parsed, reason: reason.trim() }),
      });
      onSuccess();
    } catch (err) { setError(extractError(err)); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-3.5 flex flex-col gap-3 border-t border-border/50">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-semibold text-foreground">Post Adjusting Entry</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Correction in current period · ref {fmtShortPeriod(period)}</p>
        </div>
        <button onClick={onClose} className="w-6 h-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex items-center justify-center">
          <X size={12} />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Amount (EGP)</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-[13px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reason</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe the correction…" rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 resize-none transition-colors" />
      </div>
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertTriangle size={11} className="text-destructive shrink-0" />
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      )}
      <button onClick={handleSubmit} disabled={saving}
        className="w-full py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
        {saving ? <><Spinner /> Posting…</> : <><Zap size={12} /> Post Entry</>}
      </button>
    </div>
  );
}

function PeriodPicker({ selected, statusMap, todayPeriod, onChange }: {
  selected: string; statusMap: Record<string, Status>; todayPeriod: string; onChange: (p: string) => void;
}) {
  const [viewYear, setViewYear] = useState(() => Number(selected.split("-")[0]));
  const todayYear  = Number(todayPeriod.split("-")[0]);
  const todayMonth = Number(todayPeriod.split("-")[1]);
  const isFuture = (m: number) => viewYear > todayYear || (viewYear === todayYear && m > todayMonth);
  const cell     = (m: number) => `${viewYear}-${String(m).padStart(2, "0")}`;

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setViewYear((y) => y - 1)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <ChevronLeft size={13} />
        </button>
        <span className="text-[12px] font-bold text-foreground tracking-wider">{viewYear}</span>
        <button onClick={() => setViewYear((y) => y + 1)} disabled={viewYear >= todayYear}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
          <ChevronRight size={13} />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {MONTHS.map((name, idx) => {
          const m = idx + 1; const p = cell(m);
          const future = isFuture(m); const st = statusMap[p] ?? "open";
          const isSelected = p === selected; const isToday = p === todayPeriod;
          return (
            <button key={p} disabled={future} onClick={() => onChange(p)}
              className={`psc-cal-cell relative py-1.5 rounded-lg text-[11px] font-semibold disabled:opacity-25 disabled:cursor-not-allowed
                ${isSelected ? `ring-2 ${STATUS[st].ring} ring-offset-1 ring-offset-card ${STATUS[st].pill}` : STATUS[st].cell}`}>
              {name}
              {isToday && !isSelected && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-400" />}
              {!future && st !== "open" && <span className={`absolute top-0.5 right-0.5 w-1 h-1 rounded-full ${STATUS[st].dot}`} />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 pt-2.5 border-t border-border/50">
        {(["open","closed","locked"] as Status[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS[s].dot}`} />{STATUS[s].label}
          </span>
        ))}
      </div>
    </div>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: "actions", label: "Actions" },
  { key: "history", label: "History" },
  { key: "past",    label: "Past Periods" },
];

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const active = c.querySelector(`[data-tab="${tab}"]`) as HTMLElement | null;
    if (active) setInd({ left: active.offsetLeft, width: active.offsetWidth });
  }, [tab]);
  return (
    <div ref={containerRef} className="psc-tab-bar flex border-b border-border/50">
      <div className="psc-tab-indicator" style={{ left: ind.left, width: ind.width }} />
      {TABS.map(({ key, label }) => (
        <button key={key} data-tab={key} onClick={() => onChange(key)}
          className={`flex-1 py-2.5 text-[11px] font-semibold tracking-wide transition-colors ${tab === key ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PeriodStatusControl() {
  const { user }                                             = useAuth();
  const { workingPeriod, setWorkingPeriod, isCurrentPeriod } = useWorkingPeriod();
  const todayPeriod = useMemo(() => buildCurrentPeriod(), []);

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
  const [showAdjForm,  setShowAdjForm]  = useState(false);
  const [toast,        setToast]        = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  const trigRef  = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Panel position — left-clamped so it never exits the viewport
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!trigRef.current) return;
    const r = trigRef.current.getBoundingClientRect();
    // Right-align panel to badge, then clamp within viewport
    let left = r.right - PANEL_WIDTH;
    if (left < VIEWPORT_GAP) left = VIEWPORT_GAP;
    if (left + PANEL_WIDTH > window.innerWidth - VIEWPORT_GAP) {
      left = window.innerWidth - PANEL_WIDTH - VIEWPORT_GAP;
    }
    setPanelPos({ top: r.bottom + 8, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, updatePos]);

  function showToast(msg: string, type: "ok" | "err" = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async (p: string) => {
    try {
      const r   = await apiCall<unknown>(`/api/period/status?period=${p}`);
      const row = unwrap<Record<string, unknown>>(r, {});
      const s   = (row?.status as Status | undefined) ?? "open";
      setStatus(s);
      setStatusMap((prev) => ({ ...prev, [p]: s }));
    } catch { setStatus("open"); }
  }, []);

  const fetchPast = useCallback(async () => {
    try {
      const r    = await apiCall<unknown>("/api/period/list");
      const rows = unwrap<PeriodRow[]>(r, []);
      setPastPeriods(rows.filter((p) => p.period !== todayPeriod));
      const map: Record<string, Status> = {};
      rows.forEach((p) => { map[p.period] = p.status; });
      setStatusMap((prev) => ({ ...prev, ...map }));
    } catch { setPastPeriods([]); }
  }, [todayPeriod]);

  const fetchHistory = useCallback(async (p: string) => {
    setHistLoading(true);
    try {
      const r = await apiCall<unknown>(`/api/period/history?period=${p}`);
      setHistory(unwrap<HistoryEntry[]>(r, []));
    } catch { setHistory([]); }
    finally { setHistLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(workingPeriod); }, [workingPeriod, fetchStatus]);
  useEffect(() => { fetchPast(); }, [fetchPast]);
  useEffect(() => {
    if (open && tab === "history") fetchHistory(workingPeriod);
  }, [open, tab, workingPeriod, fetchHistory]);

  // ── Close ──────────────────────────────────────────────────────────────────

  const closePanel = useCallback(() => {
    setOpen(false); setDrillPeriod(null); setShowAdjForm(false);
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

  // ── Transition ────────────────────────────────────────────────────────────

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
      showToast(`Period set to ${newStatus}.`);
    } catch (err) { showToast(extractError(err), "err"); }
    finally { setActing(false); }
  }

  async function runValidation() {
    try {
      await apiCall(`/api/period/validate?period=${workingPeriod}`);
      showToast("All pre-close checks passed.");
    } catch (err) { showToast(extractError(err), "err"); }
  }

  async function openDrill(row: PeriodRow) {
    setDrillPeriod(row);
    setDrillLoading(true);
    try {
      const r = await apiCall<unknown>(`/api/period/history?period=${row.period}`);
      setDrillHist(unwrap<HistoryEntry[]>(r, []));
    } catch { setDrillHist([]); }
    finally { setDrillLoading(false); }
  }

  const role      = user?.role ?? "";
  const canClose  = ["owner", "admin", "manager"].includes(role);
  const canLock   = ["owner", "admin"].includes(role);
  const canReopen = ["owner", "admin", "manager"].includes(role);

  // ─── Portal panel ─────────────────────────────────────────────────────────

  const panelContent = open ? createPortal(
    <div
      ref={panelRef}
      className="psc-panel fixed w-[300px] rounded-2xl border border-border/60 bg-card"
      style={{
        top:       panelPos.top,
        left:      panelPos.left,
        zIndex:    99999,
        boxShadow: "0 20px 60px -10px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
      }}
    >
      {drillPeriod ? (
        <>
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50">
            <button onClick={() => setDrillPeriod(null)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
              <ArrowLeft size={13} />
            </button>
            <div>
              <p className="text-[13px] font-bold text-foreground">{fmtShortPeriod(drillPeriod.period)}</p>
              <p className="text-[10px] text-muted-foreground">
                {STATUS[drillPeriod.status].label} · {drillHist.length} transition{drillHist.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="ml-auto"><StatusPill status={drillPeriod.status} /></div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <HistoryList entries={drillHist} loading={drillLoading} />
          </div>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[14px] font-bold text-foreground leading-tight">{fmtPeriod(workingPeriod)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{STATUS[status].desc}</p>
              </div>
              <StatusPill status={status} />
            </div>
            {!isCurrentPeriod && (
              <div className="flex items-center gap-2 mt-2.5 px-2.5 py-2 rounded-xl bg-amber-500/[0.08] border border-amber-500/20">
                <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                <p className="text-[11px] text-amber-400">
                  Viewing <span className="font-bold">{fmtShortPeriod(workingPeriod)}</span> · all pages filtered
                </p>
              </div>
            )}
          </div>

          {/* Tabs */}
          <TabBar tab={tab} onChange={(t) => { setTab(t); setShowAdjForm(false); }} />

          {/* Actions tab */}
          {tab === "actions" && (
            <div>
              <div className="border-b border-border/50">
                <PeriodPicker
                  selected={workingPeriod}
                  statusMap={statusMap}
                  todayPeriod={todayPeriod}
                  onChange={(p) => { setWorkingPeriod(p); setShowAdjForm(false); }}
                />
              </div>
              {showAdjForm && status === "locked" ? (
                <AdjustingEntryForm
                  period={workingPeriod}
                  onClose={() => setShowAdjForm(false)}
                  onSuccess={() => { setShowAdjForm(false); showToast("Adjusting entry posted."); }}
                />
              ) : (
                <div className="p-2.5 flex flex-col gap-1.5 max-h-52 overflow-y-auto">
                  {status === "open" && (
                    <>
                      <ActionBtn icon={<CheckCircle size={14} />} label="Run Pre-Close Checks" desc="Validate data integrity before closing" loading={acting} onClick={runValidation} />
                      {canClose && <ActionBtn icon={<LockOpen size={14} />} label="Soft Close Period" desc="Block writes, keep data reviewable" loading={acting} onClick={() => transition("closed")} />}
                    </>
                  )}
                  {status === "closed" && (
                    <>
                      {canReopen && <ActionBtn icon={<LockOpen size={14} />} label="Re-open Period" desc="Allow data entry again" loading={acting} onClick={() => transition("open")} />}
                      <ActionBtn icon={<Eye size={14} />} label="View Transition History" desc="Audit all status changes" onClick={() => setTab("history")} />
                      {canLock && (
                        <>
                          <div className="h-px bg-border/50 my-0.5" />
                          <ActionBtn icon={<Lock size={14} />} label="Hard Lock Period" desc="Freeze permanently · irreversible" danger loading={acting} onClick={() => transition("locked")} />
                        </>
                      )}
                    </>
                  )}
                  {status === "locked" && (
                    <>
                      <ActionBtn icon={<Eye size={14} />} label="View Frozen Snapshot" desc="Figures captured at lock time" onClick={() => setTab("history")} />
                      <ActionBtn icon={<SlidersHorizontal size={14} />} label="Post Adjusting Entry" desc="Correction in current open period" onClick={() => setShowAdjForm(true)} />
                      <ActionBtn icon={<Lock size={14} />} label="Re-open Period" desc="Not permitted on hard-locked periods" disabled onClick={() => {}} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* History tab */}
          {tab === "history" && (
            <div className="max-h-80 overflow-y-auto">
              <HistoryList entries={history} loading={histLoading} />
            </div>
          )}

          {/* Past periods tab */}
          {tab === "past" && (
            <div className="p-2.5 max-h-80 overflow-y-auto">
              {pastPeriods.length === 0 ? (
                <p className="py-6 text-center text-[11px] text-muted-foreground">No past periods found.</p>
              ) : pastPeriods.map((row, i) => (
                <div key={row.period}
                  className="psc-row flex items-center justify-between px-3 py-2 rounded-xl hover:bg-muted/50 transition-colors group"
                  style={{ animationDelay: `${i * 35}ms` }}>
                  <div>
                    <p className="text-[12px] font-semibold text-foreground">{fmtShortPeriod(row.period)}</p>
                    <p className="text-[10px] text-muted-foreground">{STATUS[row.status].desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={row.status} />
                    <button onClick={() => openDrill(row)}
                      className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors opacity-0 group-hover:opacity-100">
                      <Clock size={10} /> Log
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border/50 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50 font-mono">STARK ERP · Period Control</span>
            <span className={`text-[10px] font-semibold ${STATUS[status].pill.split(" ")[1]}`}>
              {STATUS[status].label.toUpperCase()}
            </span>
          </div>
        </>
      )}
    </div>,
    document.body
  ) : null;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{css}</style>

      {/* Toast portal */}
      {toast && createPortal(
        <div
          className={`psc-toast fixed flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-semibold shadow-xl border whitespace-nowrap
            ${toast.type === "ok" ? "bg-card border-emerald-500/30 text-emerald-400" : "bg-card border-red-500/30 text-red-400"}`}
          style={{ top: panelPos.top - 48, left: panelPos.left, zIndex: 99999 }}
        >
          {toast.type === "ok" ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
          {toast.msg}
        </div>,
        document.body
      )}

      {/* Badge trigger */}
      <button
        ref={trigRef}
        onClick={() => { setOpen((o) => !o); setDrillPeriod(null); setShowAdjForm(false); }}
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all duration-150 select-none hover:opacity-90 active:scale-95 ${STATUS[status].badge}`}
      >
        <span className="relative flex h-2 w-2">
          {status === "open" && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />}
          <span className={`relative inline-flex rounded-full h-2 w-2 ${STATUS[status].dot}`} />
        </span>
        <span>{fmtShortPeriod(workingPeriod)}</span>
        <span className="opacity-50">·</span>
        <span>{STATUS[status].label}</span>
        {!isCurrentPeriod && <AlertTriangle size={10} className="text-amber-400" />}
        <ChevronDown size={11} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {panelContent}
    </>
  );
}