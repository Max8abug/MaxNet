import { useEffect, useRef, useState } from "react";
import {
  fetchChat, postChat, clearChat, deleteChatMessage,
  fetchChatAudit, fetchBans, addBan, removeBan, pingTyping, fetchTyping,
  type ChatMessage, type ChatAuditEntry, type BannedUser,
} from "../lib/api";
import { useAuth, userColor } from "../lib/auth-store";
import { Avatar } from "./Avatar";
import { showFullscreen } from "./ImageViewer";
import { pushToast } from "./Toast";

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
  const [videoData, setVideoData] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const lastSeenIdRef = useRef<number>(0);
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const isAdmin = !!user?.isAdmin;

  const [tab, setTab] = useState<Tab>("chat");
  const [audit, setAudit] = useState<ChatAuditEntry[]>([]);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [banName, setBanName] = useState("");
  const [banReason, setBanReason] = useState("");

  async function refresh() {
    try {
      const m = await fetchChat();
      // Toast about new messages from others (not own, not first load)
      if (lastSeenIdRef.current > 0 && document.visibilityState === "visible") {
        const fresh = m.filter(x => x.id > lastSeenIdRef.current && x.author !== user?.username);
        fresh.slice(-3).forEach(x => pushToast(`${x.author}`, x.body || (x.imageUrl ? "[image]" : x.videoUrl ? "[video]" : "")));
      }
      if (m.length) lastSeenIdRef.current = Math.max(lastSeenIdRef.current, ...m.map(x => x.id));
      setMessages(m);
    } catch {}
  }
  async function refreshAdmin() {
    if (!isAdmin) return;
    try { setAudit(await fetchChatAudit()); } catch {}
    try { setBans(await fetchBans()); } catch {}
  }

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [user?.username]);
  useEffect(() => { const t = setInterval(async () => { setTyping((await fetchTyping()).filter(u => u !== user?.username)); }, 2500); return () => clearInterval(t); }, [user?.username]);
  useEffect(() => { if (!isAdmin) { setTab("chat"); return; } void refreshAdmin(); }, [isAdmin]);
  useEffect(() => { if (tab === "chat") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length, tab]);

  function onTypeChange(v: string) {
    setText(v);
    if (user && v.trim()) pingTyping();
  }

  async function send() {
    if ((!text.trim() && !imageData && !videoData) || sending) return;
    if (!user) { onRequestLogin?.(); return; }
    setSending(true); setErr(null);
    try {
      await postChat(text, imageData, videoData, replyTo?.id ?? null);
      setText(""); setImageData(null); setVideoData(null); setReplyTo(null);
      await refresh();
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setSending(false); }
  }

  async function pickImage(file: File) { try { setImageData(await fileToImageData(file)); } catch { setErr("Image failed"); } }
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
    if (name === "Max8abug") return "#cc0000";
    return undefined; // we colorize only for users in messages list — Avatar already shows ring; would need user lookup. Keep simple.
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
          <div ref={scrollRef} className="flex-1 win98-inset bg-white p-1 overflow-auto text-xs">
            {messages.length === 0 ? (
              <div className="text-gray-500">No messages yet.</div>
            ) : (
              messages.map((m) => {
                const replied = m.replyTo ? messages.find(x => x.id === m.replyTo) : null;
                return (
                  <div key={m.id} className="mb-2 flex items-start gap-2 group">
                    <Avatar username={m.author} size={36} />
                    <div className="flex-1 break-words">
                      <div className="flex items-baseline gap-1">
                        <span className="font-bold" style={{ color: authorColor(m.author) }}>{m.author}</span>
                        <span className="text-[10px] text-gray-500">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        {user && m.author !== user.username && (
                          <button className="win98-button px-1 text-[10px] opacity-0 group-hover:opacity-100" onClick={() => { setReplyTo(m); setText(`@${m.author} `); }}>reply</button>
                        )}
                      </div>
                      {replied && (
                        <div className="text-[10px] border-l-2 border-blue-400 pl-1 my-0.5 text-gray-600 italic truncate">↪ {replied.author}: {replied.body || "[media]"}</div>
                      )}
                      {m.body && <div>{m.body}</div>}
                      {m.imageUrl && (
                        <div className="mt-0.5">
                          <img src={m.imageUrl} alt="" className="max-w-[260px] max-h-[200px] win98-inset cursor-zoom-in" onClick={() => showFullscreen(m.imageUrl!)} />
                        </div>
                      )}
                      {m.videoUrl && (
                        <video src={m.videoUrl} controls className="max-w-[260px] max-h-[200px] mt-0.5 win98-inset" />
                      )}
                    </div>
                    {isAdmin && m.author !== "Max8abug" && (
                      <span className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                        <button className="win98-button px-1 text-[10px]" onClick={() => deleteOne(m.id)}>x</button>
                        <button className="win98-button px-1 text-[10px]" onClick={() => quickBan(m.author)}>ban</button>
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
                <button className="win98-button px-3" disabled={sending} onClick={send}>Send</button>
              </div>
              {isAdmin && <button className="win98-button px-2 mt-1 self-start text-red-700 text-xs" onClick={clearAll}>Clear All Messages</button>}
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
                <span className="text-gray-500">{new Date(e.createdAt).toLocaleString()}</span>{" "}
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
                    <div className="text-[10px] text-gray-500">banned by {b.bannedBy} on {new Date(b.createdAt).toLocaleDateString()}</div>
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
