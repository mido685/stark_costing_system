/**
 * SystemLogsTab — Enterprise edition (light/dark aware)
 * Drop this into your Finance page's tab list:
 *
 *   { key: "logs", label: t("finance.tab.logs"), icon: <Activity className="w-4 h-4" /> }
 *
 * Then render it in the tab body:
 *   {activeTab === "logs" && <SystemLogsTab branchId={branchId} />}
 *
 * API expected: GET /api/system-logs?date=YYYY-MM-DD&action=&user=&limit=50&offset=0
 * Returns: SystemLogRow[]
 */

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronLeft,
  Info, Loader2, RefreshCw, Search, XCircle, Hash, Clock, ShieldAlert,
} from "lucide-react";
import { formatDateTime, today } from "@/lib/format";
import { apiCall, getSystemLogs, type SystemLogRow } from "@/lib/api";

// ─── Design tokens ─────────────────────────────────────────────────────────

const ACCENT = {
  solid:  "bg-sky-500 hover:bg-sky-400 text-white",
  ring:   "focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500",
  text:   "text-sky-600 dark:text-sky-400",
  border: "border-sky-500/40",
};

const MONO = "font-mono tabular-nums";

const inputClass =
  "w-full px-2.5 py-1.5 rounded-md border border-black/10 dark:border-zinc-800 " +
  "bg-white dark:bg-zinc-950 text-[13px] text-gray-900 dark:text-zinc-100 " +
  `focus:outline-none ${ACCENT.ring} ` +
  "placeholder:text-gray-400 dark:placeholder:text-zinc-600 transition-colors";

const ACTION_OPTIONS = [
  "All Actions",
  "created", "updated", "deleted",
  "approved", "rejected",
  "login", "logout",
  "ADJUSTMENT_APPROVED", "ADJUSTMENT_REJECTED",
  "CREATE", "UPDATE", "DELETE",
];

const LEVEL_CONFIG: Record<string, { icon: ReactNode; rail: string; dot: string; text: string }> = {
  info:     { icon: <Info className="w-3.5 h-3.5" />,          rail: "bg-sky-400",  dot: "bg-sky-400",  text: "text-sky-600 dark:text-sky-300" },
  warning:  { icon: <AlertTriangle className="w-3.5 h-3.5" />, rail: "bg-amber-400", dot: "bg-amber-400", text: "text-amber-600 dark:text-amber-300" },
  error:    { icon: <AlertCircle className="w-3.5 h-3.5" />,   rail: "bg-rose-500",  dot: "bg-rose-500",  text: "text-rose-600 dark:text-rose-300" },
  critical: { icon: <ShieldAlert className="w-3.5 h-3.5" />,   rail: "bg-red-600",   dot: "bg-red-600",   text: "text-red-600 dark:text-red-400" },
};

const LEVEL_ORDER = ["info", "warning", "error", "critical"] as const;

const ACTION_DOT: Record<string, string> = {
  created: "bg-emerald-500", updated: "bg-amber-500", deleted: "bg-rose-500",
  approved: "bg-emerald-500", rejected: "bg-rose-500",
  ADJUSTMENT_APPROVED: "bg-emerald-500", ADJUSTMENT_REJECTED: "bg-rose-500",
  CREATE: "bg-emerald-500", UPDATE: "bg-amber-500", DELETE: "bg-rose-500",
};

function actionDot(action: string) {
  return ACTION_DOT[action] ?? "bg-gray-400 dark:bg-zinc-500";
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Severity cards ─────────────────────────────────────────────────────────

const SEVERITY_META: Record<string, { label: string; dot: string; ring: string }> = {
  info:     { label: "Info",     dot: "bg-sky-500",  ring: "ring-sky-500/10"   },
  warning:  { label: "Warning",  dot: "bg-amber-500", ring: "ring-amber-500/10" },
  error:    { label: "Error",    dot: "bg-rose-500",  ring: "ring-rose-500/10"  },
  critical: { label: "Critical", dot: "bg-red-600",   ring: "ring-red-600/10"   },
};

function SeverityCards({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {LEVEL_ORDER.map(lvl => {
        const meta = SEVERITY_META[lvl];
        const count = counts[lvl] ?? 0;
        return (
          <div
            key={lvl}
            className="bg-white dark:bg-[#1c1c1e] border border-black/8 dark:border-white/8 rounded-2xl px-5 py-4"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              <span className="text-[11px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                {meta.label}
              </span>
            </div>
            <p className="text-3xl font-bold tabular-nums leading-none text-gray-900 dark:text-white">
              {count}
            </p>
          </div>
        );
      })}
    </div>
  );
}
// ─── Payload diff viewer ────────────────────────────────────────────────────

function PayloadDiff({ payload }: { payload: Record<string, unknown> }) {
  const changes  = payload.changes  as Record<string, unknown> | undefined;
  const original = payload.original as Record<string, unknown> | undefined;

  if (changes && original) {
    const keys = Array.from(new Set([...Object.keys(changes), ...Object.keys(original)]));
    return (
      <div className="grid grid-cols-2 gap-2.5 mt-2">
        <div className="rounded-md border border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 p-3">
          <p className="text-[10px] font-semibold text-rose-600/90 dark:text-rose-400/80 uppercase tracking-wider mb-1.5">− before</p>
          <ul className="space-y-1">
            {keys.filter(k => k in (original ?? {})).map(k => (
              <li key={k} className={`text-xs ${MONO} text-rose-700/90 dark:text-rose-300/80`}>
                <span className="opacity-60">{k}:</span> {String((original ?? {})[k])}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 p-3">
          <p className="text-[10px] font-semibold text-emerald-600/90 dark:text-emerald-400/80 uppercase tracking-wider mb-1.5">+ after</p>
          <ul className="space-y-1">
            {keys.filter(k => k in changes).map(k => (
              <li key={k} className={`text-xs ${MONO} text-emerald-700/90 dark:text-emerald-300/80`}>
                <span className="opacity-60">{k}:</span> {String(changes[k])}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-black/8 dark:border-zinc-800 bg-black/[0.02] dark:bg-zinc-900/60 p-3">
      <p className="text-[10px] font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">payload</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {Object.entries(payload).map(([k, v]) => (
          <div key={k} className={`flex items-start gap-1.5 text-xs ${MONO}`}>
            <span className="text-gray-500 dark:text-zinc-500 shrink-0">{k}:</span>
            <span className="text-gray-700 dark:text-zinc-300 break-all">{JSON.stringify(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── User identity ──────────────────────────────────────────────────────────

function UserAvatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) {
    return <img src={avatar} alt={name ?? "user"} className="w-6 h-6 rounded-full object-cover border border-black/10 dark:border-zinc-800" />;
  }
  const initials = (name ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const colors = ["bg-sky-600", "bg-violet-600", "bg-teal-600", "bg-indigo-600", "bg-rose-600"];
  const colorIdx = (name ?? "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0 ${colors[colorIdx]}`}>
      {initials}
    </div>
  );
}

// ─── Single log row ─────────────────────────────────────────────────────────

function LogRow({ log }: { log: SystemLogRow }) {
  const [expanded, setExpanded] = useState(false);
  const lvl = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
  const hasPayload = log.payload && Object.keys(log.payload).length > 0;

  const description = log.entity_type
    ? `${capitalize(log.action)} ${capitalize(log.entity_type)}`
    : capitalize(log.action);

  const dt      = new Date(log.created_at);
  const dateStr = dt.toLocaleDateString("en-GB");
  const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <>
      <tr
        className={`group border-b border-black/5 dark:border-zinc-900 transition-colors cursor-pointer ${
          expanded ? "bg-black/[0.03] dark:bg-zinc-900/60" : "hover:bg-black/[0.02] dark:hover:bg-zinc-900/30"
        }`}
        onClick={() => hasPayload && setExpanded(s => !s)}
      >
        <td className="pl-0 pr-3 py-2.5 whitespace-nowrap">
          <div className="flex items-center">
            <span className={`inline-block w-[3px] h-5 rounded-full mr-3 ${lvl.rail}`} />
            <span className={lvl.text}>{lvl.icon}</span>
          </div>
        </td>

        <td className={`px-2 py-2.5 whitespace-nowrap text-xs text-gray-400 dark:text-zinc-600 ${MONO}`}>
          <span className="inline-flex items-center gap-1">
            <Hash className="w-3 h-3 opacity-50" />{log.id}
          </span>
        </td>

        <td className="px-3 py-2.5 whitespace-nowrap">
          <p className={`text-[13px] text-gray-700 dark:text-zinc-300 ${MONO}`}>{timeStr}</p>
          <p className={`text-[11px] text-gray-400 dark:text-zinc-600 ${MONO}`}>{dateStr}</p>
        </td>

        <td className="px-3 py-2.5 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-zinc-300">
            <span className={`w-1.5 h-1.5 rounded-full ${actionDot(log.action)}`} />
            <span className={MONO}>{log.action}</span>
          </span>
        </td>

        <td className="px-3 py-2.5 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <UserAvatar name={log.user_name} avatar={log.user_avatar} />
            <span className="text-[13px] font-medium text-gray-700 dark:text-zinc-300">{log.user_name ?? "System"}</span>
          </div>
        </td>

        <td className="px-3 py-2.5">
          <p className="text-[13px] text-gray-500 dark:text-zinc-400">
            {description}
            {log.branch_name && <span className="text-gray-400 dark:text-zinc-600"> · {log.branch_name}</span>}
          </p>
        </td>

        <td className="px-3 py-2.5 text-right">
          {hasPayload ? (
            <ChevronDown className={`w-4 h-4 ml-auto transition-all ${
              expanded ? `rotate-180 ${ACCENT.text}` : "text-gray-400 dark:text-zinc-600 group-hover:text-gray-700 dark:group-hover:text-zinc-300"
            }`} />
          ) : (
            <span className="block w-4 h-4" />
          )}
        </td>
      </tr>

      {expanded && hasPayload && (
        <tr className="bg-black/[0.02] dark:bg-zinc-900/40 border-b border-black/5 dark:border-zinc-900">
          <td colSpan={7} className="pl-8 pr-4 pb-3">
            <PayloadDiff payload={log.payload!} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Skeleton loader ────────────────────────────────────────────────────────

function LogSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <tr key={i} className="border-b border-black/5 dark:border-zinc-900">
          <td className="pl-0 pr-3 py-2.5"><div className="h-5 w-[3px] rounded-full bg-black/8 dark:bg-zinc-800 animate-pulse" /></td>
          <td className="px-2 py-2.5"><div className="h-3 w-8 rounded bg-black/8 dark:bg-zinc-800 animate-pulse" /></td>
          <td className="px-3 py-2.5"><div className="h-3 w-16 rounded bg-black/8 dark:bg-zinc-800 animate-pulse" /></td>
          <td className="px-3 py-2.5"><div className="h-3 w-20 rounded bg-black/8 dark:bg-zinc-800 animate-pulse" /></td>
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-black/8 dark:bg-zinc-800 animate-pulse" />
              <div className="h-3 w-20 rounded bg-black/8 dark:bg-zinc-800 animate-pulse" />
            </div>
          </td>
          <td className="px-3 py-2.5"><div className="h-3 w-40 rounded bg-black/8 dark:bg-zinc-800 animate-pulse" /></td>
          <td className="px-3 py-2.5 text-right"><div className="w-4 h-4 ml-auto rounded bg-black/8 dark:bg-zinc-800 animate-pulse" /></td>
        </tr>
      ))}
    </>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

type Filters = { date: string; action: string; user: string };
const PAGE_SIZE = 50;

export function SystemLogsTab({ branchId }: { branchId: number }) {
  const [logs, setLogs]       = useState<SystemLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [total, setTotal]     = useState(0);
  const [offset, setOffset]   = useState(0);
  const [filters, setFilters] = useState<Filters>({ date: today(), action: "", user: "" });
  const [pending, setPending] = useState<Filters>({ date: today(), action: "", user: "" });

  const fetchLogs = useCallback(async (f: Filters, off: number) => {
    setLoading(true);
    setError("");
    try {
      const data = await getSystemLogs({
        date:   f.date || undefined,
        action: f.action && f.action !== "All Actions" ? f.action : undefined,
        user:   f.user || undefined,
        limit:  PAGE_SIZE,
        offset: off,
      });
      setLogs(data.rows);
      setTotal(data.total);
    } catch (e: any) {
      if (e.status === 401) setError("Your session has expired. Please log in again.");
      else if (e.status === 403) setError("You don't have permission to view system logs.");
      else setError(e.message ?? "Failed to load system logs.");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchLogs(filters, 0);
    setOffset(0);
  }, [filters, fetchLogs]);

  function applyFilters() { setFilters({ ...pending }); }
  function resetFilters() {
    const def: Filters = { date: today(), action: "", user: "" };
    setPending(def);
    setFilters(def);
  }
  function goPage(dir: 1 | -1) {
    const next = offset + dir * PAGE_SIZE;
    setOffset(next);
    fetchLogs(filters, next);
  }

  const totalPages  = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const counts = logs.reduce((acc, l) => {
    acc[l.level] = (acc[l.level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const hasCustomFilters = Boolean(filters.action || filters.user);

  return (
    <div className="space-y-4 bg-white dark:bg-black p-5 rounded-xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white tracking-tight">System Logs</h2>
          <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">
            Audit trail of all data actions ·{" "}
            <span className={MONO}>{total.toLocaleString()}</span> records
          </p>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={() => fetchLogs(filters, offset)}
          disabled={loading}
          className="gap-1.5 h-8 border-black/10 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-gray-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-zinc-900 hover:text-gray-900 dark:hover:text-white"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Severity cards ── */}
      {logs.length > 0 && <SeverityCards counts={counts} />}

      {/* ── Filter toolbar ── */}
      <div className="rounded-lg border border-black/10 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-[150px]">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-zinc-500 mb-1">Date</label>
            <input
              type="date"
              className={inputClass}
              value={pending.date}
              onChange={e => setPending(p => ({ ...p, date: e.target.value }))}
            />
          </div>

          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-zinc-500 mb-1">Action</label>
            <div className="relative">
              <select
                className={`${inputClass} appearance-none pr-8`}
                value={pending.action || "All Actions"}
                onChange={e => setPending(p => ({ ...p, action: e.target.value === "All Actions" ? "" : e.target.value }))}
              >
                {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-600 pointer-events-none" />
            </div>
          </div>

          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-zinc-500 mb-1">User</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search user"
                className={`${inputClass} pr-8`}
                value={pending.user}
                onChange={e => setPending(p => ({ ...p, user: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && applyFilters()}
              />
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-600 pointer-events-none" />
            </div>
          </div>

          <Button
            onClick={applyFilters}
            disabled={loading}
            className={`gap-1.5 h-[34px] px-4 border-transparent ${ACCENT.solid}`}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Filter
          </Button>

          {hasCustomFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-[34px] gap-1.5 text-gray-500 dark:text-zinc-500 hover:text-gray-800 dark:hover:text-zinc-300 hover:bg-black/5 dark:hover:bg-zinc-900">
              <XCircle className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-md border border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" />
          <p className="text-[13px] text-rose-700 dark:text-rose-300">{error}</p>
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-lg border border-black/10 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-black/10 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
                <th className="pl-0 pr-3 py-2.5 w-8"></th>
                <th className="px-2 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wider">ID</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wider">
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />Time</span>
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wider">Action</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wider">User</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 dark:text-zinc-600 uppercase tracking-wider">Description</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LogSkeleton />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center">
                    <Activity className="w-8 h-8 text-gray-300 dark:text-zinc-800 mx-auto mb-2.5" />
                    <p className="text-[13px] font-medium text-gray-500 dark:text-zinc-500">No log entries found</p>
                    <p className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">Try adjusting your filters or date range</p>
                  </td>
                </tr>
              ) : (
                logs.map(log => <LogRow key={log.id} log={log} />)
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-black/10 dark:border-zinc-800 bg-black/[0.02] dark:bg-zinc-900/40">
            <p className="text-xs text-gray-500 dark:text-zinc-500">
              Showing <span className={MONO}>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)}</span> of{" "}
              <span className={MONO}>{total.toLocaleString()}</span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => goPage(-1)}
                disabled={offset === 0 || loading}
                className="h-7 gap-1 border-black/10 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-gray-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-zinc-900"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </Button>
              <span className={`text-xs font-medium text-gray-500 dark:text-zinc-400 px-1 ${MONO}`}>
                {currentPage} / {totalPages}
              </span>
              <Button
                variant="outline" size="sm"
                onClick={() => goPage(1)}
                disabled={offset + PAGE_SIZE >= total || loading}
                className="h-7 gap-1 border-black/10 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-gray-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-zinc-900"
              >
                Next <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}