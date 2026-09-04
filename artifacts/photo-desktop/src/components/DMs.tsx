import { useEffect, useRef, useState } from "react";
import {
  createDMGroup,
  deleteDMMessage,
  fetchAllDMs,
  fetchDMContacts,
  fetchDMConversations,
  fetchDMGroupMessages,
  fetchDMGroups,
  fetchDMs,
  fetchDMReports,
  markDMGroupRead,
  markDMsRead,
  reportDM,
  resolveDMReport,
  sendDM,
  sendDMGroup,
  type DMContact,
  type DMConversation,
  type DMGroup,
  type DMMessage,
  type DMReport,
} from "../lib/api";
import { useAuth, hasPermission } from "../lib/auth-store";
import { Avatar } from "./Avatar";
import { formatLocalDate, formatLocalTime, parseServerDate, siteDateKey } from "../lib/dates";
import { getServerNow } from "../lib/server-clock";

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

type Selection = { kind: "direct"; username: string } | { kind: "group"; id: number };

export function DMs({ initialPeer }: { initialPeer?: string } = {}) {
  const user = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const [convos, setConvos] = useState<DMConversation[]>([]);
  const [groups, setGroups] = useState<DMGroup[]>([]);
  const [contacts, setContacts] = useState<DMContact[]>([]);
  const [selection, setSelection] = useState<Selection | null>(initialPeer ? { kind: "direct", username: initialPeer } : null);
  const [showContacts, setShowContacts] = useState(false);
  const [showGroupCreator, setShowGroupCreator] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [msgs, setMsgs] = useState<DMMessage[]>([]);
  const [text, setText] = useState("");
  const [adminTab, setAdminTab] = useState<"inbox" | "moderation">("inbox");
  const [reports, setReports] = useState<DMReport[]>([]);
  const [allMessages, setAllMessages] = useState<DMMessage[]>([]);
  const scroll = useRef<HTMLDivElement>(null);

  useEffect(() => { if (initialPeer) setSelection({ kind: "direct", username: initialPeer }); }, [initialPeer]);
  useEffect(() => { void refreshRanks(); }, [refreshRanks]);

  async function loadConversations() {
    try {
      const [direct, group] = await Promise.all([fetchDMConversations(), fetchDMGroups()]);
      setConvos(direct);
      setGroups(group);
    } catch {}
  }
  useEffect(() => {
    void loadConversations();
    const timer = setInterval(loadConversations, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selection) { setMsgs([]); return; }
    let alive = true;
    const tick = async () => {
      try {
        const next = selection.kind === "direct"
          ? await fetchDMs(selection.username)
          : await fetchDMGroupMessages(selection.id);
        if (alive) setMsgs(next);
        if (selection.kind === "direct") await markDMsRead(selection.username);
        else await markDMGroupRead(selection.id);
      } catch {}
      void loadConversations();
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [selection]);

  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); }, [msgs.length]);

  async function openContactPicker() {
    setShowContacts((value) => !value);
    if (!contacts.length) {
      try { setContacts(await fetchDMContacts()); } catch {}
    }
  }
  async function createGroup() {
    if (!groupName.trim() || groupMembers.length < 2) return;
    try {
      const group = await createDMGroup(groupName.trim(), groupMembers);
      setGroups((items) => [group, ...items]);
      setSelection({ kind: "group", id: group.id });
      setShowGroupCreator(false);
      setGroupName("");
      setGroupMembers([]);
    } catch (e: any) { window.alert(e?.message || "Could not create group"); }
  }
  async function send() {
    if (!selection || !text.trim()) return;
    try {
      if (selection.kind === "direct") await sendDM(selection.username, text);
      else await sendDMGroup(selection.id, text);
      setText("");
      const next = selection.kind === "direct"
        ? await fetchDMs(selection.username)
        : await fetchDMGroupMessages(selection.id);
      setMsgs(next);
      void loadConversations();
    } catch (e: any) { window.alert(e?.message || "Could not send message"); }
  }
  async function loadModeration() {
    if (!user?.isAdmin) return;
    try {
      const [nextReports, nextMessages] = await Promise.all([fetchDMReports(), fetchAllDMs()]);
      setReports(nextReports);
      setAllMessages(nextMessages);
    } catch {}
  }
  async function handleReport(message: DMMessage) {
    const reason = window.prompt("Why are you reporting this message?");
    if (reason === null) return;
    try { await reportDM(message.id, reason); window.alert("Message reported to the moderators."); }
    catch (e: any) { window.alert(e?.message || "Could not report message"); }
  }
  async function moderateReport(id: number, status: "resolved" | "dismissed") {
    try { await resolveDMReport(id, status); await loadModeration(); } catch {}
  }
  async function moderateDelete(id: number) {
    if (!window.confirm("Delete this DM message?")) return;
    try { await deleteDMMessage(id); await loadModeration(); } catch {}
  }

  if (!user) return <div className="p-2 text-xs">Log in to use DMs.</div>;
  if (!hasPermission(user, "dm", ranks)) return <div className="p-2 text-xs">DMs require VIP rank or higher. Ask an admin.</div>;

  const totalUnread = convos.reduce((sum, item) => sum + (item.unread || 0), 0)
    + groups.reduce((sum, item) => sum + (item.unread || 0), 0);
  const knownPartners = new Set(convos.map((item) => item.partner));
  const newContacts = contacts.filter((item) => item.username !== user.username && !knownPartners.has(item.username));
  const selectedGroup = selection?.kind === "group" ? groups.find((item) => item.id === selection.id) : null;
  const selectedDirect = selection?.kind === "direct" ? selection.username : null;

  return (
    <div className="w-full h-full flex flex-col text-xs">
      {user.isAdmin && (
        <div className="flex gap-1 mb-1 shrink-0">
          <button className={`win98-button px-2 ${adminTab === "inbox" ? "bg-blue-100" : ""}`} onClick={() => setAdminTab("inbox")}>Inbox</button>
          <button className={`win98-button px-2 ${adminTab === "moderation" ? "bg-blue-100" : ""}`} onClick={() => { setAdminTab("moderation"); void loadModeration(); }}>
            Moderation {reports.some((item) => item.status === "open") ? `(${reports.filter((item) => item.status === "open").length})` : ""}
          </button>
        </div>
      )}
      {adminTab === "moderation" && user.isAdmin ? (
        <div className="flex-1 min-h-0 flex flex-col gap-1">
          <div className="font-bold">DM reports</div>
          <div className="flex-1 win98-inset bg-white overflow-auto p-1">
            {!reports.length ? <div className="text-gray-500">No reports.</div> : reports.map((report) => (
              <div key={report.id} className="border-b border-gray-300 py-1">
                <div><b>Report from {report.reporter}</b> · {report.status} · {fmtTime(report.createdAt)}</div>
                <div className="text-gray-700">Reason: {report.reason || "No reason provided"}</div>
                <div className="bg-yellow-50 p-1 my-1">{report.message ? `${report.message.fromUser}: ${report.message.body}` : "Message was deleted"}</div>
                {report.status === "open" && (
                  <div className="flex gap-1">
                    <button className="win98-button px-1" onClick={() => void moderateReport(report.id, "resolved")}>Resolve</button>
                    <button className="win98-button px-1" onClick={() => void moderateReport(report.id, "dismissed")}>Dismiss</button>
                    {report.message && <button className="win98-button px-1 text-red-700" onClick={() => void moderateDelete(report.message!.id)}>Delete message</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="font-bold">Recent private messages</div>
          <div className="max-h-32 win98-inset bg-white overflow-auto p-1">
            {allMessages.map((message) => <div key={message.id} className="border-b border-gray-200"><b>{message.fromUser}</b> → <b>{message.toUser}</b>: {message.body}</div>)}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div className="w-44 shrink-0 win98-inset bg-white overflow-auto flex flex-col">
            <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold flex items-center justify-between">
              <span>Inbox{totalUnread > 0 ? ` (${totalUnread})` : ""}</span>
              <div className="flex gap-1">
                <button className="win98-button px-1 text-black text-[10px]" onClick={openContactPicker}>+ new</button>
                <button className="win98-button px-1 text-black text-[10px]" onClick={() => { setShowGroupCreator((value) => !value); if (!contacts.length) void fetchDMContacts().then(setContacts).catch(() => {}); }}>+ group</button>
              </div>
            </div>
            {showContacts && (
              <div className="border-b border-[#808080] bg-[#f4f4f4] max-h-32 overflow-auto">
                <div className="px-1 py-0.5 text-[10px] text-gray-700">Start a chat with…</div>
                {newContacts.length === 0 && <div className="px-1 pb-1 text-[10px] text-gray-500">No other contactable users.</div>}
                {newContacts.map((contact) => <button key={contact.username} className="w-full text-left px-1 py-0.5 hover:bg-blue-100 flex items-center gap-1" onClick={() => { setSelection({ kind: "direct", username: contact.username }); setShowContacts(false); }}>
                  <Avatar username={contact.username} size={18} /><span className="truncate">{contact.username}</span>
                </button>)}
              </div>
            )}
            {showGroupCreator && (
              <div className="border-b border-[#808080] bg-[#f4f4f4] p-1">
                <input className="win98-inset px-1 py-0.5 w-full mb-1" placeholder="Group name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                <div className="max-h-24 overflow-auto">
                  {contacts.filter((contact) => contact.username !== user.username).map((contact) => <label key={contact.username} className="flex items-center gap-1">
                    <input type="checkbox" checked={groupMembers.includes(contact.username)} onChange={(e) => setGroupMembers((items) => e.target.checked ? [...items, contact.username] : items.filter((name) => name !== contact.username))} />
                    <span>{contact.username}</span>
                  </label>)}
                </div>
                <button className="win98-button px-1 mt-1" disabled={!groupName.trim() || groupMembers.length < 2} onClick={() => void createGroup()}>Create group</button>
              </div>
            )}
            {convos.map((conversation) => {
              const active = selection?.kind === "direct" && selection.username === conversation.partner;
              return <button key={`direct-${conversation.partner}`} className={`w-full text-left px-1 py-1 border-b border-gray-200 hover:bg-blue-50 flex items-start gap-1 ${active ? "bg-blue-200" : conversation.unread ? "bg-yellow-50" : ""}`} onClick={() => setSelection({ kind: "direct", username: conversation.partner })}>
                <Avatar username={conversation.partner} size={28} />
                <span className="flex-1 min-w-0"><span className="block truncate font-semibold">{conversation.partner}</span><span className="block truncate text-[10px] text-gray-600">{conversation.lastBody || "no messages"}</span></span>
              </button>;
            })}
            {groups.map((group) => {
              const active = selection?.kind === "group" && selection.id === group.id;
              return <button key={`group-${group.id}`} className={`w-full text-left px-1 py-1 border-b border-gray-200 hover:bg-blue-50 flex items-start gap-1 ${active ? "bg-blue-200" : group.unread ? "bg-yellow-50" : ""}`} onClick={() => setSelection({ kind: "group", id: group.id })}>
                <span className="w-7 h-7 shrink-0 bg-[#000080] text-white flex items-center justify-center font-bold">G</span>
                <span className="flex-1 min-w-0"><span className="block truncate font-semibold">{group.name}</span><span className="block truncate text-[10px] text-gray-600">{group.members.length} members · {group.lastBody || "no messages"}</span></span>
              </button>;
            })}
            {!convos.length && !groups.length && !showContacts && <div className="p-2 text-gray-500 text-[10px]">No conversations yet.</div>}
          </div>
          <div className="flex-1 flex flex-col ml-1 min-w-0">
            {(selectedDirect || selectedGroup) && <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold flex items-center gap-1">
              {selectedDirect ? <Avatar username={selectedDirect} size={16} /> : <span>G</span>}
              <span className="truncate">{selectedDirect || selectedGroup?.name}</span>
            </div>}
            <div ref={scroll} className="flex-1 win98-inset bg-white p-1 overflow-auto">
              {!selection ? <div className="text-gray-500">Select a conversation from the inbox.</div> : !msgs.length ? <div className="text-gray-500">No messages yet — say hi!</div> : msgs.map((message) => (
                <div key={message.id} className={`mb-1 group ${message.fromUser === user.username ? "text-right" : ""}`}>
                  <span className="font-bold">{message.fromUser === user.username ? "you" : message.fromUser}:</span> {message.body}
                  <button className="ml-1 opacity-0 group-hover:opacity-100 text-[10px] text-red-700" onClick={() => void handleReport(message)} title="Report this message">report</button>
                </div>
              ))}
            </div>
            {selection && <div className="flex gap-1 mt-1">
              <input className="win98-inset px-1 flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} placeholder={selectedGroup ? `Message ${selectedGroup.name}…` : `Message ${selectedDirect}…`} />
              <button className="win98-button px-2" onClick={() => void send()}>Send</button>
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}