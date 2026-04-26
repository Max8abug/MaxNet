import { useEffect, useRef, useState } from "react";
import { fetchDMContacts, fetchDMConversations, fetchDMs, sendDM, type DMContact, type DMConversation, type DMMessage } from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
import { Avatar } from "./Avatar";

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const ms = now.getTime() - d.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString();
  } catch { return iso; }
}

export function DMs({ initialPeer }: { initialPeer?: string } = {}) {
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const [convos, setConvos] = useState<DMConversation[]>([]);
  const [contacts, setContacts] = useState<DMContact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [other, setOther] = useState<string | null>(initialPeer ?? null);
  // Auto-switch to a peer when the window receives one (e.g. clicked from a profile).
  useEffect(() => { if (initialPeer) setOther(initialPeer); }, [initialPeer]);
  const [msgs, setMsgs] = useState<DMMessage[]>([]);
  const [text, setText] = useState("");
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);

  // Re-fetch the inbox on a slow timer so badges + previews stay current while
  // the window is open. The taskbar polls separately for its own badge.
  async function loadConversations() {
    try { setConvos(await fetchDMConversations()); } catch {}
  }
  useEffect(() => {
    void loadConversations();
    const t = setInterval(loadConversations, 5000);
    return () => clearInterval(t);
  }, []);

  // Active thread polling (faster cadence so chats feel live).
  useEffect(() => {
    if (!other) return;
    const tick = async () => {
      try { setMsgs(await fetchDMs(other)); }
      catch {}
      // Opening a conversation should clear its unread count in the inbox.
      void loadConversations();
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [other]);

  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [msgs.length]);

  if (!user) return <div className="p-2 text-xs">Log in to use DMs.</div>;
  if (!hasPermission(user, "dm", ranks)) return <div className="p-2 text-xs">DMs require VIP rank or higher. Ask an admin.</div>;

  async function send() {
    if (!other || !text.trim()) return;
    try { await sendDM(other, text); setText(""); setMsgs(await fetchDMs(other)); void loadConversations(); }
    catch {}
  }

  async function openContactPicker() {
    setShowContacts((v) => !v);
    if (contacts.length === 0) {
      try { setContacts(await fetchDMContacts()); } catch {}
    }
  }

  const totalUnread = convos.reduce((s, c) => s + (c.unread || 0), 0);
  const knownPartners = new Set(convos.map((c) => c.partner));
  const newContacts = contacts.filter((c) => c.username !== user.username && !knownPartners.has(c.username));

  return (
    <div className="w-full h-full flex text-xs">
      <div className="w-44 shrink-0 win98-inset bg-white overflow-auto flex flex-col">
        <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold flex items-center justify-between">
          <span>Inbox{totalUnread > 0 ? ` (${totalUnread})` : ""}</span>
          <button
            className="win98-button px-1 text-black text-[10px]"
            onClick={openContactPicker}
            title="Start a new DM"
          >+ new</button>
        </div>

        {showContacts && (
          <div className="border-b border-[#808080] bg-[#f4f4f4] max-h-32 overflow-auto">
            <div className="px-1 py-0.5 text-[10px] text-gray-700">Start a chat with…</div>
            {newContacts.length === 0 && <div className="px-1 pb-1 text-[10px] text-gray-500">No other contactable users.</div>}
            {newContacts.map((c) => (
              <button
                key={c.username}
                className="w-full text-left px-1 py-0.5 hover:bg-blue-100 flex items-center gap-1"
                onClick={() => { setOther(c.username); setShowContacts(false); }}
              >
                <Avatar username={c.username} size={18} />
                <span className="truncate">{c.username}</span>
              </button>
            ))}
          </div>
        )}

        {convos.length === 0 && !showContacts && (
          <div className="p-2 text-gray-500 text-[10px]">
            No conversations yet. Click <b>+ new</b> to start one.
          </div>
        )}

        {convos.map((c) => {
          const isActive = other === c.partner;
          const hasUnread = (c.unread || 0) > 0 && !isActive;
          return (
            <button
              key={c.partner}
              className={`w-full text-left px-1 py-1 border-b border-gray-200 hover:bg-blue-50 flex items-start gap-1 ${isActive ? "bg-blue-200" : hasUnread ? "bg-yellow-50" : ""}`}
              onClick={() => setOther(c.partner)}
              title={c.lastBody}
            >
              <div className="relative shrink-0">
                <Avatar username={c.partner} size={28} />
                {hasUnread && (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 px-1 flex items-center justify-center border border-white">
                    {c.unread > 9 ? "9+" : c.unread}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={`truncate ${hasUnread ? "font-bold" : "font-semibold"}`}>{c.partner}</span>
                  <span className="text-[9px] text-gray-500 shrink-0">{fmtTime(c.lastAt)}</span>
                </div>
                <div className={`truncate text-[10px] ${hasUnread ? "text-black font-semibold" : "text-gray-600"}`}>
                  {c.lastBody || <span className="italic text-gray-400">no messages</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex flex-col ml-1 min-w-0">
        {other && (
          <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold flex items-center gap-1">
            <Avatar username={other} size={16} />
            <span className="truncate">{other}</span>
          </div>
        )}
        <div ref={scroll} className="flex-1 win98-inset bg-white p-1 overflow-auto">
          {!other ? <div className="text-gray-500">Select a conversation from the inbox.</div> :
            msgs.length === 0 ? <div className="text-gray-500">No messages yet — say hi!</div> :
              msgs.map(m => (
                <div key={m.id} className={`mb-0.5 ${m.fromUser === user.username ? "text-right" : ""}`}>
                  <span className="font-bold">{m.fromUser === user.username ? "you" : m.fromUser}:</span> {m.body}
                </div>
              ))}
        </div>
        {other && (
          <div className="flex gap-1 mt-1">
            <input className="win98-inset px-1 flex-1" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={`Message ${other}…`} />
            <button className="win98-button px-2" onClick={send}>Send</button>
          </div>
        )}
      </div>
    </div>
  );
}
