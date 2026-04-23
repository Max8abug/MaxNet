import { create } from "zustand";
import { getMe, login as apiLogin, signup as apiSignup, logout as apiLogout, type AuthUser } from "./api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  signup: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  refresh: async () => {
    try {
      const u = await getMe();
      set({ user: u, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
  login: async (username, password) => {
    const u = await apiLogin(username, password);
    set({ user: u });
  },
  signup: async (username, password) => {
    const u = await apiSignup(username, password);
    set({ user: u });
  },
  logout: async () => {
    await apiLogout();
    set({ user: null });
  },
}));
