import { useEffect, useRef, useState } from "react";
import {
  createDMGroup,
  deleteDMMessage,
  fetchDMContacts,
  fetchDMConversations,
  fetchDMGroupMessages,
  fetchDMReports,
  fetchDMs,
  markDMGroupRead,
  markDMsRead,
  reportDM,
  sendDM,
  sendDMGroup,
  updateDMReport,
  type DMContact,
  type DMConversation,
  type DMMessage,
  type DMReport,
} from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
import { Avatar } from "./Avatar";
import { formatLocalDate, formatLocalTime, parseServerDate, siteDateKey } from "../lib/dates";
import { getServerNow } from "../lib/server-clock";
import { pushToast } from "./Toast";

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = parseServerDate(iso);
    const now = getServerNow();
    if (Number.isNaN(d.getTime())) return iso;
    if (siteDateKey(d) === siteDateKey(now)) return formatLocalTime(d);
    const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days < 7) return formatLocalDate(d, { weekday: "short" });
    return formatLocalDate(d, { year: "numeric", month: "numeric", day: "numeric" });
  } catch { return iso; }
}

export function DMs({ initialPeer }: { initialPeer?: string } = {}) {
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const [convos, setConvos] = useState<DMConversation[]>([]);
  const [contacts, setContacts] = useState<DMContact[]>([]);
  const [other, setOther] = useState<string | null>(initialPeer ?? null);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState("");
  const [msgs, setMsgs] = useState<DMMessage[]>([]);
  const [text, setText] = useState("");
  const [showContacts, setShowContacts] = useState(false);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<DMReport[]>([]);
  const [showReports, setShowReports] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const reportCountRef = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => { if (initialPeer) { setOther(initialPeer); setGroupId(null); } }, [initialPeer]);
  useEffect(() => { void refreshRanks(); }, [refreshRanks]);

  async function loadConversations() {
    try { setConvos(await fetchDMConversations()); } catch {}
  }
  useEffect(() => {
    void loadConversations();
    const timer = setInterval(loadConversations, 5000);
    return () => clearInterval(timer);
  }, []);

  async function loadActive() {
    if (groupId !== null) {
      try {
        const result = await fetchDMGroupMessages(groupId);
        setGroupName(result.group.name);
        setMsgs(result.messages);
        await markDMGroupRead(groupId);
      } catch (e: any) { setError(e?.message || "Could not load group"); }
    } else if (other) {
      try {
        setMsgs(await fetchDMs(other));
        await markDMsRead(other);
      } catch (e: any) { setError(e?.message || "Could not load conversation"); }
    } else {
      setMsgs([]);
    }
    void loadConversations();
  }
  useEffect(() => {
    void loadActive();
    const timer = (groupId !== null || other) ? setInterval(loadActive, 4000) : undefined;
    return () => { if (timer) clearInterval(timer); };
  }, [groupId, other]);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [msgs.length, groupId, other]);

  async function openContactPicker() {
    setShowContacts((value) => !value);
    if (contacts.length === 0) {
      try { setContacts(await fetchDMContacts()); } catch {}
    }
  }
  async function openGroupCreator() {
    setShowGroupCreate((value) => !value);
    setShowContacts(false);
    if (contacts.length === 0) {
      try { setContacts(await fetchDMContacts()); } catch {}
    }
  }
  function openDirect(username: string) {
    setOther(username);
    setGroupId(null);
    setShowContacts(false);
    setShowGroupCreate(false);
    setError(null);
  }
  function openGroup(id: number, name: string) {
    setGroupId(id);
    setGroupName(name);
    setOther(null);
    setShowContacts(false);
    setShowGroupCreate(false);
    setError(null);
  }
  async function createGroup() {
    if (!newGroupName.trim() || selectedMembers.length === 0) {
      setError("Choose a name and at least one other member.");
      return;
    }
    try {
      const created = await createDMGroup(newGroupName.trim(), selectedMembers);
      setNewGroupName("");
      setSelectedMembers([]);
      await loadConversations();
      openGroup(created.id, created.name);
    } catch (e: any) { setError(e?.message || "Could not create group"); }
  }
  async function send() {
    const body = text.trim();
    if ((!other && groupId === null) || !body) return;
    try {
      const sent = groupId !== null ? await sendDMGroup(groupId, body) : await sendDM(other!, body);
      setMsgs((current) => [...current, sent]);
      setText("");
      void loadConversations();
    } catch (e: any) { setError(e?.message || "Could not send message"); }
  }
  async function reportMessage(message: DMMessage) {
    const reason = window.prompt("Why are you reporting this message?", "");
    if (reason === null || !reason.trim()) return;
    setReportBusy(true);
    try {
      await reportDM(message.id, reason.trim(), message.groupId);
      setError("Report sent to the site moderators.");
    } catch (e: any) { setError(e?.message || "Could not report message"); }
    finally { setReportBusy(false); }
  }
  async function loadReports() {
    if (!user?.isAdmin) return;
    try {
      const next = await fetchDMReports();
      const openCount = next.filter((r) => r.status === "open").length;
      if (reportCountRef.current && openCount > reportCountRef.current) {
        pushToast("New DM report", "An administrator review is needed.");
      }
      reportCountRef.current = openCount;
      setReports(next);
    } catch {}
  }
  useEffect(() => {
    if (!user?.isAdmin) return;
    void loadReports();
    const timer = setInterval(loadReports, 5000);
    return () => clearInterval(timer);
  }, [user?.isAdmin]);
  async function setReportStatus(report: DMReport, status: DMReport["status"]) {
    try {
      const updated = await updateDMReport(report.id, status);
      setReports((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
    } catch (e: any) { setError(e?.message || "Could not update report"); }
  }
  async function removeReportedMessage(report: DMReport) {
    if (!report.messageId || !window.confirm("Delete this reported message?")) return;
    try {
      await deleteDMMessage(report.messageId);
      await setReportStatus(report, "reviewed");
      await loadReports();
      if (groupId !== null || other) void loadActive();
    } catch (e: any) { setError(e?.message || "Could not delete message"); }
  }

  if (!user) return <div className="p-2 text-xs">Log in to use DMs.</div>;
  if (!hasPermission(user, "dm", ranks)) return <div className="p-2 text-xs">DMs require VIP rank or higher. Ask an admin.</div>;

  const totalUnread = convos.reduce((sum, conversation) => sum + (conversation.unread || 0), 0);
  const knownPartners = new Set(convos.filter((c) => c.kind !== "group").map((c) => c.partner));
  const newContacts = contacts.filter((c) => c.username !== user.username && !knownPartners.has(c.username));
  const openReports = reports.filter((report) => report.status === "open").length;

  return (
    <div className="w-full h-full flex text-xs">
      <div className="w-48 shrink-0 win98-inset bg-white overflow-auto flex flex-col">
        <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold flex items-center justify-between">
          <span>Inbox{totalUnread > 0 ? ` (${totalUnread})` : ""}</span>
          <span className="flex gap-1">
            <button className="win98-button px-1 text-black text-[10px]" onClick={() => void openContactPicker()}>+ new</button>
            <button className="win98-button px-1 text-black text-[10px]" onClick={() => void openGroupCreator()}>+ group</button>
          </span>
        </div>
        {showContacts && (
          <div className="border-b border-[#808080] bg-[#f4f4f4] max-h-32 overflow-auto">
            <div className="px-1 py-0.5 text-[10px] text-gray-700">Start a chat with…</div>
            {newContacts.length === 0 && <div className="px-1 pb-1 text-[10px] text-gray-500">No other contactable users.</div>}
            {newContacts.map((contact) => (
              <button key={contact.username} className="w-full text-left px-1 py-0.5 hover:bg-blue-100 flex items-center gap-1" onClick={() => openDirect(contact.username)}>
                <Avatar username={contact.username} size={18} /><span className="truncate">{contact.username}</span>
              </button>
            ))}
          </div>
        )}
        {showGroupCreate && (
          <div className="border-b border-[#808080] bg-[#f4f4f4] p-1">
            <input className="win98-inset w-full px-1 mb-1" placeholder="Group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
            <div className="text-[10px] mb-1">Select members:</div>
            <div className="max-h-24 overflow-auto">
              {contacts.filter((contact) => contact.username !== user.username).map((contact) => (
                <label key={contact.username} className="flex items-center gap-1">
                  <input type="checkbox" checked={selectedMembers.includes(contact.username)} onChange={(e) => setSelectedMembers((current) => e.target.checked ? [...current, contact.username] : current.filter((name) => name !== contact.username))} />
                  <span>{contact.username}</span>
                </label>
              ))}
            </div>
            <button className="win98-button px-1 mt-1" onClick={() => void createGroup()}>Create Group</button>
          </div>
        )}
        {convos.length === 0 && !showContacts && !showGroupCreate && <div className="p-2 text-gray-500 text-[10px]">No conversations yet.</div>}
        {convos.map((conversation) => {
          const isGroup = conversation.kind === "group";
          const active = isGroup ? groupId === conversation.groupId : groupId === null && other === conversation.partner;
          const unread = (conversation.unread || 0) > 0 && !active;
          return (
            <button key={isGroup ? `group-${conversation.groupId}` : conversation.partner} className={`w-full text-left px-1 py-1 border-b border-gray-200 hover:bg-blue-50 flex items-start gap-1 ${active ? "bg-blue-200" : unread ? "bg-yellow-50" : ""}`} onClick={() => isGroup ? openGroup(conversation.groupId!, conversation.groupName || "Group") : openDirect(conversation.partner)} title={conversation.lastBody}>
              <div className="relative shrink-0">{isGroup ? <div className="w-7 h-7 bg-[#808080] text-white flex items-center justify-center font-bold">#</div> : <Avatar username={conversation.partner} size={28} />}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={`truncate ${unread ? "font-bold" : "font-semibold"}`}>{isGroup ? `# ${conversation.groupName}` : conversation.partner}</span>
                  <span className="text-[9px] text-gray-500 shrink-0">{fmtTime(conversation.lastAt)}</span>
                </div>
                <div className={`truncate text-[10px] ${unread ? "text-black font-semibold" : "text-gray-600"}`}>{conversation.lastBody || <span className="italic text-gray-400">no messages</span>}</div>
              </div>
            </button>
          );
        })}
        {user.isAdmin && (
          <button className={`mt-auto border-t border-gray-400 px-1 py-1 text-left font-bold ${showReports ? "bg-yellow-200" : "bg-yellow-50"}`} onClick={() => { setShowReports((value) => !value); void loadReports(); }}>
            Admin reports {openReports > 0 && <span className="text-red-700">({openReports})</span>}
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col ml-1 min-w-0">
        {showReports && user.isAdmin ? (
          <div className="flex-1 win98-inset bg-white p-1 overflow-auto">
            <div className="flex items-center justify-between bg-[#000080] text-white px-1 py-0.5 text-[10px] font-bold">
              <span>DM reports ({openReports} open)</span><button className="win98-button px-1 text-black" onClick={() => void loadReports()}>Refresh</button>
            </div>
            {reports.length === 0 ? <div className="p-2 text-gray-500">No reports yet.</div> : reports.map((report) => (
              <div key={report.id} className="border-b border-dashed border-gray-400 py-1">
                <div><b>#{report.id}</b> {report.status} — reported by <b>{report.reporter}</b> on {fmtTime(report.createdAt)}</div>
                <div className="text-red-800">Reason: {report.reason}</div>
                {report.message && <div className="win98-inset bg-yellow-50 p-1 mt-1">Message from <b>{report.message.fromUser}</b>: {report.message.body}</div>}
                <div className="flex gap-1 mt-1">
                  {report.status === "open" && <><button className="win98-button px-1" onClick={() => void setReportStatus(report, "reviewed")}>Mark reviewed</button><button className="win98-button px-1" onClick={() => void setReportStatus(report, "dismissed")}>Dismiss</button></>}
                  {report.messageId && <button className="win98-button px-1 text-red-700" onClick={() => void removeReportedMessage(report)}>Delete message</button>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {(other || groupId !== null) && <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold flex items-center gap-1"><span>{groupId !== null ? `# ${groupName}` : other}</span>{groupId !== null && <span className="font-normal">group thread</span>}</div>}
            <div ref={scroll} className="flex-1 win98-inset bg-white p-1 overflow-auto">
              {!other && groupId === null ? <div className="text-gray-500">Select a conversation from the inbox.</div> : msgs.length === 0 ? <div className="text-gray-500">No messages yet — say hi!</div> : msgs.map((message) => (
                <div key={message.id} className={`mb-1 group ${message.fromUser === user.username ? "text-right" : ""}`}>
                  <span className="font-bold">{message.fromUser === user.username ? "you" : message.fromUser}:</span> {message.body}
                  <button className="ml-1 opacity-0 group-hover:opacity-100 text-[9px] text-gray-600 underline" disabled={reportBusy} onClick={() => void reportMessage(message)}>report</button>
                  <div className="text-[9px] text-gray-500">{fmtTime(message.createdAt)}</div>
                </div>
              ))}
            </div>
            {(other || groupId !== null) && (
              <div className="flex gap-1 mt-1">
                <input className="win98-inset px-1 flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder={groupId !== null ? `Message #${groupName}…` : `Message ${other}…`} maxLength={1000} />
                <button className="win98-button px-2" onClick={() => void send()}>Send</button>
              </div>
            )}
          </>
        )}
        {error && <div className="text-red-700 text-[10px] mt-1">{error}</div>}
      </div>
    </div>
  );
}