/**
 * SystemLogsTab
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
  Activity, AlertCircle, AlertTriangle, ChevronDown, ChevronRight,
  CheckCircle2, Info, Loader2, RefreshCw, Search, XCircle,
} from "lucide-react";
import { formatDateTime, today } from "@/lib/format";
import { apiCall, getSystemLogs, type SystemLogRow } from "@/lib/api";
// ─── Types ────────────────────────────────────────────────────────────────────



// ─── Constants ────────────────────────────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2 rounded-md border border-input bg-background text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground";

const ACTION_OPTIONS = [
  "All Actions",
  "created", "updated", "deleted",
  "approved", "rejected",
  "login", "logout",
  "ADJUSTMENT_APPROVED", "ADJUSTMENT_REJECTED",
  "CREATE", "UPDATE", "DELETE",
];

const LEVEL_CONFIG: Record<string, { icon: ReactNode; badge: string; dot: string }> = {
  info:    { icon: <Info className="w-3.5 h-3.5" />,          badge: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",       dot: "bg-blue-500"   },
  warning: { icon: <AlertTriangle className="w-3.5 h-3.5" />, badge: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800", dot: "bg-amber-500"  },
  error:   { icon: <XCircle className="w-3.5 h-3.5" />,       badge: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",             dot: "bg-red-500"    },
  debug:   { icon: <Activity className="w-3.5 h-3.5" />,      badge: "bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700", dot: "bg-slate-400"  },
};

const ACTION_BADGE: Record<string, string> = {
  created:              "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  updated:              "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  deleted:              "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  approved:             "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  rejected:             "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  ADJUSTMENT_APPROVED:  "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  ADJUSTMENT_REJECTED:  "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  CREATE:               "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  UPDATE:               "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  DELETE:               "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
};

function actionBadgeClass(action: string) {
  return ACTION_BADGE[action] ?? "bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400";
}

// ─── Payload diff viewer ──────────────────────────────────────────────────────

function PayloadDiff({ payload }: { payload: Record<string, unknown> }) {
  const changes  = payload.changes  as Record<string, unknown> | undefined;
  const original = payload.original as Record<string, unknown> | undefined;

  // If we have structured changes/original, render a nice diff
  if (changes && original) {
    const keys = Array.from(new Set([...Object.keys(changes), ...Object.keys(original)]));
    return (
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Changes:</p>
          <ul className="space-y-1">
            {keys.filter(k => k in changes).map(k => (
              <li key={k} className="text-xs">
                <span className="text-muted-foreground">{k}: </span>
                <span className="font-semibold text-foreground">{String(changes[k])}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Original:</p>
          <ul className="space-y-1">
            {keys.filter(k => k in (original ?? {})).map(k => (
              <li key={k} className="text-xs">
                <span className="text-muted-foreground">{k}: </span>
                <span className="font-semibold text-muted-foreground line-through">{String((original ?? {})[k])}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // Fallback: flat key/value display
  return (
    <div className="mt-3 rounded-xl border border-border bg-background p-4">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Details:</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {Object.entries(payload).map(([k, v]) => (
          <div key={k} className="flex items-start gap-1.5 text-xs">
            <span className="text-muted-foreground shrink-0">{k}:</span>
            <span className="font-semibold text-foreground break-all">{JSON.stringify(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── User Avatar ──────────────────────────────────────────────────────────────

function UserAvatar({ name, avatar }: { name: string | null; avatar: string | null }) {
  if (avatar) {
    return <img src={avatar} alt={name ?? "user"} className="w-8 h-8 rounded-full object-cover border border-border" />;
  }
  const initials = (name ?? "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  // Deterministic color from name
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-violet-500",
    "bg-amber-500", "bg-teal-500", "bg-rose-500", "bg-indigo-500",
  ];
  const colorIdx = (name ?? "").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length;
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 ${colors[colorIdx]}`}>
      {initials}
    </div>
  );
}

// ─── Single log row ───────────────────────────────────────────────────────────

function LogRow({ log }: { log: SystemLogRow }) {
  const [expanded, setExpanded] = useState(false);
  const lvl = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
  const hasPayload = log.payload && Object.keys(log.payload).length > 0;

  // Human-readable description
  const description = log.entity_type
    ? `${capitalize(log.action)} ${capitalize(log.entity_type)}`
    : capitalize(log.action);

  const dt      = new Date(log.created_at);
  const dateStr = dt.toLocaleDateString("en-GB");
  const timeStr = dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <>
      {/* Main row */}
      <tr className={`border-b border-border transition-colors ${expanded ? "bg-secondary/20" : "hover:bg-secondary/30"}`}>

        {/* Action badge */}
        <td className="px-4 py-3 whitespace-nowrap">
          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-semibold border ${actionBadgeClass(log.action)}`}>
            {log.action}
          </span>
        </td>

        {/* Date & time */}
        <td className="px-4 py-3 whitespace-nowrap">
          <p className="text-sm font-medium text-foreground">{dateStr}</p>
          <p className="text-xs text-muted-foreground">{timeStr}</p>
        </td>

        {/* User */}
        <td className="px-4 py-3 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <UserAvatar name={log.user_name} avatar={log.user_avatar} />
            <span className="text-sm font-medium text-foreground">{log.user_name ?? "System"}</span>
          </div>
        </td>

        {/* Description */}
        <td className="px-4 py-3">
          <p className="text-sm text-foreground">
            {description}
            {log.entity_type && (
              <span className="text-muted-foreground"> {log.entity_type}</span>
            )}
          </p>
          {log.branch_name && (
            <p className="text-xs text-muted-foreground mt-0.5">{log.branch_name}</p>
          )}
        </td>

        {/* Details toggle */}
        <td className="px-4 py-3 text-right">
          {hasPayload ? (
            <button
              onClick={() => setExpanded(s => !s)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${
                expanded
                  ? "bg-foreground text-background border-foreground"
                  : "bg-secondary border-border text-muted-foreground hover:bg-secondary/70"
              }`}
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <div className="w-8 h-8" />
          )}
        </td>
      </tr>

      {/* Expanded payload row */}
      {expanded && hasPayload && (
        <tr className="bg-secondary/10 border-b border-border">
          <td colSpan={5} className="px-6 pb-4">
            <PayloadDiff payload={log.payload!} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function LogSkeleton() {
  return (
    <>
      {[1,2,3,4,5].map(i => (
        <tr key={i} className="border-b border-border">
          <td className="px-4 py-3"><div className="h-6 w-20 animate-pulse rounded-md bg-secondary/60" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-secondary/60" /></td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 animate-pulse rounded-full bg-secondary/60" />
              <div className="h-4 w-20 animate-pulse rounded bg-secondary/60" />
            </div>
          </td>
          <td className="px-4 py-3"><div className="h-4 w-40 animate-pulse rounded bg-secondary/60" /></td>
          <td className="px-4 py-3 text-right"><div className="w-8 h-8 ml-auto animate-pulse rounded-lg bg-secondary/60" /></td>
        </tr>
      ))}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Filters = {
  date: string;
  action: string;
  user: string;
};

const PAGE_SIZE = 50;

export function SystemLogsTab({ branchId }: { branchId: number }) {
  const [logs, setLogs]         = useState<SystemLogRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [total, setTotal]       = useState(0);
  const [offset, setOffset]     = useState(0);
  const [filters, setFilters]   = useState<Filters>({ date: today(), action: "", user: "" });
  const [pending, setPending]   = useState<Filters>({ date: today(), action: "", user: "" });

  const fetchLogs = useCallback(async (f: Filters, off: number) => {
    setLoading(true);
    setError("");
    try {
      const data = await getSystemLogs({
      date:      f.date || undefined,
      action:    f.action && f.action !== "All Actions" ? f.action : undefined,
      user:      f.user || undefined,
      branch_id: branchId,
      limit:     PAGE_SIZE,
      offset:    off,
    });
    setLogs(data.rows);
    setTotal(data.total);
    } catch {
      setError("Failed to load system logs.");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  // Initial + filter-triggered fetch
  useEffect(() => {
    fetchLogs(filters, 0);
    setOffset(0);
  }, [filters, fetchLogs]);

  function applyFilters() {
    setFilters({ ...pending });
  }

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

  // Stats for summary strip
  const counts = logs.reduce((acc, l) => {
    acc[l.level] = (acc[l.level] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">System Logs</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audit trail of all data actions — {total.toLocaleString()} total records
          </p>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={() => fetchLogs(filters, offset)}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Summary strip ── */}
      {logs.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {(["info", "warning", "error", "debug"] as const).map(lvl => {
            const cfg = LEVEL_CONFIG[lvl];
            return (
              <Card key={lvl} className="p-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{lvl}</p>
                  <p className="text-lg font-bold text-foreground">{counts[lvl] ?? 0}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Filters — matches screenshot layout exactly ── */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">

          {/* Date */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
            <input
              type="date"
              className={inputClass}
              value={pending.date}
              onChange={e => setPending(p => ({ ...p, date: e.target.value }))}
            />
          </div>

          {/* Action dropdown */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
            <div className="relative">
              <select
                className={`${inputClass} appearance-none pr-8`}
                value={pending.action || "All Actions"}
                onChange={e => setPending(p => ({ ...p, action: e.target.value === "All Actions" ? "" : e.target.value }))}
              >
                {ACTION_OPTIONS.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* User search */}
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">User</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search User"
                className={`${inputClass} pr-8`}
                value={pending.user}
                onChange={e => setPending(p => ({ ...p, user: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && applyFilters()}
              />
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Filter button — matches screenshot green button */}
          <Button
            onClick={applyFilters}
            disabled={loading}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-transparent h-9 px-5"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Search className="w-4 h-4" />
            }
            Filter
          </Button>

          {/* Reset — only show when filters are non-default */}
          {(filters.action || filters.user) && (
            <Button variant="outline" size="sm" onClick={resetFilters} className="h-9 gap-1.5 text-muted-foreground">
              <XCircle className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
      </Card>

      {/* ── Error ── */}
      {error && (
        <Card className="p-4 border-red-200 dark:border-red-700/40 bg-red-50 dark:bg-red-900/20">
          <p className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4" /> {error}
          </p>
        </Card>
      )}

      {/* ── Table ── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <LogSkeleton />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <Activity className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-sm font-medium text-muted-foreground">No log entries found</p>
                    <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters or date range</p>
                  </td>
                </tr>
              ) : (
                logs.map(log => <LogRow key={log.id} log={log} />)
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
            <p className="text-xs text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()} entries
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => goPage(-1)}
                disabled={offset === 0 || loading}
              >
                Previous
              </Button>
              <span className="text-xs font-medium text-foreground px-2">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline" size="sm"
                onClick={() => goPage(1)}
                disabled={offset + PAGE_SIZE >= total || loading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}