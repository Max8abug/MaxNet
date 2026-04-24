import { useEffect, useState } from "react";
import { fetchGuestbook, postGuestbook, deleteGuestbookEntry, type GuestbookEntry } from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
import { ModAuditPanel } from "./ModAuditPanel";

type Tab = "view" | "audit";

export function Guestbook() {
  const [entries, setEntries] = useState<GuestbookEntry[]>([]);
  const [name, setName] = useState(() => localStorage.getItem("pd-gb-name") || "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const isAdmin = !!user?.isAdmin;
  const canDelete = !!user && (isAdmin || hasPermission(user, "deleteMessages", ranks));
  const [tab, setTab] = useState<Tab>("view");
  useEffect(() => { void refreshRanks(); }, [refreshRanks]);

  async function refresh() { try { setEntries(await fetchGuestbook()); } catch {} }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 8000); return () => clearInterval(t); }, []);
  useEffect(() => { localStorage.setItem("pd-gb-name", name); }, [name]);

  async function sign() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true); setErr(null);
    try { await postGuestbook(text, name || (user?.username ?? "anon")); setBody(""); await refresh(); }
    catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    try { await deleteGuestbookEntry(id); await refresh(); } catch {}
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      {canDelete && (
        <div className="flex gap-1 mb-1 shrink-0">
          <button className={`win98-button px-2 py-0.5 text-xs ${tab === "view" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTab("view")}>Notes</button>
          <button className={`win98-button px-2 py-0.5 text-xs ${tab === "audit" ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`} onClick={() => setTab("audit")}>Audit</button>
        </div>
      )}

      {tab === "view" && (
        <>
          <div className="flex-1 win98-inset bg-[#fffef0] p-2 overflow-auto">
            {entries.length === 0 ? (
              <div className="text-gray-500 text-xs italic">The guestbook is empty.</div>
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
                    {canDelete && (
                      <button className="win98-button absolute top-0 right-0 px-1 text-[10px] opacity-0 group-hover:opacity-100" onClick={() => remove(e.id)}>x</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {err && <div className="text-red-700 text-xs">{err}</div>}
          <div className="mt-1 flex flex-col gap-1 shrink-0">
            {!user && (
              <input className="win98-inset px-1" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <textarea className="win98-inset px-1 py-0.5 resize-none" rows={2} placeholder="Leave a note..." value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="win98-button px-2 py-0.5 self-end" disabled={busy} onClick={sign}>
              Sign{user ? ` as ${user.username}` : ""}
            </button>
          </div>
        </>
      )}

      {tab === "audit" && canDelete && <ModAuditPanel area="guestbook" />}
    </div>
  );
}
