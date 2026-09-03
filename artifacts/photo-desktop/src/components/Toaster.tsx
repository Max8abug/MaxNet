import { useEffect, useState } from "react";
import { subscribeToasts, type Toast } from "../lib/notifications";

const DURATION_MS = 6000;

// Stack of in-app popups in the bottom-right corner. Each toast auto-dismisses
// after a few seconds, but the user can also click it to dismiss early.
export function Toaster({ onClick }: { onClick?: (t: Toast) => void } = {}) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const unsub = subscribeToasts((t) => {
      setToasts((cur) => [...cur, t]);
      setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), DURATION_MS);
    });
    return () => { unsub(); };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-12 right-2 z-[10000] flex flex-col gap-1 max-w-[280px]">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className="win98-window bg-[#ffffe1] text-left px-2 py-1 shadow-lg cursor-pointer hover:brightness-95"
          onClick={() => {
            setToasts((cur) => cur.filter((x) => x.id !== t.id));
            onClick?.(t);
          }}
          title="Click to open"
        >
          <div className="font-bold text-xs truncate">✉ {t.title}</div>
          <div className="text-[11px] text-gray-700 line-clamp-2">{t.body}</div>
        </button>
      ))}
    </div>
  );
}
