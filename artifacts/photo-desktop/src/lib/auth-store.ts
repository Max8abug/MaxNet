import { create } from "zustand";
import { fetchRanks, getMe, login as apiLogin, signup as apiSignup, logout as apiLogout, updateProfile as apiUpdateProfile, type AuthUser, type Rank } from "./api";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  ranks: Rank[];
  refresh: () => Promise<void>;
  refreshRanks: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  signup: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: { avatarUrl?: string | null; backgroundUrl?: string | null; backgroundColor?: string | null }) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  ranks: [],
  refresh: async () => {
    try { const u = await getMe(); set({ user: u, loading: false }); }
    catch { set({ user: null, loading: false }); }
  },
  refreshRanks: async () => {
    try { const r = await fetchRanks(); set({ ranks: r }); } catch {}
  },
  login: async (username, password) => { await apiLogin(username, password); await get().refresh(); },
  signup: async (username, password) => { await apiSignup(username, password); await get().refresh(); },
  logout: async () => { await apiLogout(); set({ user: null }); },
  updateProfile: async (data) => {
    await apiUpdateProfile(data);
    await get().refresh();
  },
}));

export function getRankInfo(rank: string | null | undefined, ranks: Rank[]): Rank | null {
  if (!rank) return null;
  return ranks.find(r => r.name === rank) || null;
}

export function userColor(user: { isAdmin?: boolean; rank?: string | null; username?: string } | null | undefined, ranks: Rank[]): string {
  if (!user) return "";
  if (user.isAdmin || user.username === "Max8abug") return "#cc0000";
  const r = getRankInfo(user.rank, ranks);
  return r?.color || "";
}

export function hasPermission(user: AuthUser | null, perm: string, ranks: Rank[]): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  const r = getRankInfo(user.rank, ranks);
  return !!r?.permissions.includes(perm);
}
