import { useEffect, useRef, useState } from "react";
import { fetchDMContacts, fetchDMs, sendDM, type DMContact, type DMMessage } from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
import { Avatar } from "./Avatar";

export function DMs({ initialPeer }: { initialPeer?: string } = {}) {
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const [contacts, setContacts] = useState<DMContact[]>([]);
  const [other, setOther] = useState<string | null>(initialPeer ?? null);
  // If the window was opened later with a different peer (or one is supplied
  // after mount), follow it. We only auto-switch when initialPeer changes to
  // a non-empty value, so the user's manual selection is never overridden.
  useEffect(() => { if (initialPeer) setOther(initialPeer); }, [initialPeer]);
  const [msgs, setMsgs] = useState<DMMessage[]>([]);
  const [text, setText] = useState("");
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);
  useEffect(() => { fetchDMContacts().then(setContacts).catch(() => {}); }, []);
  useEffect(() => {
    if (!other) return;
    const tick = async () => { try { setMsgs(await fetchDMs(other)); } catch {} };
    void tick(); const t = setInterval(tick, 4000); return () => clearInterval(t);
  }, [other]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [msgs.length]);

  if (!user) return <div className="p-2 text-xs">Log in to use DMs.</div>;
  if (!hasPermission(user, "dm", ranks)) return <div className="p-2 text-xs">DMs require VIP rank or higher. Ask an admin.</div>;

  async function send() {
    if (!other || !text.trim()) return;
    try { await sendDM(other, text); setText(""); setMsgs(await fetchDMs(other)); } catch {}
  }

  return (
    <div className="w-full h-full flex text-xs">
      <div className="w-32 shrink-0 win98-inset bg-white overflow-auto">
        {contacts.filter(c => c.username !== user.username).map(c => (
          <button key={c.username} className={`w-full text-left px-1 py-0.5 hover:bg-blue-100 flex items-center gap-1 ${other === c.username ? "bg-blue-200" : ""}`} onClick={() => setOther(c.username)}>
            <Avatar username={c.username} size={20} />
            <span className="truncate">{c.username}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 flex flex-col ml-1">
        <div ref={scroll} className="flex-1 win98-inset bg-white p-1 overflow-auto">
          {!other ? <div className="text-gray-500">Select a contact</div> :
            msgs.length === 0 ? <div className="text-gray-500">No messages yet.</div> :
              msgs.map(m => (
                <div key={m.id} className={`mb-0.5 ${m.fromUser === user.username ? "text-right" : ""}`}>
                  <span className="font-bold">{m.fromUser === user.username ? "you" : m.fromUser}:</span> {m.body}
                </div>
              ))}
        </div>
        {other && (
          <div className="flex gap-1 mt-1">
            <input className="win98-inset px-1 flex-1" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
            <button className="win98-button px-2" onClick={send}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
}
