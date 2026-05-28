import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme:       Theme;
  toggleTheme: () => void;
  isDark:      boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read stored theme. Falls back to OS preference, then the supplied default. */
function resolveInitialTheme(defaultTheme: Theme): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private browsing, SSR, permissions)
  }
  // Respect the OS preference when there is no stored value
  if (typeof window !== "undefined" && window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  }
  return defaultTheme;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue>({
  theme:       "light",
  toggleTheme: () => {},
  isDark:      false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ThemeProviderProps {
  children:      ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = "light" }: ThemeProviderProps) {
  // Initialiser runs once — safe from re-render thrash
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme(defaultTheme));

  // Derived — stable between renders unless theme changes
  const isDark = theme === "dark";

  // Apply class to <html> and persist whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Ignore — storage may be unavailable in private browsing
    }
  }, [theme, isDark]);

  // Listen for OS-level preference changes (e.g. user switches system dark mode)
  // Only applies when the user has NOT manually set a preference (no stored value).
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;

    const handler = (e: MediaQueryListEvent) => {
      // Only follow OS if no manual preference is stored
      try {
        if (!localStorage.getItem("theme")) {
          setTheme(e.matches ? "dark" : "light");
        }
      } catch {
        setTheme(e.matches ? "dark" : "light");
      }
    };

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, toggleTheme, isDark }),
    [theme, toggleTheme, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme() {
  return useContext(ThemeContext);
}