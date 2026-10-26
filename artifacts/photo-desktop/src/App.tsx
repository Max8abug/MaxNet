import { useEffect } from "react";
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

function AppLayout() {
  const [location] = useLocation();
  const page = location || '/';
  const addWindow = useDesktopStore((s) => s.addWindow);
  const user = useAuth((s) => s.user);
  const authLoading = useAuth((s) => s.loading);
  const timeZone = useTimeZone();
  const isMobile = useIsMobile();
  const { profileOpen, setProfileOpen } = useProfileDialogStore();
  const { setTheme } = useThemeMode();

  // Native MaxNet OS launchers pass validated app and theme IDs in the URL.
  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const intent = params.get("maxnet-feature");
    const requestedTheme = params.get("maxnet-theme");
    if (!intent && !requestedTheme) return;

    params.delete("maxnet-feature");
    params.delete("maxnet-theme");
    const query = params.toString();
    const cleanUrl = window.location.pathname + (query ? "?" + query : "") + window.location.hash;
    window.history.replaceState(window.history.state, "", cleanUrl);

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

    const windowIntents: Record<string, Partial<WindowData>> = {
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
    const launchWindow = windowIntents[intent];
    if (launchWindow) addWindow(page, launchWindow);
  }, [addWindow, authLoading, page, setTheme]);
  useEffect(() => {
    setProfileOpen(false);
  }, [user?.id, setProfileOpen]);

  useEffect(() => {
    if (sessionStorage.getItem("pd-visited")) return;
    sessionStorage.setItem("pd-visited", "1");
    void pingVisit().catch(() => {});
  }, []);

  useEffect(() => {
    if (isMobile) return;
    if (localStorage.getItem("pd-news-opened")) return;
    localStorage.setItem("pd-news-opened", "1");
    addWindow(page, { type: "news", title: "Site News", width: 520, height: 480 });
  }, [addWindow, isMobile, page]);

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
    <div className="w-screen h-[100dvh] relative isolate overflow-hidden bg-background select-none" data-time-zone={timeZone}>
      {isMobile ? <MobileShell page={page} /> : (
        <>
          <Desktop page={page} />
          <Taskbar page={page} />
        </>
      )}
      <NotificationPrompt />
      <ThemePreferencePrompt />
      {profileOpen && user && <ProfileDialog mobile={isMobile} onClose={() => setProfileOpen(false)} />}
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
