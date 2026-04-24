import { useEffect, useState } from "react";

type Toast = { id: number; title: string; body: string; ts: number };
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
let nextId = 1;

export function pushToast(title: string, body: string) {
  const t: Toast = { id: nextId++, title, body, ts: Date.now() };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, 5000);
}

export function ToastHost() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    const cb = (t: Toast[]) => setList([...t]);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return (
    <div className="fixed top-2 right-2 z-[2000] flex flex-col gap-1 pointer-events-none">
      {list.map((t) => (
        <div key={t.id} className="win98-window bg-[#c0c0c0] w-64 pointer-events-auto shadow-md">
          <div className="bg-[#000080] text-white px-2 py-0.5 text-xs font-bold">{t.title}</div>
          <div className="p-2 text-xs break-words">{t.body}</div>
        </div>
      ))}
    </div>
  );
}
