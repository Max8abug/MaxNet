import { useEffect, useRef, useState } from "react";
import { fetchChat, postChat, type ChatMessage } from "../lib/api";

export function ChatBox() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(() => localStorage.getItem("pd-chat-name") || "anon");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const m = await fetchChat();
      setMessages(m);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    localStorage.setItem("pd-chat-name", author);
  }, [author]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await postChat(body, author);
      setText("");
      await refresh();
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      <div ref={scrollRef} className="flex-1 win98-inset bg-white p-1 overflow-auto font-mono text-xs">
        {messages.length === 0 ? (
          <div className="text-gray-500">No messages yet. Say hi.</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="mb-0.5 break-words">
              <span className="font-bold">{m.author}:</span> {m.body}
            </div>
          ))
        )}
      </div>
      <input
        type="text"
        className="win98-inset px-1 mt-1 shrink-0"
        placeholder="your name"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
      />
      <div className="flex gap-1 mt-1 shrink-0">
        <input
          type="text"
          className="win98-inset px-1 flex-1"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
        />
        <button className="win98-button px-3" disabled={sending} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
