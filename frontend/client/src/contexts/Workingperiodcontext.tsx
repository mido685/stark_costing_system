/**
 * WorkingPeriodContext
 *
 * Global working period — the master control for the entire system.
 * All period-sensitive pages read from this context to filter their data.
 *
 * Usage:
 *   1. Wrap your app: <WorkingPeriodProvider>...</WorkingPeriodProvider>
 *   2. In any page:   const { workingPeriod } = useWorkingPeriod();
 *   3. Pass to API:   apiCall(`/api/transactions?period=${workingPeriod}`)
 *
 * Persists to sessionStorage so refresh doesn't lose the selected period.
 */

import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from "react";

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

const SESSION_KEY = "workingPeriod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkingPeriodContextValue {
  /** The currently selected working period, e.g. "2026-05" */
  workingPeriod: string;

  /** Human-readable label, e.g. "May 2026" */
  workingPeriodLabel: string;

  /** True if the selected period is the current calendar month */
  isCurrentPeriod: boolean;

  /** Change the working period — updates context + sessionStorage */
  setWorkingPeriod: (period: string) => void;

  /** Reset back to today's month */
  resetToCurrentPeriod: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WorkingPeriodContext = createContext<WorkingPeriodContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WorkingPeriodProvider({ children }: { children: ReactNode }) {
  const today = currentPeriod();

  const [workingPeriod, setWorkingPeriodState] = useState<string>(() => {
    // Restore from sessionStorage on mount
    try {
      return sessionStorage.getItem(SESSION_KEY) ?? today;
    } catch {
      return today;
    }
  });

  const setWorkingPeriod = useCallback((period: string) => {
    setWorkingPeriodState(period);
    try {
      sessionStorage.setItem(SESSION_KEY, period);
    } catch { /* sessionStorage unavailable — continue without persistence */ }
  }, []);

  const resetToCurrentPeriod = useCallback(() => {
    setWorkingPeriod(today);
  }, [today, setWorkingPeriod]);

  // If the calendar month rolls over while the app is open,
  // and the user was already on "current", follow it forward.
  useEffect(() => {
    const stored = (() => {
      try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
    })();
    if (!stored) setWorkingPeriod(today);
  }, [today, setWorkingPeriod]);

  const value: WorkingPeriodContextValue = {
    workingPeriod,
    workingPeriodLabel:  fmtPeriod(workingPeriod),
    isCurrentPeriod:     workingPeriod === today,
    setWorkingPeriod,
    resetToCurrentPeriod,
  };

  return (
    <WorkingPeriodContext.Provider value={value}>
      {children}
    </WorkingPeriodContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkingPeriod(): WorkingPeriodContextValue {
  const ctx = useContext(WorkingPeriodContext);
  if (!ctx) throw new Error("useWorkingPeriod must be used inside <WorkingPeriodProvider>");
  return ctx;
}