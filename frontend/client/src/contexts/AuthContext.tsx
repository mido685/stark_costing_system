import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { apiCall } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:            number;
  username:      string;
  display_name:  string;
  role:          string;
  company_id:    number;
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

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthState>(null!);
export const useAuth = () => useContext(AuthContext);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,     setUser]     = useState<AuthUser | null>(null);
  const [token,    setToken]    = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // ── logout (stable ref so the fetch interceptor always sees the latest) ──

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem(KEYS.token);
    localStorage.removeItem(KEYS.user);
  }, []);

  // Keep a stable ref so the interceptor closure never goes stale
  const logoutRef = useRef(logout);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  // ── login ─────────────────────────────────────────────────────────────────

  const login = useCallback((authUser: AuthUser, authToken: string) => {
    setUser(authUser);
    setToken(authToken);
    localStorage.setItem(KEYS.token, authToken);
    localStorage.setItem(KEYS.user,  JSON.stringify(authUser));
  }, []);

  // ── Session restore on mount ──────────────────────────────────────────────

  useEffect(() => {
    try {
      const storedToken = localStorage.getItem(KEYS.token);
      const storedUser  = localStorage.getItem(KEYS.user);
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch {
      // Corrupt storage — clear and start fresh
      localStorage.removeItem(KEYS.token);
      localStorage.removeItem(KEYS.user);
    } finally {
      setChecking(false);
    }
  }, []);

  // ── Re-validate token + refresh user profile ──────────────────────────────
  // Runs after session restore and after every login. We skip validation while
  // `checking` is still true to avoid a race where restore hasn't finished yet.

  useEffect(() => {
    if (!token || checking) return;

    let cancelled = false;
    apiCall<{ user: AuthUser }>("/api/auth/me")
      .then(({ user: freshUser }) => {
        if (cancelled) return;
        setUser(freshUser);
        localStorage.setItem(KEYS.user, JSON.stringify(freshUser));
      })
      .catch(() => {
        if (!cancelled) logoutRef.current();
      });

    return () => { cancelled = true; };
  // `checking` is intentionally included so validation runs after hydration.
  }, [token, checking]);

  // ── Global 401 interceptor ────────────────────────────────────────────────
  // Patches window.fetch once on mount. Uses logoutRef so it never captures
  // a stale closure. Guard against double-patching on StrictMode remounts.

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
          // Return a clone so the caller can still inspect the response
          return res.clone();
        }
      }
      return res;
    };

    return () => {
      window.fetch = original;
    };
  // Empty deps — intentional: we only want to patch once.
  // logoutRef is a stable ref so no stale-closure risk.
  }, []);

  // ── Provider value ────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider value={{ user, token, checking, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}