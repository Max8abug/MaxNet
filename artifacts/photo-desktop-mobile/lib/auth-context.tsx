import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe, login as apiLogin, logout as apiLogout, signup as apiSignup, type MobileUser } from "./api";

type MobileAuthContextValue = {
  user: MobileUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await getMe());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<MobileAuthContextValue>(() => ({
    user,
    loading,
    refresh,
    login: async (username, password) => {
      await apiLogin(username, password);
      await refresh();
    },
    signup: async (username, password) => {
      await apiSignup(username, password);
      await refresh();
    },
    logout: async () => {
      await apiLogout();
      setUser(null);
    },
  }), [user, loading, refresh]);

  return <MobileAuthContext.Provider value={value}>{children}</MobileAuthContext.Provider>;
}

export function useMobileAuth(): MobileAuthContextValue {
  const value = useContext(MobileAuthContext);
  if (!value) throw new Error("useMobileAuth must be used inside AuthProvider.");
  return value;
}
