import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { Desktop } from "@/components/Desktop";
import { Taskbar } from "@/components/Taskbar";

function AppLayout() {
  const [location] = useLocation();
  const page = location || '/';

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
