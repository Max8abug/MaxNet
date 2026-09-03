import { useEffect, useState } from "react";
import { getVisits } from "../lib/api";

export function VisitCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const c = await getVisits();
        if (alive) setCount(c);
      } catch { /* ignore */ }
    };
    void load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const padded = (count ?? 0).toString().padStart(7, "0");

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2">
      <div className="text-xs uppercase tracking-widest text-gray-600">Visitors</div>
      <div className="font-mono text-3xl tracking-widest bg-black text-[#39ff14] px-3 py-2 win98-inset">
        {padded}
      </div>
      <div className="text-[10px] text-gray-500">since the desktop opened</div>
    </div>
  );
}
