import { useEffect, useRef, useState } from "react";
import {
  fetchChat, postChat, clearChat, deleteChatMessage,
  fetchChatAudit, fetchBans, addBan, removeBan,
  type ChatMessage, type ChatAuditEntry, type BannedUser,
} from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { Avatar } from "./Avatar";

interface Props { onRequestLogin?: () => void; }
type Tab = "chat" | "audit" | "bans";

function fileToImageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      // GIFs: keep as-is. Others: re-encode/resize.
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

export function ChatBox({ onRequestLogin }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);
  const isAdmin = !!user?.isAdmin;

  const [tab, setTab] = useState<Tab>("chat");
  const [audit, setAudit] = useState<ChatAuditEntry[]>([]);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [banName, setBanName] = useState("");
  const [banReason, setBanReason] = useState("");

  async function refresh() { try { setMessages(await fetchChat()); } catch {} }
  async function refreshAdmin() {
    if (!isAdmin) return;
    try { setAudit(await fetchChatAudit()); } catch {}
    try { setBans(await fetchBans()); } catch {}
  }

  useEffect(() => { void refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!isAdmin) { setTab("chat"); return; } void refreshAdmin(); }, [isAdmin]);
  useEffect(() => { if (tab === "chat") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages.length, tab]);

  async function send() {
    if ((!text.trim() && !imageData) || sending) return;
    if (!user) { onRequestLogin?.(); return; }
    setSending(true); setErr(null);
    try {
      await postChat(text, imageData);
      setText(""); setImageData(null);
      await refresh();
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setSending(false); }
  }

  async function pickImage(file: File) {
    try { const d = await fileToImageData(file); setImageData(d); }
    catch { setErr("Image failed"); }
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
              messages.map((m) => (
                <div key={m.id} className="mb-1 flex items-start gap-1 group">
                  <Avatar username={m.author} size={20} />
                  <div className="flex-1 break-words">
                    <span className={`font-bold ${m.author === "Max8abug" ? "text-red-700" : ""}`}>{m.author}:</span>{" "}
                    <span>{m.body}</span>
                    {m.imageUrl && (
                      <div className="mt-0.5">
                        <img src={m.imageUrl} alt="" className="max-w-[240px] max-h-[180px] win98-inset" />
                      </div>
                    )}
                  </div>
                  {isAdmin && m.author !== "Max8abug" && (
                    <span className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                      <button className="win98-button px-1 text-[10px]" onClick={() => deleteOne(m.id)}>x</button>
                      <button className="win98-button px-1 text-[10px]" onClick={() => quickBan(m.author)}>ban</button>
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          {err && <div className="text-red-700 text-[11px] mt-0.5">{err}</div>}
          {user ? (
            <>
              {imageData && (
                <div className="flex items-center gap-1 mt-1 shrink-0">
                  <img src={imageData} alt="" className="max-h-12 win98-inset" />
                  <button className="win98-button px-1 text-[10px]" onClick={() => setImageData(null)}>remove</button>
                </div>
              )}
              <div className="flex gap-1 mt-1 shrink-0">
                <input
                  type="text"
                  className="win98-inset px-1 flex-1"
                  placeholder={`Message as ${user.username}...`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
                />
                <input ref={fileRef} type="file" accept="image/*,image/gif" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ""; }} />
                <button className="win98-button px-2" title="Attach image/gif" onClick={() => fileRef.current?.click()}>📎</button>
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
