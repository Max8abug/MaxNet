import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "pd-display-theme";
const LEGACY_STORAGE_KEY = "pd-dark-mode";

export const THEME_OPTIONS = [
  { value: "classic-light", label: "Classic light" },
  { value: "classic-dark", label: "Classic dark" },
  { value: "xp-light", label: "Windows XP light" },
  { value: "xp-dark", label: "Windows XP dark" },
  { value: "vista", label: "Windows Vista" },
  { value: "gold", label: "Gold picture frame" },
] as const;

export type AppTheme = (typeof THEME_OPTIONS)[number]["value"];

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  darkMode: boolean;
  setDarkMode: (enabled: boolean) => void;
  needsInitialChoice: boolean;
  chooseInitialTheme: (theme: AppTheme | boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isAppTheme(value: string | null): value is AppTheme {
  return THEME_OPTIONS.some((option) => option.value === value);
}

function getInitialTheme(): AppTheme {
  if (typeof window === "undefined") return "classic-light";
  const savedTheme = window.localStorage.getItem(STORAGE_KEY);
  if (isAppTheme(savedTheme)) return savedTheme;
  const legacyDarkMode = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyDarkMode !== null) {
    return legacyDarkMode === "true" ? "classic-dark" : "classic-light";
  }
  return "classic-light";
}

function isDarkTheme(theme: AppTheme): boolean {
  return theme === "classic-dark" || theme === "xp-dark";
}

function normalizeTheme(theme: AppTheme | boolean): AppTheme {
  if (typeof theme === "boolean") return theme ? "classic-dark" : "classic-light";
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppTheme>(getInitialTheme);
  const darkMode = isDarkTheme(theme);
  const [needsInitialChoice] = useState(() => {
    if (typeof window === "undefined") return false;
    // Migrate the earlier binary preference without interrupting returning visitors.
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    return !isAppTheme(savedTheme) && window.localStorage.getItem(LEGACY_STORAGE_KEY) === null;
  });
  const [initialChoiceComplete, setInitialChoiceComplete] = useState(false);

  useEffect(() => {
    const isDark = isDarkTheme(theme);
    document.documentElement.classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
    document.documentElement.dataset.appTheme = theme;
    document.body.dataset.appTheme = theme;
    if (!needsInitialChoice || initialChoiceComplete) {
      window.localStorage.setItem(STORAGE_KEY, theme);
      // Keep the old key in sync for any older client code still reading it.
      window.localStorage.setItem(LEGACY_STORAGE_KEY, String(isDark));
    }
  }, [theme, needsInitialChoice, initialChoiceComplete]);

  const updateDarkMode = useCallback((enabled: boolean) => {
    setTheme(enabled ? "classic-dark" : "classic-light");
  }, []);

  const chooseInitialTheme = useCallback((selection: AppTheme | boolean) => {
    setTheme(normalizeTheme(selection));
    setInitialChoiceComplete(true);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        darkMode,
        setDarkMode: updateDarkMode,
        needsInitialChoice: needsInitialChoice && !initialChoiceComplete,
        chooseInitialTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemeMode must be used inside ThemeProvider");
  return context;
}