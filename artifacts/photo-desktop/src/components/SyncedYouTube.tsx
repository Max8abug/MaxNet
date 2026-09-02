import { useEffect, useMemo, useRef, useState } from "react";
import { fetchChat, getYouTubeSync, postChat, type ChatMessage, setYouTubeSync } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { formatLocalTime, parseServerDate } from "../lib/dates";

function parseYouTubeId(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "embed" || p === "shorts");
      if (idx >= 0 && parts[idx + 1] && /^[A-Za-z0-9_-]{11}$/.test(parts[idx + 1])) return parts[idx + 1];
    }
  } catch {}
  return null;
}

interface Props { onRequestLogin?: () => void; }

export function SyncedYouTube({ onRequestLogin }: Props) {
  const [state, setState] = useState<{ videoId: string; startedAt: string; setBy: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const user = useAuth((s) => s.user);

  async function refresh() {
    try {
      const s = await getYouTubeSync();
      const serverMs = parseServerDate(s.serverNow).getTime();
      offsetRef.current = serverMs - Date.now();
      setState((prev) => {
        if (prev && prev.videoId === s.videoId && prev.startedAt === s.startedAt && prev.setBy === s.setBy) return prev;
        return { videoId: s.videoId, startedAt: s.startedAt, setBy: s.setBy };
      });
    } catch {}
  }
  async function refreshChat() {
    try {
      const all = await fetchChat();
      setMessages(all.slice(-30));
    } catch {}
  }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 15000); return () => clearInterval(t); }, []);
  useEffect(() => { void refreshChat(); const t = setInterval(refreshChat, 4000); return () => clearInterval(t); }, []);

  async function applyNew() {
    setErr(null);
    const id = parseYouTubeId(input);
    if (!id) { setErr("Couldn't parse a YouTube URL or ID"); return; }
    try { await setYouTubeSync(id); setInput(""); await refresh(); }
    catch (e: any) { setErr(e?.message || "Failed"); }
  }

  async function sendChat() {
    if (!user) { onRequestLogin?.(); return; }
    const body = chatText.trim();
    if (!body) return;
    setChatErr(null);
    try {
      const sent = await postChat(body);
      setMessages((current) => [...current, sent].slice(-30));
      setChatText("");
    } catch (e: any) { setChatErr(e?.message || "Failed to send"); }
  }

  // Compute initial elapsed once when videoId/startedAt changes; src is stable after that.
  const src = useMemo(() => {
    if (!state?.videoId) return null;
    const startMs = parseServerDate(state.startedAt).getTime();
    const elapsed = Math.max(0, Math.floor(((Date.now() + offsetRef.current) - startMs) / 1000));
    return `https://www.youtube.com/embed/${state.videoId}?autoplay=1&start=${elapsed}&rel=0`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.videoId, state?.startedAt]);

  return (
    <div className="w-full h-full flex flex-col text-sm bg-black">
      <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        {src ? (
          <iframe
            key={`${state?.videoId}-${state?.startedAt}`}
            src={src}
            className="w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
          />
        ) : (
          <div className="text-gray-400 text-xs">No video. {user ? "Set one below." : "Log in to set."}</div>
        )}
      </div>
      <div className="h-[38%] min-h-[120px] bg-[#c0c0c0] p-1 shrink-0 flex flex-col gap-1">
        <div className="font-bold text-[11px] text-gray-800">Site chat</div>
        <div className="flex-1 min-h-0 win98-inset bg-white overflow-auto p-1 text-[10px]">
          {messages.length === 0 ? <div className="text-gray-500">No messages yet.</div> : messages.map((m) => (
            <div key={m.id} className="mb-1 break-words">
              <span className="font-bold">{m.author}</span>{" "}
              <span className="text-gray-500">{formatLocalTime(m.createdAt)}</span>
              <div>{m.body || (m.imageUrl ? "[image]" : "[media]")}</div>
            </div>
          ))}
        </div>
        {user ? (
          <div className="flex gap-1">
            <input
              className="win98-inset px-1 flex-1 text-[11px]"
              placeholder="Say something…"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void sendChat(); }}
              maxLength={500}
            />
            <button className="win98-button px-2 text-[10px]" onClick={() => void sendChat()}>Send</button>
          </div>
        ) : (
          <button className="win98-button px-2 text-[10px] self-start" onClick={onRequestLogin}>Log in to chat</button>
        )}
        {chatErr && <div className="text-red-700 text-[10px]">{chatErr}</div>}
        {state?.setBy && <div className="text-[10px] text-gray-700">Now playing — set by {state.setBy} (synced for everyone)</div>}
        {user ? (
          <div className="flex gap-1">
            <input
              className="win98-inset px-1 flex-1 text-xs"
              placeholder="Paste YouTube URL or video ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void applyNew(); }}
            />
            <button className="win98-button px-2 text-xs" onClick={applyNew}>Play For All</button>
          </div>
        ) : (
          <div className="text-[10px] text-gray-600">Log in to change the video for everyone.</div>
        )}
        {err && <div className="text-red-700 text-[11px]">{err}</div>}
      </div>
    </div>
  );
}
