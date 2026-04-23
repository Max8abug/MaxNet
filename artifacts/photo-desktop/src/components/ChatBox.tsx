import { useEffect, useRef, useState } from "react";
import {
  fetchChat, postChat, clearChat, deleteChatMessage,
  fetchChatAudit, fetchBans, addBan, removeBan,
  type ChatMessage, type ChatAuditEntry, type BannedUser,
} from "../lib/api";
import { useAuth } from "../lib/auth-store";

interface Props { onRequestLogin?: () => void; }

type Tab = "chat" | "audit" | "bans";

export function ChatBox({ onRequestLogin }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);
  const isAdmin = !!user?.isAdmin;

  const [tab, setTab] = useState<Tab>("chat");
  const [audit, setAudit] = useState<ChatAuditEntry[]>([]);
  const [bans, setBans] = useState<BannedUser[]>([]);
  const [banName, setBanName] = useState("");
  const [banReason, setBanReason] = useState("");

  async function refresh() {
    try { setMessages(await fetchChat()); } catch {}
  }
  async function refreshAdmin() {
    if (!isAdmin) return;
    try { setAudit(await fetchChatAudit()); } catch {}
    try { setBans(await fetchBans()); } catch {}
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isAdmin) { setTab("chat"); return; }
    void refreshAdmin();
  }, [isAdmin]);

  useEffect(() => {
    if (tab === "chat") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, tab]);

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
    if (!confirm("Clear ALL chat messages? This is logged in the audit log.")) return;
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
    const u = banName.trim();
    if (!u) return;
    try {
      await addBan(u, banReason);
      setBanName(""); setBanReason("");
      await refreshAdmin();
    } catch (e: any) { alert(e?.message || "Failed"); }
  }

  async function unban(username: string) {
    try { await removeBan(username); await refreshAdmin(); } catch {}
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      {isAdmin && (
        <div className="flex gap-1 mb-1 shrink-0">
          {(["chat", "audit", "bans"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`win98-button px-2 py-0.5 text-xs ${tab === t ? "shadow-[inset_1px_1px_#808080] border-t-black border-l-black border-r-white border-b-white" : ""}`}
              onClick={() => { setTab(t); if (t !== "chat") void refreshAdmin(); }}
            >
              {t === "chat" ? "Chat" : t === "audit" ? `Audit (${audit.length})` : `Bans (${bans.length})`}
            </button>
          ))}
        </div>
      )}

      {tab === "chat" && (
        <>
          <div ref={scrollRef} className="flex-1 win98-inset bg-white p-1 overflow-auto font-mono text-xs">
            {messages.length === 0 ? (
              <div className="text-gray-500">No messages yet. Say hi.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="mb-0.5 break-words group flex items-start gap-1">
                  <div className="flex-1">
                    <span className={`font-bold ${m.author === "Max8abug" ? "text-red-700" : ""}`}>{m.author}:</span> {m.body}
                  </div>
                  {isAdmin && m.author !== "Max8abug" && (
                    <span className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                      <button className="win98-button px-1 text-[10px]" title="Delete message" onClick={() => deleteOne(m.id)}>x</button>
                      <button className="win98-button px-1 text-[10px]" title="Ban user" onClick={() => quickBan(m.author)}>ban</button>
                    </span>
                  )}
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
                <button className="win98-button px-3" disabled={sending} onClick={send}>Send</button>
              </div>
              {isAdmin && (
                <button className="win98-button px-2 mt-1 self-start text-red-700 text-xs" onClick={clearAll}>
                  Clear All Messages
                </button>
              )}
            </>
          ) : (
            <button className="win98-button px-2 py-1 mt-1 shrink-0" onClick={onRequestLogin}>
              Log in to chat
            </button>
          )}
        </>
      )}

      {tab === "audit" && isAdmin && (
        <div className="flex-1 win98-inset bg-white p-1 overflow-auto font-mono text-[11px]">
          <div className="flex justify-between mb-1 sticky top-0 bg-white">
            <span className="font-bold">History (newest first)</span>
            <button className="win98-button px-1 text-[10px]" onClick={refreshAdmin}>Refresh</button>
          </div>
          {audit.length === 0 ? (
            <div className="text-gray-500">No activity yet.</div>
          ) : (
            audit.map((e) => (
              <div key={e.id} className="border-b border-dashed border-gray-300 py-0.5 break-words">
                <span className="text-gray-500">{new Date(e.createdAt).toLocaleString()}</span>{" "}
                <span className={tagColor(e.action)}>[{e.action}]</span>{" "}
                <span className="font-bold">{e.actor}</span>
                {e.target && <> → <span className="font-bold">{e.target}</span></>}
                {e.body && <>: <span className="text-gray-800">{e.body}</span></>}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "bans" && isAdmin && (
        <div className="flex-1 flex flex-col gap-1 overflow-hidden">
          <div className="flex-1 win98-inset bg-white p-1 overflow-auto text-xs">
            {bans.length === 0 ? (
              <div className="text-gray-500">No bans yet.</div>
            ) : (
              bans.map((b) => (
                <div key={b.id} className="flex items-center gap-1 border-b border-dashed border-gray-300 py-0.5">
                  <div className="flex-1">
                    <span className="font-bold">{b.username}</span>
                    {b.reason && <span className="text-gray-600"> — {b.reason}</span>}
                    <div className="text-[10px] text-gray-500">
                      banned by {b.bannedBy} on {new Date(b.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <button className="win98-button px-1 text-[10px]" onClick={() => unban(b.username)}>unban</button>
                </div>
              ))
            )}
          </div>
          <div className="shrink-0 flex flex-col gap-1">
            <input
              className="win98-inset px-1 text-xs"
              placeholder="username to ban"
              value={banName}
              onChange={(e) => setBanName(e.target.value)}
            />
            <input
              className="win98-inset px-1 text-xs"
              placeholder="reason (optional)"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
            />
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
