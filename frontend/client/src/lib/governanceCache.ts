// Shared between Procurement and Governance so Procurement doesn't have to
// import the whole Governance page just to invalidate its cache.

export const PROCUREMENT_PO_EVENT = "procurement:po-created";

// Short-lived, in-memory cache. Scoped by key to the signed-in user; cleared on full reload.
const GOV_CACHE_MS = 60_000;
const governanceCache = new Map<string, { value: unknown; savedAt: number }>();

export function cachedGovernance<T>(key: string): T | undefined {
  const entry = governanceCache.get(key);
  if (!entry || Date.now() - entry.savedAt > GOV_CACHE_MS) return undefined;
  return entry.value as T;
}

export function saveGovernance<T>(key: string, value: T): void {
  governanceCache.set(key, { value, savedAt: Date.now() });
}

export function invalidateGovernanceCache(): void {
  governanceCache.clear();
}

// A PO created elsewhere invalidates everything, even while the Governance page is unmounted.
if (typeof window !== "undefined") {
  window.addEventListener(PROCUREMENT_PO_EVENT, invalidateGovernanceCache);
}