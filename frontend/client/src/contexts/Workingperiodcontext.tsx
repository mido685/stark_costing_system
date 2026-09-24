import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

import { apiCall } from "@/lib/api";

type PeriodStatus = "open" | "closed" | "locked";

interface WorkingPeriodContextValue {
  workingPeriod: string;
  workingPeriodLabel: string;
  isCurrentPeriod: boolean;
  setWorkingPeriod: (period: string) => void;
  resetToCurrentPeriod: () => void;
  periodStatus: PeriodStatus | null;
  refreshPeriodStatus: () => Promise<PeriodStatus>;
}

const SESSION_KEY = "workingPeriod";

function currentPeriod(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}`;
}

function fmtPeriod(period: string): string {
  const [year, month] = period.split("-");

  return new Date(
    Number(year),
    Number(month) - 1
  ).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
}

const WorkingPeriodContext =
  createContext<WorkingPeriodContextValue | null>(null);

export function WorkingPeriodProvider({
  children,
}: {
  children: ReactNode;
}) {
  const today = currentPeriod();

  const [workingPeriod, setWorkingPeriodState] =
    useState<string>(() => {
      try {
        return sessionStorage.getItem(SESSION_KEY) ?? today;
      } catch {
        return today;
      }
    });

  const [periodStatus, setPeriodStatus] =
    useState<PeriodStatus | null>(null);

  // Prevent an older request from overwriting a newer result.
  const requestId = useRef(0);

  const setWorkingPeriod = useCallback((period: string) => {
    requestId.current += 1;
    setPeriodStatus(null);
    setWorkingPeriodState(period);

    try {
      sessionStorage.setItem(SESSION_KEY, period);
    } catch {
      // Continue without session persistence.
    }
  }, []);

  const resetToCurrentPeriod = useCallback(() => {
    setWorkingPeriod(currentPeriod());
  }, [setWorkingPeriod]);

  const refreshPeriodStatus = useCallback(async () => {
    const id = ++requestId.current;

    const response = await apiCall<unknown>(
      `/api/period/status?period=${encodeURIComponent(
        workingPeriod
      )}`
    );

    const data =
      response &&
      typeof response === "object" &&
      "data" in response
        ? response.data
        : response;

    const status = (
      data as { status?: unknown } | null
    )?.status;

    if (
      status !== "open" &&
      status !== "closed" &&
      status !== "locked"
    ) {
      throw new Error("Invalid period status response");
    }

    if (id === requestId.current) {
      setPeriodStatus(status);
    }

    return status;
  }, [workingPeriod]);

  useEffect(() => {
    setPeriodStatus(null);

    refreshPeriodStatus().catch((error) => {
      console.error(
        "Failed to refresh period status:",
        error
      );
    });
  }, [refreshPeriodStatus]);

  const value: WorkingPeriodContextValue = {
    workingPeriod,
    workingPeriodLabel: fmtPeriod(workingPeriod),
    isCurrentPeriod: workingPeriod === today,
    setWorkingPeriod,
    resetToCurrentPeriod,
    periodStatus,
    refreshPeriodStatus,
  };

  return (
    <WorkingPeriodContext.Provider value={value}>
      {children}
    </WorkingPeriodContext.Provider>
  );
}

export function useWorkingPeriod(): WorkingPeriodContextValue {
  const context = useContext(WorkingPeriodContext);

  if (!context) {
    throw new Error(
      "useWorkingPeriod must be used inside WorkingPeriodProvider"
    );
  }

  return context;
}