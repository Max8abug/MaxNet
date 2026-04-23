import { useEffect, useRef, useState } from "react";
import { fetchChat, postChat, clearChat, type ChatMessage } from "../lib/api";
import { useAuth } from "../lib/auth-store";

interface Props { onRequestLogin?: () => void; }

export function ChatBox({ onRequestLogin }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);

  async function refresh() {
    try { setMessages(await fetchChat()); } catch {}
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    if (!user) { onRequestLogin?.(); return; }
    setSending(true); setErr(null);
    try {
      await postChat(body);
      setText("");
      await refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally { setSending(false); }
  }

  async function clearAll() {
    if (!confirm("Clear ALL chat messages? This cannot be undone.")) return;
    try { await clearChat(); await refresh(); } catch {}
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      <div ref={scrollRef} className="flex-1 win98-inset bg-white p-1 overflow-auto font-mono text-xs">
        {messages.length === 0 ? (
          <div className="text-gray-500">No messages yet. Say hi.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="mb-0.5 break-words">
              <span className={`font-bold ${m.author === "Max8abug" ? "text-red-700" : ""}`}>{m.author}:</span> {m.body}
            </div>
          ))
        )}
      </div>
      {err && <div className="text-red-700 text-[11px] mt-0.5">{err}</div>}
      {user ? (
        <>
          <div className="flex gap-1 mt-1 shrink-0">
            <input
              type="text"
              className="win98-inset px-1 flex-1"
              placeholder={`Message as ${user.username}...`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
            />
            <button className="win98-button px-3" disabled={sending} onClick={send}>
              Send
            </button>
          </div>
          {user.isAdmin && (
            <button className="win98-button px-2 mt-1 self-start text-red-700" onClick={clearAll}>
              Clear All Messages (admin)
            </button>
          )}
        </>
      ) : (
        <button className="win98-button px-2 py-1 mt-1 shrink-0" onClick={onRequestLogin}>
          Log in to chat
        </button>
      )}
    </div>
  );
}
