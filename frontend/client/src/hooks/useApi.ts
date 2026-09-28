import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Shared in-memory cache. Lives until a full page reload.
const API_CACHE_MS = 5 * 60_000;
const apiCache = new Map<string, { data: unknown; savedAt: number }>();

function readApiCache<T>(key?: string): T | undefined {
  if (!key) return undefined;
  const hit = apiCache.get(key);
  if (!hit || Date.now() - hit.savedAt > API_CACHE_MS) return undefined;
  return hit.data as T;
}

/** Clear everything, or only keys starting with `prefix` (e.g. "branches:"). */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) { apiCache.clear(); return; }
  for (const k of Array.from(apiCache.keys())) if (k.startsWith(prefix)) apiCache.delete(k);
}

interface UseApiOptions {
  /**
   * Show the last result instantly on remount, then refresh in the background.
   * Include the user id (and any deps) in the key, e.g. `branches:${userId}`.
   */
  cacheKey?: string;
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
  const { skip = false, refetchInterval, deps, cacheKey } = options;

  // Start idle (not loading) when skip=true so consumers don't spin forever.
  // With a warm cache, start with data and no spinner.
  const hydratedRef = useRef(false);
  const [state, setState] = useState<UseApiState<T>>(() => {
    const cached = skip ? undefined : readApiCache<T>(cacheKey);
    if (cached !== undefined) hydratedRef.current = true;
    return { data: cached ?? null, loading: !skip && cached === undefined, error: null };
  });
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  // Always call the latest fetchFn without it being a dep of fetchData.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const reqIdRef = useRef(0);

  // Stable fetch function — identity never changes, safe to put in deps.
  const fetchData = useCallback(async () => {
  const myId = ++reqIdRef.current;
  const quiet = hydratedRef.current; // first fetch after a cache hit: no spinner
  hydratedRef.current = false;
  if (!quiet) setState((prev) => ({ ...prev, loading: true, error: null }));
  try {
    const result = await fetchFnRef.current();
    if (myId !== reqIdRef.current) return; // a newer request replaced this one
    if (cacheKeyRef.current) apiCache.set(cacheKeyRef.current, { data: result, savedAt: Date.now() });
    setState({ data: result, loading: false, error: null });
  } catch (err) {
    if (myId !== reqIdRef.current) return;
    if (cacheKeyRef.current) apiCache.delete(cacheKeyRef.current);
    setState({
      data: null,
      loading: false,
      error: err instanceof Error ? err.message : 'An error occurred',
    });
  }
}, []);

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