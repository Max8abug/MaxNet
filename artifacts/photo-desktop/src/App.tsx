import { useEffect } from "react";
import { Router as WouterRouter, useLocation } from "wouter";
import { Desktop } from "@/components/Desktop";
import { Taskbar } from "@/components/Taskbar";
import { pingVisit } from "@/lib/api";
import { useDesktopStore } from "@/store";

function AppLayout() {
  const [location] = useLocation();
  const page = location || '/';
  const addWindow = useDesktopStore((s) => s.addWindow);

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

  return (
    <div className="w-screen h-[100dvh] relative overflow-hidden bg-background select-none">
      <Desktop page={page} />
      <Taskbar page={page} />
    </div>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AppLayout />
    </WouterRouter>
  );
}

export default App;
