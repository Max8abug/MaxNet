import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth-store";
import { getMe, updateProfile } from "./api";

const STORAGE_KEY = "pd-display-theme";
const LEGACY_STORAGE_KEY = "pd-dark-mode";

export const THEME_OPTIONS = [
  { value: "classic-light", label: "Classic light" },
  { value: "classic-dark", label: "Classic dark" },
  { value: "xp-light", label: "Windows XP light" },
  { value: "xp-dark", label: "Windows XP dark" },
  { value: "vista", label: "Windows Vista" },
  { value: "vista-dark", label: "Windows Vista dark" },
  { value: "gold", label: "Gold picture frame" },
  { value: "silver", label: "Silver picture frame" },
] as const;

export type AppTheme = (typeof THEME_OPTIONS)[number]["value"];

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  darkMode: boolean;
  setDarkMode: (enabled: boolean) => void;
  needsInitialChoice: boolean;
  chooseInitialTheme: (theme: AppTheme | boolean) => void;
  themeSaving: boolean;
  themeError: string | null;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isAppTheme(value: string | null | undefined): value is AppTheme {
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
  return theme === "classic-dark" || theme === "xp-dark" || theme === "vista-dark";
}

function normalizeTheme(theme: AppTheme | boolean): AppTheme {
  if (typeof theme === "boolean") return theme ? "classic-dark" : "classic-light";
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const user = useAuth((state) => state.user);
  const authLoading = useAuth((state) => state.loading);
  const [theme, setThemeState] = useState<AppTheme>(getInitialTheme);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const accountId = useRef<number | null>(null);
  const version = useRef(0);
  const saving = useRef(false);
  const savedTheme = useRef(theme);
  const guestTheme = useRef(theme);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const darkMode = isDarkTheme(theme);
  const [needsInitialChoice] = useState(() => {
    if (typeof window === "undefined") return false;
    // Migrate the earlier binary preference without interrupting returning visitors.
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    return !isAppTheme(savedTheme) && window.localStorage.getItem(LEGACY_STORAGE_KEY) === null;
  });
  const [initialChoiceComplete, setInitialChoiceComplete] = useState(false);

  const setTheme = useCallback((selection: AppTheme) => {
    setThemeState(selection);
    setInitialChoiceComplete(true);
    setThemeError(null);
    const owner = useAuth.getState().user;
    if (!owner) {
      guestTheme.current = selection;
      return;
    }
    const revision = ++version.current;
    saving.current = true;
    setThemeSaving(true);
    // Serialize writes so rapid selections cannot arrive at the server out of order.
    saveQueue.current = saveQueue.current.then(async () => {
      if (revision !== version.current || useAuth.getState().user?.id !== owner.id) return;
      await updateProfile({ displayTheme: selection });
      if (useAuth.getState().user?.id !== owner.id) return;
      savedTheme.current = selection;
      if (revision !== version.current) return;
      useAuth.setState((state) => ({
        user: state.user?.id === owner.id ? { ...state.user, displayTheme: selection } : state.user,
      }));
    }).catch((error: unknown) => {
      if (revision !== version.current || useAuth.getState().user?.id !== owner.id) return;
      setThemeState(savedTheme.current);
      setThemeError(`Theme was not saved: ${error instanceof Error ? error.message : "Please try again."}`);
    }).finally(() => {
      if (revision !== version.current) return;
      saving.current = false;
      setThemeSaving(false);
    });
  }, []);

  useEffect(() => {
    const id = user?.id ?? null;
    if (accountId.current !== id) {
      accountId.current = id;
      version.current++;
      saving.current = false;
      setThemeSaving(false);
      setThemeError(null);
      const selected = isAppTheme(user?.displayTheme) ? user.displayTheme : guestTheme.current;
      savedTheme.current = selected;
      setThemeState(selected);
      // One-time migration of an existing browser preference into the account.
      if (user && !isAppTheme(user.displayTheme)) setTheme(selected);
    } else if (!saving.current && isAppTheme(user?.displayTheme)) {
      savedTheme.current = user.displayTheme;
      setThemeState(user.displayTheme);
    }
  }, [user?.id, user?.displayTheme, setTheme]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    let refreshing = false;
    const id = user.id;
    const refresh = async () => {
      if (!alive || refreshing || saving.current || document.visibilityState === "hidden") return;
      const revision = version.current;
      refreshing = true;
      try {
        const fresh = await getMe();
        if (!alive || saving.current || revision !== version.current || useAuth.getState().user?.id !== id || fresh?.id !== id) return;
        if (isAppTheme(fresh.displayTheme)) {
          savedTheme.current = fresh.displayTheme;
          setThemeState(fresh.displayTheme);
          useAuth.setState((state) => ({
            user: state.user?.id === id ? { ...state.user, displayTheme: fresh.displayTheme } : state.user,
          }));
        }
      } catch {
        // Retain the last account preference during outages; next focus/tick retries.
      } finally { refreshing = false; }
    };
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user?.id]);

  useEffect(() => {
    const isDark = isDarkTheme(theme);
    document.documentElement.classList.toggle("dark", isDark);
    document.body.classList.toggle("dark", isDark);
    document.documentElement.dataset.appTheme = theme;
    document.body.dataset.appTheme = theme;
    if (!needsInitialChoice || initialChoiceComplete) {
      window.localStorage.setItem(user ? `${STORAGE_KEY}:${user.id}` : STORAGE_KEY, theme);
      // Keep the old key in sync for any older client code still reading it.
      if (!user) window.localStorage.setItem(LEGACY_STORAGE_KEY, String(isDark));
    }
  }, [theme, needsInitialChoice, initialChoiceComplete, user?.id]);

  const updateDarkMode = useCallback((enabled: boolean) => {
    setTheme(enabled ? "classic-dark" : "classic-light");
  }, [setTheme]);

  const chooseInitialTheme = useCallback((selection: AppTheme | boolean) => {
    setTheme(normalizeTheme(selection));
    setInitialChoiceComplete(true);
  }, [setTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        darkMode,
        setDarkMode: updateDarkMode,
        needsInitialChoice: !authLoading && !user && needsInitialChoice && !initialChoiceComplete,
        chooseInitialTheme,
        themeSaving,
        themeError,
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