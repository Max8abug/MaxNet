import { create } from "zustand";
import { fetchFeatureArchiveState, fetchRanks, fetchSiteSettings, getMe, login as apiLogin, signup as apiSignup, logout as apiLogout, updateProfile as apiUpdateProfile, type AuthUser, type Rank, type SiteSettings } from "./api";
import { setTimeZone } from "./time-settings";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  ranks: Rank[];
  siteSettings: SiteSettings;
  refresh: () => Promise<void>;
  refreshRanks: () => Promise<void>;
  refreshSiteSettings: () => Promise<void>;
  refreshFeatureArchives: () => Promise<void>;
  setArchivedFeatures: (features: string[]) => void;
  login: (u: string, p: string) => Promise<void>;
  signup: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: { avatarUrl?: string | null; backgroundUrl?: string | null; darkBackgroundUrl?: string | null; backgroundColor?: string | null; timeZone?: string | null; displayTheme?: string }) => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => {
  let archiveRevision = 0;
  let archiveEtag: string | null = null;
  let archiveRefresh: Promise<void> | null = null;
  return ({
  user: null,
  loading: true,
  ranks: [],
  siteSettings: {
    logoDataUrl: "",
    darkLogoDataUrl: "",
    backgroundDataUrl: "",
    darkBackgroundDataUrl: "",
    mobileBackgroundDataUrl: "",
    mobileDarkBackgroundDataUrl: "",
    chatCooldownEnabled: true,
    siteName: "Portfolio 98",
    customButtons: [],
    archivedFeatures: [],
    usernameBlockedPhrases: [],
    chatBlockedPhrases: [],
    forumBlockedPhrases: [],
  },
  refresh: async () => {
      try {
        const u = await getMe();
        setTimeZone(u?.timeZone);
        set({ user: u, loading: false });
      } catch {
        setTimeZone(null);
        set({ user: null, loading: false });
      }
  },
  refreshRanks: async () => {
    try { const r = await fetchRanks(); set({ ranks: r }); } catch {}
  },
  refreshSiteSettings: async () => {
    const revision = archiveRevision;
    try {
      const s = await fetchSiteSettings();
      if (revision === archiveRevision) {
        archiveRevision++;
        archiveEtag = null;
        set({ siteSettings: s });
      } else {
        set((state) => ({ siteSettings: { ...s, archivedFeatures: state.siteSettings.archivedFeatures } }));
      }
    } catch {}
  },
  setArchivedFeatures: (archivedFeatures) => {
    archiveRevision++;
    archiveEtag = null;
    set((state) => ({ siteSettings: { ...state.siteSettings, archivedFeatures } }));
  },
  refreshFeatureArchives: () => {
    if (archiveRefresh) return archiveRefresh;
    const revision = archiveRevision;
    archiveRefresh = (async () => {
      try {
        const result = await fetchFeatureArchiveState(archiveEtag);
        if (!result || revision !== archiveRevision) return;
        archiveRevision++;
        archiveEtag = result.etag;
        set((state) => ({ siteSettings: { ...state.siteSettings, archivedFeatures: result.archivedFeatures } }));
      } catch {
        // Preserve the last known launch visibility on a transient failure.
        // The next timer/focus event will retry.
      } finally {
        archiveRefresh = null;
      }
    })();
    return archiveRefresh;
  },
  login: async (username, password) => { await apiLogin(username, password); await get().refresh(); },
  signup: async (username, password) => { await apiSignup(username, password); await get().refresh(); },
  logout: async () => { await apiLogout(); set({ user: null }); },
  updateProfile: async (data) => {
    await apiUpdateProfile(data);
    await get().refresh();
    const u = get().user;
    if (u) {
      try {
        const mod = await import("../components/Avatar");
        mod.bustAvatarCache(u.username);
      } catch {}
    }
  },
  });
});

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
