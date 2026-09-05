import { useEffect, useMemo, useRef, useState } from "react";
import {
  addYouTubeQueue,
  fetchChat,
  getYouTubeSync,
  postChat,
  removeYouTubeQueueItem,
  reorderYouTubeQueue,
  setYouTubeSync,
  type ChatMessage,
  type YouTubeSync,
  voteYouTubeSkip,
} from "../lib/api";
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
  const [state, setState] = useState<YouTubeSync | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [queueInput, setQueueInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [chatPercent, setChatPercent] = useState(() => {
    if (typeof window === "undefined") return 38;
    const stored = Number(localStorage.getItem("youtubeChatPercent"));
    return Number.isFinite(stored) ? Math.max(22, Math.min(68, stored)) : 38;
  });
  const offsetRef = useRef(0);
  const syncEpochRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const user = useAuth((s) => s.user);

  function adoptState(next: YouTubeSync) {
    const serverMs = parseServerDate(next.serverNow).getTime();
    offsetRef.current = serverMs - Date.now();
    setState(next);
  }

  async function refresh() {
    const requestEpoch = syncEpochRef.current;
    try {
      const next = await getYouTubeSync();
      // A poll that started before a queue/vote mutation must not put the
      // player back into its older state after the mutation succeeds.
      if (requestEpoch === syncEpochRef.current) adoptState(next);
    } catch {}
  }
  async function refreshChat() {
    try {
      const all = await fetchChat();
      setMessages(all.slice(-30));
    } catch {}
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    void refreshChat();
    const t = setInterval(() => void refreshChat(), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    localStorage.setItem("youtubeChatPercent", String(chatPercent));
  }, [chatPercent]);

  async function applySyncMutation(request: () => Promise<YouTubeSync>) {
    const mutationEpoch = ++syncEpochRef.current;
    const next = await request();
    // A later mutation wins. Older responses must not remount the iframe or
    // restore an earlier queue after another tab/action has already changed it.
    if (mutationEpoch === syncEpochRef.current) {
      adoptState(next);
      // Also invalidate polls that began while this mutation was in flight.
      syncEpochRef.current += 1;
    }
  }

  async function applyNew() {
    setErr(null);
    if (!user) { onRequestLogin?.(); return; }
    if (!state?.canManage) {
      setErr("You need the YouTube Master permission to play a video for everyone.");
      return;
    }
    const id = parseYouTubeId(input);
    if (!id) { setErr("Couldn't parse a YouTube URL or ID"); return; }
    setQueueBusy(true);
    try {
      await applySyncMutation(() => setYouTubeSync(id));
      setInput("");
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setQueueBusy(false); }
  }

  async function addToQueue() {
    if (!user) { onRequestLogin?.(); return; }
    setErr(null);
    const id = parseYouTubeId(queueInput);
    if (!id) { setErr("Couldn't parse a YouTube URL or ID"); return; }
    setQueueBusy(true);
    try {
      await applySyncMutation(() => addYouTubeQueue(id));
      setQueueInput("");
    } catch (e: any) { setErr(e?.message || "Could not add video to queue"); }
    finally { setQueueBusy(false); }
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

  async function vote(vote: "skip" | "keep") {
    if (!user) { onRequestLogin?.(); return; }
    setQueueBusy(true); setErr(null);
    try {
      await applySyncMutation(() => voteYouTubeSkip(vote));
    } catch (e: any) { setErr(e?.message || "Could not record vote"); }
    finally { setQueueBusy(false); }
  }

  async function moveQueueItem(index: number, direction: -1 | 1) {
    if (!state?.canManage || !state.queue[index]) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.queue.length) return;
    const ids = state.queue.map((item) => item.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    setQueueBusy(true); setErr(null);
    try {
      await applySyncMutation(() => reorderYouTubeQueue(ids));
    } catch (e: any) { setErr(e?.message || "Could not reorder queue"); }
    finally { setQueueBusy(false); }
  }

  async function removeQueueItem(id: string) {
    setQueueBusy(true); setErr(null);
    try {
      await applySyncMutation(() => removeYouTubeQueueItem(id));
    } catch (e: any) { setErr(e?.message || "Could not remove queue item"); }
    finally { setQueueBusy(false); }
  }

  function beginResize(e: React.PointerEvent<HTMLDivElement>) {
    resizingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function resizeChat(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const next = ((rect.bottom - e.clientY) / rect.height) * 100;
    setChatPercent(Math.max(22, Math.min(68, next)));
  }
  function endResize() {
    resizingRef.current = false;
  }

  const src = useMemo(() => {
    if (!state?.videoId) return null;
    const startMs = parseServerDate(state.startedAt).getTime();
    const elapsed = Math.max(0, Math.floor(((Date.now() + offsetRef.current) - startMs) / 1000));
    return `https://www.youtube.com/embed/${state.videoId}?autoplay=1&start=${elapsed}&rel=0`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.videoId, state?.startedAt]);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col text-sm bg-black select-none">
      <div className="flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        {src ? (
          <iframe
            key={`${state?.videoId}-${state?.startedAt}`}
            src={src}
            className="w-full h-full"
            allow="autoplay; encrypted-media"
            allowFullScreen
            title="Synced YouTube player"
          />
        ) : (
          <div className="text-gray-400 text-xs">No video. {user ? "Add one below." : "Log in to add one."}</div>
        )}
      </div>

      <div
        className="h-1 shrink-0 bg-[#808080] border-y border-[#404040] cursor-row-resize"
        title="Drag to resize chat"
        onPointerDown={beginResize}
        onPointerMove={resizeChat}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />

      <div
        className="bg-[#c0c0c0] p-1 shrink-0 flex flex-col gap-1 overflow-hidden"
        style={{ height: `${chatPercent}%`, minHeight: "112px" }}
      >
        <div className="font-bold text-[11px] text-gray-800 flex items-center justify-between">
          <span>Site chat</span>
          <span className="font-normal text-[10px] text-gray-600">Drag divider to resize</span>
        </div>
        <div className="flex-1 min-h-[34px] win98-inset bg-white overflow-auto p-1 text-[10px]">
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

        {state?.videoId && (
          <div className="border-t border-gray-500 pt-1 flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] text-gray-700">
              <span>Skip vote: {state.skipCount}/{state.totalVotes} (needs &gt; 2/3, 3+ votes)</span>
              <span>{state.myVote ? `You voted ${state.myVote}` : ""}</span>
            </div>
            <div className="flex gap-1">
              <button className="win98-button px-2 py-0.5 text-[10px]" disabled={queueBusy} onClick={() => void vote("skip")}>
                Vote to Skip
              </button>
              <button className="win98-button px-2 py-0.5 text-[10px]" disabled={queueBusy} onClick={() => void vote("keep")}>
                Vote to Keep
              </button>
            </div>
          </div>
        )}

        {state?.setBy && (
          <div className="text-[10px] text-gray-700">
            Now playing — set by {state.setBy} (synced for everyone)
          </div>
        )}
        <div className="flex gap-1">
          <input
            className="win98-inset px-1 flex-1 text-[10px]"
            placeholder="Paste URL or video ID to play now"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void applyNew(); }}
          />
          <button
            className="win98-button px-2 text-[10px]"
            disabled={!user || !state?.canManage || queueBusy}
            title={!user ? "Log in to play a video for everyone" : !state?.canManage ? "A rank administrator must enable YouTube Master for your rank" : "Start this video for everyone"}
            onClick={() => void applyNew()}
          >
            Play For All
          </button>
        </div>
        <div className="flex gap-1">
          <input
            className="win98-inset px-1 flex-1 text-[10px]"
            placeholder={user ? "Add URL or video ID to queue" : "Log in to add to queue"}
            value={queueInput}
            disabled={!user || queueBusy}
            onChange={(e) => setQueueInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void addToQueue(); }}
          />
          <button className="win98-button px-2 text-[10px]" disabled={!user || queueBusy} onClick={() => void addToQueue()}>
            Add Queue
          </button>
        </div>

        <div className="border-t border-gray-500 pt-1 min-h-0">
          <div className="flex items-center justify-between text-[10px] font-bold text-gray-700">
            <span>Up next ({state?.queue.length || 0})</span>
            <span className="font-normal">{state?.canManage ? "You can manage playback" : "Users can add"}</span>
          </div>
          <div className="max-h-[58px] overflow-auto win98-inset bg-white text-[10px]">
            {!state?.queue.length ? (
              <div className="px-1 py-0.5 text-gray-500">Queue is empty.</div>
            ) : state.queue.map((item, index) => (
              <div key={item.id} className="flex items-center gap-1 px-1 py-0.5 border-b border-gray-200 last:border-0">
                <span className="flex-1 truncate" title={`${item.videoId} added by ${item.addedBy}`}>
                  {index + 1}. {item.videoId} <span className="text-gray-500">({item.addedBy})</span>
                </span>
                {state.canManage && (
                  <>
                    <button className="win98-button px-1 leading-none" disabled={queueBusy || index === 0} onClick={() => void moveQueueItem(index, -1)} title="Move up">↑</button>
                    <button className="win98-button px-1 leading-none" disabled={queueBusy || index === state.queue.length - 1} onClick={() => void moveQueueItem(index, 1)} title="Move down">↓</button>
                    <button className="win98-button px-1 leading-none" disabled={queueBusy} onClick={() => void removeQueueItem(item.id)} title="Remove from queue">×</button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        {err && <div className="text-red-700 text-[10px]">{err}</div>}
      </div>
    </div>
  );
}