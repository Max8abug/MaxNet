import { useEffect } from "react";
import { Router as WouterRouter, useLocation } from "wouter";
import { Desktop } from "@/components/Desktop";
import { Taskbar } from "@/components/Taskbar";
import { pingVisit } from "@/lib/api";

function AppLayout() {
  const [location] = useLocation();
  const page = location || '/';

  useEffect(() => {
    if (sessionStorage.getItem("pd-visited")) return;
    sessionStorage.setItem("pd-visited", "1");
    void pingVisit().catch(() => {});
  }, []);

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
