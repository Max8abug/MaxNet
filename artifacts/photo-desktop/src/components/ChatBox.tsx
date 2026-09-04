import { useEffect, useRef, useState } from "react";
import {
  fetchChat, postChat, clearChat, deleteChatMessage,
  fetchChatAudit, fetchBans, addBan, removeBan, pingTyping, fetchTyping,
  type ChatMessage, type ChatAuditEntry, type BannedUser,
} from "../lib/api";
import { useAuth, userColor, hasPermission } from "../lib/auth-store";
import { Avatar, getCachedAvatar, getCachedUser } from "./Avatar";
import { showFullscreen } from "./ImageViewer";
import { pushToast } from "./Toast";
import { formatLocalTime, formatLocalDate } from "../lib/dates";

interface Props { onRequestLogin?: () => void; }
type Tab = "chat" | "audit" | "bans";

function fileToImageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (file.type === "image/gif") { resolve(r.result as string); return; }
      const img = new Image();
      img.onload = () => {
        const max = 800;
        const c = document.createElement("canvas");
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = r.result as string;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });
}

export function ChatBox({ onRequestLogin }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [gifUrl, setGifUrl] = useState("");
  const [videoData, setVideoData] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [typing, setTyping] = useState<string[]>([]);
  const [typingRooms, setTypingRooms] = useState<Record<number, boolean>>({});
  const [room, setRoom] = useState(1);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [roomActivity, setRoomActivity] = useState<Record<number, string | null>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const lastSeenIdRef = useRef<number>(0);
  const beforeCursorRef = useRef<number | undefined>(undefined);
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const isAdmin = !!user?.isAdmin;
  const canDelete = !!user && (isAdmin || hasPermission(user, "deleteMessages", ranks));
  const canBan = !!user && (isAdmin || hasPermission(user, "ban", ranks));

  const [tab, setTab] = useState<Tab>("chat");
  const [audit, setAudit] = useState<ChatAuditEntry[]>([]);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [banName, setBanName] = useState("");
  const [banReason, setBanReason] = useState("");

  async function refresh(initial = false) {
    try {
      const m = await fetchChat(room, 50);
      // Toast about new messages from others (not own, not first load)
      if (lastSeenIdRef.current > 0 && document.visibilityState === "visible") {
        const fresh = m.filter(x => x.id > lastSeenIdRef.current && x.author !== user?.username);
        fresh.slice(-3).forEach(x => pushToast(`${x.author}`, x.body || (x.imageUrl ? "[image]" : x.videoUrl ? "[video]" : "")));
      }
      if (m.length) lastSeenIdRef.current = Math.max(lastSeenIdRef.current, ...m.map(x => x.id));
      setMessages(current => {
        if (initial || current.length === 0) return m;
        const merged = new Map(current.map(x => [x.id, x]));
        m.forEach(x => merged.set(x.id, x));
        return Array.from(merged.values()).filter(x => x.room === room).sort((a, b) => a.id - b.id).slice(-300);
      });
    } catch {}
  }
  async function loadOlder() {
    if (loadingOlder || !messages.length) return;
    const el = scrollRef.current;
    if (!el) return;
    setLoadingOlder(true);
    const previousHeight = el.scrollHeight;
    const oldest = beforeCursorRef.current ?? messages[0]!.id;
    try {
      const older = await fetchChat(room, 50, oldest);
      if (older.length) {
        beforeCursorRef.current = older[0]!.id;
        setMessages(current => {
          const merged = new Map([...older, ...current].map(x => [x.id, x]));
          return Array.from(merged.values()).sort((a, b) => a.id - b.id).slice(-300);
        });
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop += scrollRef.current.scrollHeight - previousHeight; });
      }
    } catch {} finally { setLoadingOlder(false); }
  }
  async function refreshRoomActivity() {
    try {
      const latest = await Promise.all([1, 2, 3, 4].map(n => fetchChat(n, 1)));
      setRoomActivity(Object.fromEntries(latest.map((rows, i) => [i + 1, rows[0]?.createdAt || null])));
    } catch {}
  }
  async function refreshAdmin() {
    if (!isAdmin) return;
    try { setAudit(await fetchChatAudit()); } catch {}
    try { setBans(await fetchBans()); } catch {}
  }

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);
  useEffect(() => { setMessages([]); beforeCursorRef.current = undefined; void refresh(true); void refreshRoomActivity(); const t = setInterval(() => { void refresh(); void refreshRoomActivity(); }, 4000); return () => clearInterval(t); }, [user?.username, room]);
  useEffect(() => {
    const poll = async () => {
      const values = await Promise.all([1, 2, 3, 4].map(n => fetchTyping(n)));
      setTyping(values[room - 1]!.filter(u => u !== user?.username));
      setTypingRooms(Object.fromEntries(values.map((users, i) => [i + 1, users.some(u => u !== user?.username)])));
    };
    void poll();
    const t = setInterval(() => void poll(), 2500);
    return () => clearInterval(t);
  }, [user?.username, room]);
  useEffect(() => { if (!isAdmin) { setTab("chat"); return; } void refreshAdmin(); }, [isAdmin]);
  useEffect(() => { if (tab === "chat") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length, tab]);

  useEffect(() => {
    const timer = window.setInterval(() => setCooldownUntil(value => value > Date.now() ? value : 0), 250);
    return () => window.clearInterval(timer);
  }, []);

  function onTypeChange(v: string) {
    setText(v);
    if (user && v.trim()) pingTyping(room);
  }

  async function send() {
    if ((!text.trim() && !imageData && !videoData) || sending) return;
    if (!user) { onRequestLogin?.(); return; }
    setSending(true); setErr(null);
    try {
       await postChat(text, imageData, videoData, replyTo?.id ?? null, room);
      setText(""); setImageData(null); setVideoData(null); setGifUrl(""); setReplyTo(null);
      await refresh();
    } catch (e: any) {
      if (e?.retryAfterMs) setCooldownUntil(Date.now() + e.retryAfterMs);
      setErr(e?.message || "Failed");
    }
    finally { setSending(false); }
  }

  async function pickImage(file: File) { try { setImageData(await fileToImageData(file)); } catch { setErr("Image failed"); } }
  function addGifLink() {
    const value = gifUrl.trim();
    try {
      const url = new URL(value);
       const host = url.hostname.toLowerCase();
       if ((url.protocol !== "http:" && url.protocol !== "https:") ||
           !(host === "media.tenor.com" || host === "tenor.com" || host === "www.tenor.com")) {
        throw new Error();
      }
      setImageData(url.toString());
      setGifUrl("");
      setErr(null);
    } catch {
       setErr("Use a Tenor GIF link (share links are supported).");
    }
  }
  async function pickVideo(file: File) {
    if (file.size > 9_000_000) { setErr("Video too large (max ~9MB)"); return; }
    try { setVideoData(await fileToDataUrl(file)); } catch { setErr("Video failed"); }
  }

  async function clearAll() {
    if (!confirm("Clear ALL chat messages?")) return;
    try { await clearChat(); await refresh(); await refreshAdmin(); } catch {}
  }
  async function deleteOne(id: number) {
    try { await deleteChatMessage(id); await refresh(); await refreshAdmin(); } catch {}
  }
  async function quickBan(username: string) {
    const reason = prompt(`Ban ${username}? Optional reason:`, "");
    if (reason === null) return;
    try { await addBan(username, reason); await refreshAdmin(); }
    catch (e: any) { alert(e?.message || "Failed"); }
  }
  async function submitBan() {
    const u = banName.trim(); if (!u) return;
    try { await addBan(u, banReason); setBanName(""); setBanReason(""); await refreshAdmin(); }
    catch (e: any) { alert(e?.message || "Failed"); }
  }
  async function unban(username: string) { try { await removeBan(username); await refreshAdmin(); } catch {} }

  function authorColor(name: string): string | undefined {
    const cached = getCachedUser(name);
    return userColor(cached || { username: name }, ranks) || undefined;
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      {isAdmin && (
        <div className="flex gap-1 mb-1 shrink-0">
          {(["chat", "audit", "bans"] as Tab[]).map((t) => (
            <button key={t}
              className={`win98-button px-2 py-0.5 text-xs ${tab === t ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
              onClick={() => { setTab(t); if (t !== "chat") void refreshAdmin(); }}>
              {t === "chat" ? "Chat" : t === "audit" ? `Audit (${audit.length})` : `Bans (${bans.length})`}
            </button>
          ))}
        </div>
      )}

      {tab === "chat" && (
        <>
           <div className="flex gap-1 mb-1 shrink-0">
             {[1, 2, 3, 4].map((n) => {
               const active = !!typingRooms[n] || (!!roomActivity[n] && Date.now() - new Date(roomActivity[n]!).getTime() < 30_000);
               return <button key={n} className={`win98-button px-2 text-xs ${room === n ? "font-bold" : ""}`} onClick={() => setRoom(n)}>
                 <span className={`inline-block w-2 h-2 rounded-full mr-1 ${active ? "bg-green-600" : "bg-red-600"}`} />Room {n}
               </button>;
             })}
           </div>
           <div ref={scrollRef} onScroll={(e) => { if (e.currentTarget.scrollTop < 20) void loadOlder(); }} className="flex-1 win98-inset bg-white p-1 overflow-auto text-xs">
            {messages.length === 0 ? (
              <div className="text-gray-500">No messages yet.</div>
            ) : (
              messages.map((m) => {
                const replied = m.replyTo ? messages.find(x => x.id === m.replyTo) : null;
                const canReply = !!user && m.author !== user.username;
                return (
                  <div key={m.id}
                    className={`mb-2 flex items-start gap-2 group rounded-sm pr-1 ${canReply ? "cursor-pointer hover:bg-blue-50/60" : ""}`}
                    onClick={() => { if (canReply) { setReplyTo(m); setText(`@${m.author} `); } }}
                    title={canReply ? "Click to reply" : undefined}>
                    <Avatar username={m.author} size={48} onClick={() => {
                      const av = getCachedAvatar(m.author);
                      if (av) showFullscreen(av);
                    }} />
                    <div className="flex-1 break-words">
                      <div className="flex items-baseline gap-1">
                        <span className="font-bold" style={{ color: authorColor(m.author) }}>{m.author}</span>
                        <span className="text-[10px] text-gray-500">{formatLocalTime(m.createdAt)}</span>
                        {canReply && (
                          <button className="win98-button px-1 text-[10px] opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setReplyTo(m); setText(`@${m.author} `); }}>reply</button>
                        )}
                      </div>
                      {replied && (
                        <div className="text-[10px] border-l-2 border-blue-400 pl-1 my-0.5 text-gray-600 italic truncate">↪ {replied.author}: {replied.body || "[media]"}</div>
                      )}
                      {m.body && <div>{m.body}</div>}
                      {m.imageUrl && (
                        <div className="mt-0.5">
                          <img src={m.imageUrl} alt="" className="max-w-[260px] max-h-[200px] win98-inset cursor-zoom-in" onClick={(e) => { e.stopPropagation(); showFullscreen(m.imageUrl!); }} />
                        </div>
                      )}
                      {m.videoUrl && (
                        <video src={m.videoUrl} controls className="max-w-[260px] max-h-[200px] mt-0.5 win98-inset" onClick={(e) => e.stopPropagation()} />
                      )}
                    </div>
                    {(canDelete || canBan) && m.author !== "Max8abug" && m.author !== user?.username && (
                      <span className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                        {canDelete && <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); deleteOne(m.id); }}>x</button>}
                        {canBan && <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); quickBan(m.author); }}>ban</button>}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="text-[10px] text-gray-500 h-4 shrink-0">{typing.length > 0 && `${typing.slice(0, 3).join(", ")} ${typing.length === 1 ? "is" : "are"} typing…`}</div>
          {err && <div className="text-red-700 text-[11px] mt-0.5">{err}</div>}
          {user ? (
            <>
              {replyTo && (
                <div className="flex items-center gap-1 win98-inset bg-yellow-50 px-1 text-[11px] shrink-0">
                  <span className="flex-1 truncate">↪ Replying to {replyTo.author}: {replyTo.body || "[media]"}</span>
                  <button className="win98-button px-1 text-[10px]" onClick={() => setReplyTo(null)}>x</button>
                </div>
              )}
              {(imageData || videoData) && (
                <div className="flex items-center gap-1 mt-1 shrink-0">
                  {imageData && <img src={imageData} alt="" className="max-h-12 win98-inset" />}
                  {videoData && <video src={videoData} className="max-h-12 win98-inset" />}
                  <button className="win98-button px-1 text-[10px]" onClick={() => { setImageData(null); setVideoData(null); }}>remove</button>
                </div>
              )}
              <div className="flex gap-1 mt-1 shrink-0">
                <input
                  type="url"
                  className="win98-inset px-1 flex-1 min-w-0 text-xs"
                  placeholder="Paste a direct .gif link"
                  value={gifUrl}
                  onChange={(e) => setGifUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGifLink(); } }}
                />
                <button className="win98-button px-2 text-xs" type="button" onClick={addGifLink}>Add GIF</button>
              </div>
              <div className="flex gap-1 mt-1 shrink-0">
                <input type="text" className="win98-inset px-1 flex-1"
                  placeholder={`Message as ${user.username}...`}
                  value={text} onChange={(e) => onTypeChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
                <input ref={fileRef} type="file" accept="image/*,image/gif" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ""; }} />
                <input ref={videoRef} type="file" accept="video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickVideo(f); e.target.value = ""; }} />
                <button className="win98-button px-2" title="Attach image" onClick={() => fileRef.current?.click()}>📎</button>
                <button className="win98-button px-2" title="Attach video" onClick={() => videoRef.current?.click()}>🎥</button>
                   <button className="win98-button px-3" disabled={sending || cooldownUntil > Date.now()} onClick={send}>
                     {cooldownUntil > Date.now() ? `Wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s` : "Send"}
                   </button>
              </div>
              <div className="flex items-center gap-1 mt-1">
                {isAdmin && (
                  exporting ? (
                    <button className="win98-button px-2 text-xs" type="button" disabled>
                      Exporting…
                    </button>
                  ) : (
                    <a
                      className="win98-button px-2 text-xs"
                      href="/api/chat/export"
                      onClick={() => {
                        setExporting(true);
                        setErr(null);
                        setArchiveStatus("Chat archive download started. Check your browser downloads.");
                        window.setTimeout(() => setExporting(false), 1500);
                      }}
                      title="Download all chat messages and attached media as a ZIP archive"
                    >
                      Export Chat ZIP
                    </a>
                  )
                )}
                {canDelete && <button className="win98-button px-2 text-red-700 text-xs" onClick={clearAll}>Clear All Messages</button>}
              </div>
              {archiveStatus && <div className="text-green-700 text-[11px] mt-0.5">{archiveStatus}</div>}
            </>
          ) : (
            <button className="win98-button px-2 py-1 mt-1 shrink-0" onClick={onRequestLogin}>Log in to chat</button>
          )}
        </>
      )}

      {tab === "audit" && isAdmin && (
        <div className="flex-1 win98-inset bg-white p-1 overflow-auto font-mono text-[11px]">
          <div className="flex justify-between mb-1 sticky top-0 bg-white">
            <span className="font-bold">Chat history (newest first)</span>
            <button className="win98-button px-1 text-[10px]" onClick={refreshAdmin}>Refresh</button>
          </div>
          {audit.length === 0 ? <div className="text-gray-500">No activity yet.</div> :
            audit.map((e) => (
              <div key={e.id} className="border-b border-dashed border-gray-300 py-0.5 break-words">
                <span className="text-gray-500">{formatLocalDate(e.createdAt)}</span>{" "}
                <span className={tagColor(e.action)}>[{e.action}]</span>{" "}
                <span className="font-bold">{e.actor}</span>
                {e.target && <> → <span className="font-bold">{e.target}</span></>}
                {e.body && <>: <span className="text-gray-800">{e.body}</span></>}
              </div>
            ))}
        </div>
      )}

      {tab === "bans" && isAdmin && (
        <div className="flex-1 flex flex-col gap-1 overflow-hidden">
          <div className="flex-1 win98-inset bg-white p-1 overflow-auto text-xs">
            {bans.length === 0 ? <div className="text-gray-500">No bans yet.</div> :
              bans.map((b) => (
                <div key={b.id} className="flex items-center gap-1 border-b border-dashed border-gray-300 py-0.5">
                  <div className="flex-1">
                    <span className="font-bold">{b.username}</span>
                    {b.reason && <span className="text-gray-600"> — {b.reason}</span>}
                    <div className="text-[10px] text-gray-500">banned by {b.bannedBy} on {formatLocalDate(b.createdAt, { dateStyle: "short" })}</div>
                  </div>
                  <button className="win98-button px-1 text-[10px]" onClick={() => unban(b.username)}>unban</button>
                </div>
              ))}
          </div>
          <div className="shrink-0 flex flex-col gap-1">
            <input className="win98-inset px-1 text-xs" placeholder="username to ban" value={banName} onChange={(e) => setBanName(e.target.value)} />
            <input className="win98-inset px-1 text-xs" placeholder="reason (optional)" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
            <button className="win98-button px-2 self-end text-xs" onClick={submitBan}>Ban User</button>
          </div>
        </div>
      )}
    </div>
  );
}

function tagColor(action: string): string {
  switch (action) {
    case "post": return "text-blue-700";
    case "delete": return "text-orange-700";
    case "clear": return "text-red-700 font-bold";
    case "ban": return "text-red-700 font-bold";
    case "unban": return "text-green-700";
    case "blocked": return "text-purple-700";
    default: return "text-gray-700";
  }
}
