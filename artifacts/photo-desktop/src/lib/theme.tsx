import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "pd-dark-mode";

interface ThemeContextValue {
  darkMode: boolean;
  setDarkMode: (enabled: boolean) => void;
  needsInitialChoice: boolean;
  chooseInitialTheme: (enabled: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(getInitialDarkMode);
  const [needsInitialChoice] = useState(() => {
    if (typeof window === "undefined") return false;
    // An existing pd-dark-mode value is an explicit preference from an
    // earlier version of the app, so don't interrupt returning visitors.
    return window.localStorage.getItem(STORAGE_KEY) === null;
  });
  const [initialChoiceComplete, setInitialChoiceComplete] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.body.classList.toggle("dark", darkMode);
    window.localStorage.setItem(STORAGE_KEY, String(darkMode));
  }, [darkMode]);

  const updateDarkMode = useCallback((enabled: boolean) => {
    setDarkMode(enabled);
  }, []);

  const chooseInitialTheme = useCallback((enabled: boolean) => {
    setDarkMode(enabled);
    setInitialChoiceComplete(true);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
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