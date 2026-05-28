import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseApiOptions {
  /** Skip the initial fetch (and any refetching). State stays idle. */
  skip?: boolean;
  /** Re-fetch on this interval (ms). Paused when the tab is hidden. */
  refetchInterval?: number;
  /** Re-fetch when any of these values change (shallow compared via JSON). */
  deps?: unknown[];
}

// ─── useApi ──────────────────────────────────────────────────────────────────

export function useApi<T>(
  fetchFn: () => Promise<T>,
  options: UseApiOptions = {}
): UseApiState<T> & { refetch: () => Promise<void> } {
  const { skip = false, refetchInterval, deps } = options;

  // Start idle (not loading) when skip=true so consumers don't spin forever.
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: !skip,
    error: null,
  });

  // Always call the latest fetchFn without it being a dep of fetchData.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  // Stable fetch function — identity never changes, safe to put in deps.
  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await fetchFnRef.current();
      setState({ data: result, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : 'An error occurred',
      });
    }
  }, []); // intentionally empty — fetchFnRef is stable

  // Stable key for dep comparison — avoids array identity false-positives.
  const depsKey = JSON.stringify(deps ?? []);

  // Initial fetch + re-fetch on dep/skip changes.
  useEffect(() => {
    if (skip) {
      setState((prev) =>
        prev.loading ? { ...prev, loading: false } : prev
      );
      return;
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, skip, depsKey]);

  // Polling interval — paused when tab is hidden.
  useEffect(() => {
    if (!refetchInterval || skip) return;

    const tick = () => {
      if (document.visibilityState !== 'hidden') fetchData();
    };

    const id = setInterval(tick, refetchInterval);

    // Also re-fetch immediately when the tab becomes visible again
    // so data isn't stale after a long backgrounded period.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchData();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchData, refetchInterval, skip]);

  return { ...state, refetch: fetchData };
}

// ─── useApiMutation ───────────────────────────────────────────────────────────

export function useApiMutation<T, R = void>(
  mutationFn: (data: T) => Promise<R>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same pattern as fetchFnRef — keeps mutate identity stable even if
  // the caller passes a new inline function on every render.
  const mutationFnRef = useRef(mutationFn);
  mutationFnRef.current = mutationFn;

  const mutate = useCallback(async (data: T): Promise<R | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutationFnRef.current(data);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      return null;
    } finally {
      setLoading(false);
    }
  }, []); // intentionally empty — mutationFnRef is stable

  return { mutate, loading, error };
}