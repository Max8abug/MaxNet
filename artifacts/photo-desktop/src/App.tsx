import { useEffect, useState } from "react";
import { Router as WouterRouter, useLocation } from "wouter";
import { Desktop } from "@/components/Desktop";
import { Taskbar } from "@/components/Taskbar";
import { pingVisit } from "@/lib/api";
import { useDesktopStore, type WindowData } from "@/store";
import { THEME_OPTIONS, ThemeProvider, useThemeMode, type AppTheme } from "@/lib/theme";
import { NotificationPrompt } from "@/components/NotificationPrompt";
import { useAuth } from "@/lib/auth-store";
import { setTimeZone, useTimeZone } from "@/lib/time-settings";
import { syncServerClock } from "@/lib/server-clock";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileShell } from "@/components/MobileShell";
import { ThemePreferencePrompt } from "@/components/ThemePreferencePrompt";
import { ProfileDialog } from "@/components/ProfileDialog";
import { useProfileDialogStore } from "@/lib/profile-dialog-store";

const OS_APP_WINDOW_INTENTS: Record<string, Partial<WindowData>> = {
    chat: { type: "chat", title: "MaxNet Chatroom", width: 420, height: 500 },
    forum: { type: "forum", title: "MaxNet Forums", width: 600, height: 520 },
    dms: { type: "dms", title: "Direct Messages", width: 460, height: 380 },
    network: { type: "browser", browserView: "feed", title: "the Network", width: 900, height: 640 },
    "network-people": { type: "browser", browserView: "people", title: "Network People", width: 900, height: 640 },
    "network-wiki": { type: "browser", browserView: "wiki", title: "Network Wiki", width: 900, height: 640 },
    gallery: { type: "sharedphotos", title: "Photo Gallery", width: 460, height: 460 },
    users: { type: "userlist", title: "MaxNet Users", width: 300, height: 460 },
    visits: { type: "visits", title: "Visitor Counter", width: 300, height: 200 },
    guestbook: { type: "guestbook", title: "Guestbook", width: 360, height: 440 },
    planner: { type: "planner", title: "Planner", width: 760, height: 640 },
    news: { type: "news", title: "Site News", width: 520, height: 480 },
    games: { type: "gamesmanager", title: "Games Manager", width: 760, height: 560 },
    eaglercraft: { type: "eaglercraft", title: "Eaglercraft", width: 960, height: 640 },
    mypage: { type: "mypage", title: "My Page", width: 520, height: 440 },
    youtube: { type: "youtube", title: "Synced YouTube", width: 480, height: 320 },
    polls: { type: "polls", title: "Polls", width: 420, height: 480 },
    music: { type: "music", title: "Music Player", width: 420, height: 460 },
    playlists: { type: "personalplaylists", title: "My Playlists", width: 700, height: 720 },
    drawing: { type: "drawing", title: "Visitor Drawings", width: 460, height: 440 },
    settings: { type: "settings", title: "MaxNet Display Settings", width: 480, height: 520 },
    };
    const APP_ONLY_FEATURES = new Set(Object.keys(OS_APP_WINDOW_INTENTS));
    type AppOnlyLaunch = { feature: string; instance: string };

    function parseAppOnlyLaunch(feature: unknown, instance: unknown): AppOnlyLaunch | null {
    if (typeof feature !== "string" || !APP_ONLY_FEATURES.has(feature)) return null;
    const safeInstance = typeof instance === "string" && /^[A-Za-z0-9._-]{1,96}$/.test(instance) ? instance : feature;
    return { feature, instance: safeInstance };
    }

    function loadAppOnlyLaunch(): AppOnlyLaunch | null {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("maxnet-view") === "app") {
      const fromUrl = parseAppOnlyLaunch(params.get("maxnet-feature"), params.get("maxnet-launch-id"));
      if (fromUrl) return fromUrl;
    }
    try {
      const stored = window.sessionStorage.getItem("maxnet-os-app-window");
      if (stored) {
        const value = JSON.parse(stored) as { feature?: unknown; instance?: unknown };
        return parseAppOnlyLaunch(value.feature, value.instance);
      }
    } catch {}
    return null;
    }

    function AppLayout() {
  const [location] = useLocation();
  const page = location || '/';
  const [standaloneLaunch, setStandaloneLaunch] = useState(loadAppOnlyLaunch);
  const isStandaloneApp = standaloneLaunch !== null;
  const standalonePage = standaloneLaunch ? "maxnet-app-" + standaloneLaunch.feature + "-" + standaloneLaunch.instance : page;
  const addWindow = useDesktopStore((s) => s.addWindow);
  const user = useAuth((s) => s.user);
  const authLoading = useAuth((s) => s.loading);
  const timeZone = useTimeZone();
  const isMobile = useIsMobile();
  const { profileOpen, setProfileOpen } = useProfileDialogStore();
  const { setTheme } = useThemeMode();

  // MaxOS feature windows launch the existing MaxNet app component without the web desktop shell.
    useEffect(() => {
      if (authLoading) return;
      const params = new URLSearchParams(window.location.search);
      const intent = params.get("maxnet-feature");
      const requestedTheme = params.get("maxnet-theme");
      const isOsLauncher = params.get("maxnet-os") === "1";
      const appView = params.get("maxnet-view") === "app";
      const requestedLaunch = parseAppOnlyLaunch(intent, params.get("maxnet-launch-id"));
      const isStandaloneIntent = appView && requestedLaunch !== null;
      if (!intent && !requestedTheme && !isOsLauncher && !appView) return;

      if (requestedLaunch && appView) {
        setStandaloneLaunch(requestedLaunch);
        try { window.sessionStorage.setItem("maxnet-os-app-window", JSON.stringify(requestedLaunch)); } catch {}
      }
      params.delete("maxnet-feature");
      params.delete("maxnet-theme");
      params.delete("maxnet-os");
      params.delete("maxnet-view");
      params.delete("maxnet-launch-id");
      const query = params.toString();
      const cleanUrl = window.location.pathname + (query ? "?" + query : "") + window.location.hash;
      window.history.replaceState(window.history.state, "", cleanUrl);

      if (isOsLauncher) window.localStorage.setItem("maxnet-os-mode", "1");
      if (requestedTheme && THEME_OPTIONS.some((option) => option.value === requestedTheme)) {
        setTheme(requestedTheme as AppTheme);
      }
      if (!intent) return;

      if (intent === "signin") {
        window.requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("maxnet:open-login"));
        });
        return;
      }

      const launchWindow = OS_APP_WINDOW_INTENTS[intent];
      if (launchWindow) {
        if (intent === "news") window.localStorage.setItem("pd-news-opened", "1");
        const targetPage = isStandaloneIntent && requestedLaunch
          ? "maxnet-app-" + requestedLaunch.feature + "-" + requestedLaunch.instance
          : page;
        const existingWindows = useDesktopStore.getState().windows[targetPage] || [];
        if (!isStandaloneIntent || !existingWindows.some((savedWindow) => savedWindow.type === launchWindow.type)) {
          addWindow(targetPage, { ...launchWindow, ...(isStandaloneIntent ? { state: "max" as const } : {}) });
        }
      }
    }, [addWindow, authLoading, page, setStandaloneLaunch, setTheme]);

    useEffect(() => {
      if (!standaloneLaunch) return;
      document.title = (OS_APP_WINDOW_INTENTS[standaloneLaunch.feature]?.title || "MaxNet") + " — MaxNet";
    }, [standaloneLaunch]);

      useEffect(() => {
    setProfileOpen(false);
  }, [user?.id, setProfileOpen]);

  useEffect(() => {
    if (sessionStorage.getItem("pd-visited")) return;
    sessionStorage.setItem("pd-visited", "1");
    void pingVisit().catch(() => {});
  }, []);

  useEffect(() => {
    if (isMobile || isStandaloneApp) return;
    if (localStorage.getItem("pd-news-opened")) return;
    localStorage.setItem("pd-news-opened", "1");
    addWindow(page, { type: "news", title: "Site News", width: 520, height: 480 });
  }, [addWindow, isMobile, isStandaloneApp, page]);

  // Keep live timers anchored to the server clock instead of a device clock
  // that may be manually set or have a different timezone.
  useEffect(() => {
    void syncServerClock().catch(() => {});
    const timer = window.setInterval(() => { void syncServerClock().catch(() => {}); }, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setTimeZone(user?.timeZone);
  }, [user?.timeZone]);

  return (
    // Desktop window z-indices grow as windows receive focus. Keep them local
    // so body-portaled settings dialogs always stay above the entire desktop.
    <div className="w-screen h-[100dvh] relative isolate overflow-hidden bg-background select-none" data-time-zone={timeZone} data-maxnet-app={standaloneLaunch?.feature}>
      {isMobile && !isStandaloneApp ? <MobileShell page={page} /> : (
        <>
          <Desktop page={standalonePage} appOnly={isStandaloneApp} />
          {!isStandaloneApp && <Taskbar page={page} />}
        </>
      )}
      {!isStandaloneApp && <NotificationPrompt />}
      {!isStandaloneApp && <ThemePreferencePrompt />}
      {!isStandaloneApp && profileOpen && user && <ProfileDialog mobile={isMobile} onClose={() => setProfileOpen(false)} />}
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AppLayout />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
