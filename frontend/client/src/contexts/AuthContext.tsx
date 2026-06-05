import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { apiCall } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:            number;
  username:      string;
  display_name:  string;
  role:          string;
  company_id:    number | null;
  company_logo?: string | null;
}

interface AuthState {
  user:     AuthUser | null;
  token:    string | null;
  checking: boolean;
  login:    (user: AuthUser, token: string) => void;
  logout:   () => void;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  token: "token",
  user:  "auth_user",
} as const;

const AUTH_ROUTES = ["/auth/login", "/auth/register"];

// ─── Storage helpers ──────────────────────────────────────────────────────────

function storageSave(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private browsing */ }
}

function storageRemove(...keys: string[]): void {
  try { keys.forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

/** Parse + minimally validate a stored AuthUser. Returns null if invalid. */
function parseStoredUser(raw: string | null): AuthUser | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Guard against corrupt / outdated stored objects
    if (
      parsed &&
      typeof parsed.id         === "number" &&
      typeof parsed.username   === "string" &&
      typeof parsed.role       === "string" &&
      (typeof parsed.company_id === "number" || parsed.company_id === null)
    ) {
      return parsed as AuthUser;
    }
  } catch { /* corrupt JSON */ }
  return null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState>(null!);
AuthContext.displayName = "AuthContext";

export const useAuth = () => useContext(AuthContext);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,     setUser]     = useState<AuthUser | null>(null);
  const [token,    setToken]    = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // ── logout ────────────────────────────────────────────────────────────────
  // Defined first so logoutRef can reference it immediately.

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    storageRemove(KEYS.token, KEYS.user);
  }, []);

  // Stable ref — fetch interceptor always calls the latest logout without
  // being listed as a dependency (avoids re-patching window.fetch).
  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  // ── login ─────────────────────────────────────────────────────────────────

  const login = useCallback((authUser: AuthUser, authToken: string) => {
    setUser(authUser);
    setToken(authToken);
    storageSave(KEYS.token, authToken);
    storageSave(KEYS.user,  JSON.stringify(authUser));
  }, []);

  // ── Session restore on mount ──────────────────────────────────────────────

  useEffect(() => {
    try {
      const storedToken = localStorage.getItem(KEYS.token);
      const storedUser  = parseStoredUser(localStorage.getItem(KEYS.user));
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(storedUser);
      } else if (storedToken && !storedUser) {
        // Token present but user data corrupt — clear everything
        storageRemove(KEYS.token, KEYS.user);
      }
    } catch {
      storageRemove(KEYS.token, KEYS.user);
    } finally {
      setChecking(false);
    }
  }, []);

  // ── Re-validate token + refresh user profile ──────────────────────────────
  // Skips while `checking` is true to avoid racing with session restore.
  // Cancels the in-flight request if the effect re-runs (token changed).

  useEffect(() => {
    if (!token || checking) return;

    let cancelled = false;
    apiCall<AuthUser | { user: AuthUser }>("/api/auth/me")
      .then((result) => {
        if (cancelled) return;
        const freshUser = "user" in result ? result.user : result;
        if (!freshUser) {
          logoutRef.current();
          return;
        }
        setUser(freshUser);
        storageSave(KEYS.user, JSON.stringify(freshUser));
      })
      .catch(() => {
        if (!cancelled) logoutRef.current();
      });

    return () => { cancelled = true; };
  // `checking` included intentionally — validation must run after hydration.
  }, [token, checking]);

  // ── Global 401 interceptor ────────────────────────────────────────────────
  // Patches window.fetch exactly once on mount.
  // Uses logoutRef so it never captures a stale closure.

  useEffect(() => {
    const original = window.fetch;

    window.fetch = async (...args) => {
      const res = await original(...args);
      if (res.status === 401) {
        const url =
          typeof args[0] === "string"
            ? args[0]
            : args[0] instanceof Request
            ? args[0].url
            : String(args[0]);
        const isAuthRoute = AUTH_ROUTES.some((r) => url.includes(r));
        if (!isAuthRoute) {
          logoutRef.current();
          return res.clone();
        }
      }
      return res;
    };

    return () => { window.fetch = original; };
  // Empty deps — intentional: patch once, logoutRef handles staleness.
  }, []);

  // ── Stable context value ──────────────────────────────────────────────────
  // Memoised so consumers only re-render when the values actually change,
  // not on every render of AuthProvider itself.

  const value = useMemo<AuthState>(
    () => ({ user, token, checking, login, logout }),
    [user, token, checking, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
