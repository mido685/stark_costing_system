import { useCallback, useEffect, useRef, useState } from "react";

// Memory-only cache: no authenticated data is written to localStorage.
type Entry = { value: unknown; timestamp: number };
const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<unknown>>();

export function readCachedQuery<T>(key: string): { value: T; timestamp: number } | undefined {
  return cache.get(key) as { value: T; timestamp: number } | undefined;
}
export function writeCachedQuery<T>(key: string, value: T): void {
  cache.set(key, { value, timestamp: Date.now() });
  listeners.get(key)?.forEach(fn => fn());
}
export function invalidateCachedQueries(prefix: string): void {
  for (const key of new Set([...cache.keys(), ...listeners.keys()])) {
    if (key === prefix || key.startsWith(prefix + ":")) {
      cache.delete(key);
      inflight.delete(key);
      listeners.get(key)?.forEach(fn => fn());
    }
  }
}
export function clearCachedQueries(): void {
  cache.clear();
  inflight.clear();
  for (const subscribers of listeners.values()) subscribers.forEach(fn => fn());
}
function subscribe(key: string, fn: () => void): () => void {
  let group = listeners.get(key);
  if (!group) { group = new Set(); listeners.set(key, group); }
  group.add(fn);
  return () => { group!.delete(fn); if (!group!.size) listeners.delete(key); };
}
async function request<T>(key: string, fetcher: () => Promise<T>, force: boolean): Promise<T> {
  if (!force && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const job = fetcher().then(value => {
    // An invalidated or superseded request must not repopulate the cache.
    if (inflight.get(key) === job) writeCachedQuery(key, value);
    return value;
  }).finally(() => { if (inflight.get(key) === job) inflight.delete(key); });
  inflight.set(key, job);
  return job;
}
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>, ttlMs = 60_000) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [data, setData] = useState<T | undefined>(() => readCachedQuery<T>(key)?.value);
  const [loading, setLoading] = useState(() => !readCachedQuery(key));
  const [error, setError] = useState<string | null>(null);
  const currentKey = useRef(key);
  const generation = useRef(0);
  const run = useCallback(async (requestedKey: string, force = false) => {
    const seq = ++generation.current;
    const cached = readCachedQuery<T>(requestedKey);
    if (!cached) setLoading(true);
    setError(null);
    try {
      const result = await request(requestedKey, () => fetcherRef.current(), force);
      if (currentKey.current === requestedKey && generation.current === seq) {
        setData(result);
        setLoading(false);
      }
      return result;
    } catch (e) {
      if (currentKey.current === requestedKey && generation.current === seq) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
      throw e;
    }
  }, []);
  useEffect(() => {
    currentKey.current = key;
    ++generation.current;
    const cached = readCachedQuery<T>(key);
    setData(cached?.value);
    setLoading(!cached);
    setError(null);
    const refresh = () => {
      const next = readCachedQuery<T>(key);
      if (next) { setData(next.value); setLoading(false); }
      else void run(key).catch(() => {});
    };
    const unsubscribe = subscribe(key, refresh);
    if (!cached || Date.now() - cached.timestamp >= ttlMs) void run(key).catch(() => {});
    return () => { unsubscribe(); ++generation.current; };
  }, [key, ttlMs, run]);
  const refetch = useCallback(() => run(key, true), [key, run]);
  return { data, loading, error, refetch };
}
