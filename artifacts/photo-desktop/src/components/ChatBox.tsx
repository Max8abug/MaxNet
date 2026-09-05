import { useEffect, useRef, useState } from "react";
import {
  fetchChatPage, fetchChatRoomStatuses, postChat, clearChat, deleteChatMessage,
  fetchChatAudit, fetchBans, addBan, removeBan, fetchChatMutes, addChatMute, removeChatMute, updateChatCooldown,
  pingTyping, fetchTyping,
  CHAT_ROOMS, type ChatRoom, type ChatRoomStatus, type ChatMessage, type ChatAuditEntry, type BannedUser, type ChatMute,
} from "../lib/api";
import { useAuth, userColor, hasPermission } from "../lib/auth-store";
import { Avatar, getCachedAvatar, getCachedUser } from "./Avatar";
import { showFullscreen } from "./ImageViewer";
import { pushToast } from "./Toast";
import { formatLocalTime, formatLocalDate } from "../lib/dates";

interface Props { onRequestLogin?: () => void; }
type Tab = "chat" | "audit" | "bans" | "mutes";

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
  const [room, setRoom] = useState<ChatRoom>("lobby");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [roomStatuses, setRoomStatuses] = useState<ChatRoomStatus[]>([]);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const lastSeenIdRef = useRef<Record<string, number>>({});
  const roomRef = useRef<ChatRoom>("lobby");
  const sendTimerRef = useRef<number | null>(null);
  const sendCountdownTimerRef = useRef<number | null>(null);
  const [sendCountdown, setSendCountdown] = useState(0);
  const [sendCooldown, setSendCooldown] = useState(false);
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const siteSettings = useAuth((s) => s.siteSettings);
  const refreshSiteSettings = useAuth((s) => s.refreshSiteSettings);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const isAdmin = !!user?.isAdmin;
  const canDelete = !!user && (isAdmin || hasPermission(user, "deleteMessages", ranks));
  const canBan = !!user && (isAdmin || hasPermission(user, "ban", ranks));

  const [tab, setTab] = useState<Tab>("chat");
  const [audit, setAudit] = useState<ChatAuditEntry[]>([]);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [banName, setBanName] = useState("");
  const [banReason, setBanReason] = useState("");
  const [mutes, setMutes] = useState<ChatMute[]>([]);
  const [muteName, setMuteName] = useState("");
  const [muteReason, setMuteReason] = useState("");
  const [cooldownSaving, setCooldownSaving] = useState(false);

  function roomSeenKey(name: ChatRoom): string {
    return `chatRoomLastSeen:${name}`;
  }

  function markRoomSeen(name: ChatRoom, messageId: number) {
    if (!messageId) return;
    const previous = Number(localStorage.getItem(roomSeenKey(name)) || "0");
    if (messageId > previous) localStorage.setItem(roomSeenKey(name), String(messageId));
  }

  async function refresh(activeRoom = roomRef.current) {
    try {
      const page = await fetchChatPage(activeRoom);
      const m = page.messages;
      if (activeRoom !== roomRef.current) return;
      // Toast about new messages from others (not own, not first load)
      const lastSeen = lastSeenIdRef.current[activeRoom] || 0;
      if (lastSeen > 0 && document.visibilityState === "visible") {
        const fresh = m.filter(x => x.id > lastSeen && x.author !== user?.username);
        fresh.slice(-3).forEach(x => pushToast(`${x.author}`, x.body || (x.imageUrl ? "[image]" : x.videoUrl ? "[video]" : "")));
      }
      if (m.length) lastSeenIdRef.current[activeRoom] = Math.max(lastSeen, ...m.map(x => x.id));
      setMessages((current) => {
        const merged = new Map(current.map((message) => [message.id, message]));
        m.forEach((message) => merged.set(message.id, message));
        return [...merged.values()].sort((a, b) => a.id - b.id).slice(-180);
      });
      setHasMore(page.hasMore || hasMore);
      if (activeRoom === room) markRoomSeen(activeRoom, Math.max(...m.map(x => x.id), 0));
    } catch {}
  }
  async function refreshRoomStatuses() {
    try {
      const statuses = await fetchChatRoomStatuses();
      setRoomStatuses(statuses);
      statuses.forEach((status) => {
        const seen = Number(localStorage.getItem(roomSeenKey(status.room)) || "0");
        if (!seen) markRoomSeen(status.room, status.latestMessageId);
      });
      const current = statuses.find((status) => status.room === roomRef.current);
      if (current) markRoomSeen(current.room, current.latestMessageId);
    } catch {}
  }
  async function refreshAdmin() {
    if (isAdmin) {
      try { setAudit(await fetchChatAudit()); } catch {}
      try { setBans(await fetchBans()); } catch {}
    }
    if (canBan) {
      try { setMutes(await fetchChatMutes()); } catch {}
    }
  }

  useEffect(() => { void refreshRanks(); }, [refreshRanks]);
  useEffect(() => {
    roomRef.current = room;
    setMessages([]);
    setHasMore(false);
    void refresh(room);
    void refreshRoomStatuses();
    const t = setInterval(() => {
      void refresh(room);
      void refreshRoomStatuses();
    }, 4000);
    return () => clearInterval(t);
  }, [room, user?.username]);
  useEffect(() => {
    const t = setInterval(async () => {
      setTyping((await fetchTyping(roomRef.current)).filter(u => u !== user?.username));
    }, 2500);
    return () => clearInterval(t);
  }, [user?.username]);
  useEffect(() => {
    if (!isAdmin && !canBan) { setTab("chat"); return; }
    void refreshAdmin();
  }, [isAdmin, canBan]);
  useEffect(() => { if (tab === "chat" && !loadingOlder) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length, tab]);
  useEffect(() => () => {
    if (sendTimerRef.current !== null) window.clearTimeout(sendTimerRef.current);
    if (sendCountdownTimerRef.current !== null) window.clearInterval(sendCountdownTimerRef.current);
  }, []);

  function onTypeChange(v: string) {
    setText(v);
    if (user && v.trim()) pingTyping(room);
  }

  async function send() {
    if ((!text.trim() && !imageData && !videoData) || sending || sendCooldown) return;
    if (!user) { onRequestLogin?.(); return; }
    const sendRoom = room;
    const sendText = text;
    const sendImage = imageData;
    const sendVideo = videoData;
    const sendReply = replyTo?.id ?? null;
    setSending(true); setErr(null);
    try {
      await postChat(sendText, sendImage, sendVideo, sendReply, sendRoom);
      if (siteSettings.chatCooldownEnabled) {
        setSendCooldown(true);
        setSendCountdown(5);
        const started = Date.now();
        sendCountdownTimerRef.current = window.setInterval(() => {
          setSendCountdown(Math.max(0, Math.ceil((5000 - (Date.now() - started)) / 1000)));
        }, 250);
        sendTimerRef.current = window.setTimeout(() => {
          if (sendCountdownTimerRef.current !== null) {
            window.clearInterval(sendCountdownTimerRef.current);
            sendCountdownTimerRef.current = null;
          }
          sendTimerRef.current = null;
          setSendCooldown(false);
          setSendCountdown(0);
        }, 5000);
      }
      setText(""); setImageData(null); setVideoData(null); setGifUrl(""); setReplyTo(null);
      await refresh(sendRoom);
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setSending(false); }
  }

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || !hasMore || loadingOlder) return;
    const scroll = scrollRef.current;
    const oldHeight = scroll?.scrollHeight || 0;
    setLoadingOlder(true);
    try {
      const page = await fetchChatPage(room, oldest.id);
      if (room !== roomRef.current) return;
      setMessages((current) => {
        const merged = new Map(page.messages.map((message) => [message.id, message]));
        current.forEach((message) => merged.set(message.id, message));
        return [...merged.values()].sort((a, b) => a.id - b.id).slice(-180);
      });
      setHasMore(page.hasMore);
      window.setTimeout(() => {
        if (scroll) scroll.scrollTop += scroll.scrollHeight - oldHeight;
      }, 0);
    } catch {} finally { setLoadingOlder(false); }
  }

  function handleScroll() {
    if ((scrollRef.current?.scrollTop || 0) < 32) void loadOlder();
  }

  async function pickImage(file: File) { try { setImageData(await fileToImageData(file)); } catch { setErr("Image failed"); } }
  function addGifLink() {
    const value = gifUrl.trim();
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const isTenor = host === "tenor.com" || host.endsWith(".tenor.com") || host === "tenor.co";
      if ((url.protocol !== "http:" && url.protocol !== "https:") || (!/\.gif(?:$|[?#])/i.test(url.href) && !isTenor)) {
        throw new Error();
      }
      setImageData(url.toString());
      setGifUrl("");
      setErr(null);
    } catch {
      setErr("Use a direct GIF link or a Tenor share link.");
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
  async function quickMute(username: string) {
    const reason = prompt(`Mute ${username} in chat? Optional reason:`, "");
    if (reason === null) return;
    try { await addChatMute(username, reason); await refreshAdmin(); }
    catch (e: any) { alert(e?.message || "Failed"); }
  }
  async function submitMute() {
    const u = muteName.trim(); if (!u) return;
    try {
      await addChatMute(u, muteReason);
      setMuteName("");
      setMuteReason("");
      await refreshAdmin();
    } catch (e: any) { alert(e?.message || "Failed"); }
  }
  async function unmute(username: string) {
    try { await removeChatMute(username); await refreshAdmin(); } catch {}
  }
  async function toggleCooldown(enabled: boolean) {
    setCooldownSaving(true);
    try {
      await updateChatCooldown(enabled);
      await refreshSiteSettings();
    } catch (e: any) {
      alert(e?.message || "Could not update chat cooldown");
    } finally {
      setCooldownSaving(false);
    }
  }

  function authorColor(name: string): string | undefined {
    const cached = getCachedUser(name);
    return userColor(cached || { username: name }, ranks) || undefined;
  }

  function roomIsActive(status: ChatRoomStatus): boolean {
    const seen = Number(localStorage.getItem(roomSeenKey(status.room)) || "0");
    return status.typing.length > 0 || status.latestMessageId > seen;
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      <div className="flex gap-1 mb-1 shrink-0 overflow-x-auto" aria-label="Chat rooms">
        {CHAT_ROOMS.map((chatRoom) => {
          const status = roomStatuses.find((entry) => entry.room === chatRoom.id);
          const active = status ? roomIsActive(status) : false;
          return (
            <button
              key={chatRoom.id}
              className={`win98-button px-2 py-0.5 text-xs whitespace-nowrap flex items-center gap-1 ${room === chatRoom.id ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
              onClick={() => { if (!sending && room !== chatRoom.id) setRoom(chatRoom.id); }}
              disabled={sending}
              title={active ? `${chatRoom.label} has new activity` : `${chatRoom.label} has no new activity`}
            >
              <span className={`inline-block w-2 h-2 rounded-full border border-black/40 ${active ? "bg-green-500" : "bg-red-600"}`} />
              {chatRoom.label}
            </button>
          );
        })}
      </div>
      {(isAdmin || canBan) && (
        <div className="flex gap-1 mb-1 shrink-0">
          {(["chat", ...(isAdmin ? ["audit", "bans"] : []), ...(canBan ? ["mutes"] : [])] as Tab[]).map((t) => (
            <button key={t}
              className={`win98-button px-2 py-0.5 text-xs ${tab === t ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
              onClick={() => { setTab(t); if (t !== "chat") void refreshAdmin(); }}>
              {t === "chat"
                ? "Chat"
                : t === "audit"
                  ? `Audit (${audit.length.toLocaleString()})`
                  : t === "bans"
                    ? `Bans (${bans.length})`
                    : `Mutes (${mutes.length})`}
            </button>
          ))}
        </div>
      )}

      {tab === "chat" && (
        <>
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 win98-inset bg-white p-1 overflow-auto text-xs">
            {hasMore && (
              <button className="win98-button w-full mb-2 text-[10px]" onClick={() => void loadOlder()} disabled={loadingOlder}>
                {loadingOlder ? "Loading older messages…" : "Scroll up or click to load older messages"}
              </button>
            )}
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
                        <div className="text-[10px] border-l-2 border-blue-400 pl-1 my-0.5 text-gray-600 italic truncate">↪ {replied ? `${replied.author}: ${replied.body || "[media]"}` : `message #${m.replyTo}`}</div>
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
                        {canBan && <button className="win98-button px-1 text-[10px]" onClick={(e) => { e.stopPropagation(); void quickMute(m.author); }}>mute</button>}
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
                  value={text} onChange={(e) => onTypeChange(e.target.value)} disabled={sending}
                  onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
                <input ref={fileRef} type="file" accept="image/*,image/gif" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ""; }} />
                <input ref={videoRef} type="file" accept="video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickVideo(f); e.target.value = ""; }} />
                <button className="win98-button px-2" title="Attach image" onClick={() => fileRef.current?.click()}>📎</button>
                <button className="win98-button px-2" title="Attach video" onClick={() => videoRef.current?.click()}>🎥</button>
                <button className="win98-button px-3" disabled={sending || sendCooldown} onClick={send}>
                  {sending ? "Sending…" : sendCooldown ? `Send in ${sendCountdown}s` : "Send"}
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

      {tab === "mutes" && canBan && (
        <div className="flex-1 flex flex-col gap-1 overflow-hidden">
          <div className="flex-1 win98-inset bg-white p-1 overflow-auto text-xs">
            {mutes.length === 0 ? <div className="text-gray-500">No muted users.</div> :
              mutes.map((mute) => (
                <div key={mute.id} className="flex items-center gap-1 border-b border-dashed border-gray-300 py-0.5">
                  <div className="flex-1">
                    <span className="font-bold">{mute.username}</span>
                    {mute.reason && <span className="text-gray-600"> — {mute.reason}</span>}
                    <div className="text-[10px] text-gray-500">muted by {mute.mutedBy} on {formatLocalDate(mute.createdAt, { dateStyle: "short" })}</div>
                  </div>
                  <button className="win98-button px-1 text-[10px]" onClick={() => void unmute(mute.username)}>unmute</button>
                </div>
              ))}
          </div>
          <div className="shrink-0 flex flex-col gap-1">
            <label className="flex items-start gap-1 border-b border-gray-300 pb-1 mb-1">
              <input
                type="checkbox"
                checked={siteSettings.chatCooldownEnabled}
                disabled={cooldownSaving}
                onChange={(e) => void toggleCooldown(e.target.checked)}
              />
              <span>
                <span className="font-bold block">5-second cooldown</span>
                <span className="text-[10px] text-gray-600">Applies after each successful message.</span>
              </span>
            </label>
            <input className="win98-inset px-1 text-xs" placeholder="username to mute" value={muteName} onChange={(e) => setMuteName(e.target.value)} />
            <input className="win98-inset px-1 text-xs" placeholder="reason (optional)" value={muteReason} onChange={(e) => setMuteReason(e.target.value)} />
            <button className="win98-button px-2 self-end text-xs" onClick={() => void submitMute()}>Mute User</button>
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
