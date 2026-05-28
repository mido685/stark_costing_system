import { useState, useEffect, useCallback } from "react";
import {
  getPendingApprovals,
  approveRequest,
  rejectRequest,
  type ApprovalRow,
} from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  currentUserId?: number;
}

export default function ApprovalQueue({ currentUserId }: Props) {
  const { t } = useLanguage();

  const [approvals,  setApprovals]  = useState<ApprovalRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [processing, setProcessing] = useState<Set<number>>(new Set());

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getPendingApprovals();
      setApprovals(rows);
    } catch {
      setError(t("approval.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  // ── Optimistic action ─────────────────────────────────────────────────────

  const handleAction = useCallback(
    async (approvalId: number, action: "approve" | "reject") => {
      const rowToRestore = approvals.find((a) => a.id === approvalId);
      if (!rowToRestore) return;

      // Optimistic remove + mark processing
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
      setProcessing((prev) => new Set(prev).add(approvalId));

      try {
        if (action === "approve") {
          await approveRequest(approvalId, currentUserId);
        } else {
          await rejectRequest(approvalId, currentUserId);
        }
      } catch (err) {
        // Rollback: restore row in its original sorted position
        setApprovals((prev) => {
          const restored = [...prev, rowToRestore];
          return restored.sort(
            (a, b) =>
              new Date(b.requested_at).getTime() -
              new Date(a.requested_at).getTime()
          );
        });
        // Use the localised action label in the error message
        const actionLabel = action === "approve"
          ? t("common.approve").toLowerCase()
          : t("common.reject").toLowerCase();
        const detail = err instanceof Error ? err.message : t("approval.actionFailed");
        setError(t("approval.actionError")
          .replace("{action}", actionLabel)
          .replace("{id}", String(approvalId))
          .replace("{detail}", detail));
      } finally {
        setProcessing((prev) => {
          const next = new Set(prev);
          next.delete(approvalId);
          return next;
        });
      }
    },
    [approvals, currentUserId, t]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          {t("approval.title")}
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
            {approvals.length} {t("approval.pending")}
          </span>
        </h2>
        <button
          onClick={fetchApprovals}
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          {t("common.refresh")}
        </button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 underline underline-offset-2 hover:no-underline"
            aria-label={t("common.dismiss")}
          >
            {t("common.dismiss")}
          </button>
        </div>
      )}

      {/* ── Empty state ── */}
      {approvals.length === 0 && !error && (
        <div className="rounded-lg border border-border bg-muted/20 py-12 text-center text-sm text-muted-foreground">
          {t("approval.empty")}
        </div>
      )}

      {/* ── Table ── */}
      {approvals.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table
            className="w-full text-sm"
            role="table"
            aria-label={t("approval.title")}
          >
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3">{t("approval.id")}</th>
                <th scope="col" className="px-4 py-3">{t("approval.type")}</th>
                <th scope="col" className="px-4 py-3">{t("approval.branch")}</th>
                <th scope="col" className="px-4 py-3">{t("approval.requestedBy")}</th>
                <th scope="col" className="px-4 py-3">{t("approval.requestedAt")}</th>
                <th scope="col" className="px-4 py-3 text-right">{t("approval.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {approvals.map((row) => {
                const isProcessing = processing.has(row.id);
                return (
                  <tr
                    key={row.id}
                    className={`text-foreground transition-colors hover:bg-muted/30 ${
                      isProcessing ? "opacity-50" : ""
                    }`}
                    aria-busy={isProcessing}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      #{row.id}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {row.entity_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.branch_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.requested_by_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(row.requested_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={isProcessing}
                          onClick={() => handleAction(row.id, "approve")}
                          aria-label={`${t("common.approve")} #${row.id}`}
                          className="rounded-md bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold
                                     text-emerald-600 dark:text-emerald-400
                                     hover:bg-emerald-500/20 transition-colors
                                     disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t("common.approve")}
                        </button>
                        <button
                          disabled={isProcessing}
                          onClick={() => handleAction(row.id, "reject")}
                          aria-label={`${t("common.reject")} #${row.id}`}
                          className="rounded-md bg-red-500/10 px-3 py-1.5 text-xs font-semibold
                                     text-red-600 dark:text-red-400
                                     hover:bg-red-500/20 transition-colors
                                     disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {t("common.reject")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}