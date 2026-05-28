import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme:       Theme;
  toggleTheme: () => void;
  isDark:      boolean;
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
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) ?? defaultTheme;
  });

  const isDark = theme === "dark";

  // Apply the class to <html> whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    localStorage.setItem("theme", theme);
  }, [theme, isDark]);

  function toggleTheme() {
    setTheme(t => t === "light" ? "dark" : "light");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme() {
  return useContext(ThemeContext);
}
