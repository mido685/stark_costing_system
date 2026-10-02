import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Shared in-memory cache. Lives until a full page reload.
export const CACHE_TTL = {
  branches: 30 * 60_000,
  suppliers: 10 * 60_000,
  ingredients: 10 * 60_000,
  purchases: 60_000,
  transfers: 60_000,
  inventory: 30_000,
} as const;
const apiCache = new Map<string, { data: unknown; savedAt: number }>();

function readApiCache<T>(
  key?: string,
  cacheTime = 5 * 60_000
): T | undefined {
  if (!key) return undefined;

  const hit = apiCache.get(key);

  if (!hit) return undefined;

  const age = Date.now() - hit.savedAt;

  if (age > cacheTime) {
    apiCache.delete(key);
    return undefined;
  }

  return hit.data as T;
}

/** Clear everything, or only keys starting with `prefix` (e.g. "branches:"). */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) { apiCache.clear(); return; }
  for (const k of Array.from(apiCache.keys())) if (k.startsWith(prefix)) apiCache.delete(k);
}

interface UseApiOptions {
  cacheKey?: string;
  cacheTime?: number;
  skip?: boolean;
  refetchInterval?: number;
  deps?: unknown[];
}
// ─── useApi ──────────────────────────────────────────────────────────────────

export function useApi<T>(
  fetchFn: () => Promise<T>,
  options: UseApiOptions = {}
): UseApiState<T> & { refetch: () => Promise<void> } {
  const {
  skip = false,
  refetchInterval,
  deps,
  cacheKey,
  cacheTime = 5 * 60_000,
} = options;

  // Start idle (not loading) when skip=true so consumers don't spin forever.
  // With a warm cache, start with data and no spinner.
  
  const [state, setState] = useState<UseApiState<T>>(() => {
    const cached = skip
  ? undefined
  : readApiCache<T>(cacheKey, cacheTime);
    
    return { data: cached ?? null, loading: !skip && cached === undefined, error: null };
  });
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  // Always call the latest fetchFn without it being a dep of fetchData.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const reqIdRef = useRef(0);
  const activeRequestKeyRef = useRef(cacheKey);

  activeRequestKeyRef.current = cacheKey;

  // Stable fetch function — identity never changes, safe to put in deps.
  const fetchData = useCallback(async () => {
  const myId = ++reqIdRef.current;
  const requestCacheKey = cacheKeyRef.current;

  setState((prev) => ({
  ...prev,
  loading: true,
  error: null,
  }));
  try {
    const result = await fetchFnRef.current();
    if (
      myId !== reqIdRef.current ||
      requestCacheKey !== activeRequestKeyRef.current
    ) {
      return;
    }
    setState({ data: result, loading: false, error: null });
    if (requestCacheKey) {
  apiCache.set(requestCacheKey, {
    data: result,
    savedAt: Date.now(),
  });
}
  } catch (err) {
    if (
  myId !== reqIdRef.current ||
  requestCacheKey !== activeRequestKeyRef.current
) {
  return;
}
    if (requestCacheKey) {
  apiCache.delete(requestCacheKey);
  }
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
  return () => {
    reqIdRef.current++;
  };
}, []);

useEffect(() => {
  // Prevent an older request from updating this hook
  reqIdRef.current++;

  if (skip) {
    setState({
      data: null,
      loading: false,
      error: null,
    });
    return;
  }

  const cached = readApiCache<T>(cacheKey, cacheTime);

  if (cached !== undefined) {
    setState({
      data: cached,
      loading: false,
      error: null,
    });
    return;
  }

  // Don't display the previous company's or branch's data
  setState({
    data: null,
    loading: true,
    error: null,
  });

  fetchData();
}, [fetchData, skip, depsKey, cacheKey, cacheTime]);  // Polling interval — paused when tab is hidden.
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