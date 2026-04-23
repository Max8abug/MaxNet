import { useEffect, useState } from "react";
import { fetchGuestbook, postGuestbook, deleteGuestbookEntry, type GuestbookEntry } from "../lib/api";
import { useAuth } from "../lib/auth-store";

export function Guestbook() {
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [name, setName] = useState(() => localStorage.getItem("pd-gb-name") || "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const user = useAuth((s) => s.user);

  async function refresh() {
    try { setEntries(await fetchGuestbook()); } catch {}
  }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, []);
  useEffect(() => { localStorage.setItem("pd-gb-name", name); }, [name]);

  async function sign() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await postGuestbook(text, name || "anon");
      setBody("");
      await refresh();
    } catch {} finally { setBusy(false); }
  }

  async function remove(id: number) {
    try { await deleteGuestbookEntry(id); await refresh(); } catch {}
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      <div className="flex-1 win98-inset bg-[#fffef0] p-2 overflow-auto">
        {entries.length === 0 ? (
          <div className="text-gray-500 text-xs italic">The guestbook is empty. Be the first to sign.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((e) => (
              <div key={e.id} className="border-b border-dashed border-gray-400 pb-1 relative group">
                <div className="italic text-[13px] leading-snug whitespace-pre-wrap break-words" style={{ fontFamily: "Georgia, serif" }}>
                  &ldquo;{e.body}&rdquo;
                </div>
                <div className="text-[11px] text-gray-600 mt-0.5">
                  — {e.author}, {new Date(e.createdAt).toLocaleDateString()}
                </div>
                {user?.isAdmin && (
                  <button
                    className="win98-button absolute top-0 right-0 px-1 text-[10px] opacity-0 group-hover:opacity-100"
                    onClick={() => remove(e.id)}
                  >x</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-col gap-1 shrink-0">
        <input
          className="win98-inset px-1"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="win98-inset px-1 py-0.5 resize-none"
          rows={2}
          placeholder="Leave a note..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="win98-button px-2 py-0.5 self-end" disabled={busy} onClick={sign}>
          Sign
        </button>
      </div>
    </div>
  );
}
