import { useEffect } from "react";
import { Router as WouterRouter, useLocation } from "wouter";
import { Desktop } from "@/components/Desktop";
import { Taskbar } from "@/components/Taskbar";
import { pingVisit } from "@/lib/api";
import { useDesktopStore } from "@/store";
import { ThemeProvider } from "@/lib/theme";
import { NotificationPrompt } from "@/components/NotificationPrompt";
import { useAuth } from "@/lib/auth-store";
import { setTimeZone, useTimeZone } from "@/lib/time-settings";
import { syncServerClock } from "@/lib/server-clock";

function AppLayout() {
  const [location] = useLocation();
  const page = location || '/';
  const addWindow = useDesktopStore((s) => s.addWindow);
  const user = useAuth((s) => s.user);
  const timeZone = useTimeZone();

  useEffect(() => {
    if (sessionStorage.getItem("pd-visited")) return;
    sessionStorage.setItem("pd-visited", "1");
    void pingVisit().catch(() => {});
  }, []);

  useEffect(() => {
    if (localStorage.getItem("pd-news-opened")) return;
    localStorage.setItem("pd-news-opened", "1");
    addWindow(page, { type: "news", title: "Site News", width: 520, height: 480 });
  }, [addWindow, page]);

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
    <div className="w-screen h-[100dvh] relative overflow-hidden bg-background select-none" data-time-zone={timeZone}>
      <Desktop page={page} />
      <Taskbar page={page} />
      <NotificationPrompt />
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
