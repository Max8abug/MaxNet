import { useEffect, useMemo, useState } from "react";
import { fetchUsers, addBan, adminDeleteUser, clearUserPage, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useDesktopStore } from "../store";
import { Avatar } from "./Avatar";

// "Online right now" window — must agree with the auth-side throttle
// (PRESENCE_BUMP_MS = 30s) plus a generous grace period for the time between
// the user's last request and our next refresh of the user list.
const ONLINE_WINDOW_MS = 90_000;

function presenceState(lastSeen: string | null | undefined): { online: boolean; label: string; tooltip: string } {
  if (!lastSeen) return { online: false, label: "never seen", tooltip: "This user has never been active." };
  const t = new Date(lastSeen).getTime();
  if (Number.isNaN(t)) return { online: false, label: "unknown", tooltip: "" };
  const ago = Date.now() - t;
  const tooltip = `Last seen ${new Date(t).toLocaleString()}`;
  if (ago < ONLINE_WINDOW_MS) return { online: true, label: "online now", tooltip };
  const mins = Math.floor(ago / 60_000);
  if (mins < 60) return { online: false, label: `${mins}m ago`, tooltip };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { online: false, label: `${hrs}h ago`, tooltip };
  const days = Math.floor(hrs / 24);
  if (days < 30) return { online: false, label: `${days}d ago`, tooltip };
  return { online: false, label: new Date(t).toLocaleDateString(), tooltip };
}

export function UserList({ page }: { page: string }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Bumped on a timer purely to force a re-render so the relative
  // "5m ago" labels keep ticking even between full data refreshes.
  const [, setNow] = useState(0);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const me = useAuth((s) => s.user);
  const isAdmin = !!me?.isAdmin;
  const addWindow = useDesktopStore((s) => s.addWindow);

  async function load() {
    try { setUsers(await fetchUsers()); } catch {}
  }
  useEffect(() => {
    void refreshRanks();
    void load();
    const refresh = setInterval(load, 30_000);
    const tick = setInterval(() => setNow((n) => n + 1), 15_000);
    return () => { clearInterval(refresh); clearInterval(tick); };
  }, [refreshRanks]);

  // Sort: online users first (by recency), then offline users by recency.
  const sorted = useMemo(() => {
    const score = (u: PublicUser) => u.lastSeen ? new Date(u.lastSeen).getTime() : 0;
    return [...users].sort((a, b) => score(b) - score(a));
  }, [users]);
  const onlineCount = sorted.filter((u) => presenceState(u.lastSeen).online).length;

  function openPage(u: string) {
    addWindow(page, { type: "userpage", title: `${u}'s page`, username: u, width: 480, height: 400 });
  }
  function openIpLookup(u: string) {
    addWindow(page, { type: "iplookup", title: `IP scan: ${u}`, username: u, width: 520, height: 440 });
  }

  async function onBan(username: string) {
    const reason = prompt(`Ban ${username}? Optional reason:`, "");
    if (reason === null) return;
    setBusy(username);
    try { await addBan(username, reason); alert(`${username} has been banned.`); }
    catch (e: any) { alert(e?.message || "Failed to ban"); }
    finally { setBusy(null); }
  }

  async function onDelete(username: string) {
    if (!confirm(`Permanently delete the account "${username}"?\n\nThis bans them and removes their account and personal page. Their old chat/forum posts stay visible but you can delete those individually.`)) return;
    setBusy(username);
    try {
      await adminDeleteUser(username, "Account deleted by admin");
      await load();
    } catch (e: any) { alert(e?.message || "Failed to delete user"); }
    finally { setBusy(null); }
  }

  async function onClearPage(username: string) {
    if (!confirm(`Clear ${username}'s personal page? This cannot be undone.`)) return;
    setBusy(username);
    try { await clearUserPage(username); alert(`${username}'s page was cleared.`); }
    catch (e: any) { alert(e?.message || "Failed to clear page"); }
    finally { setBusy(null); }
  }

  return (
    <div className="w-full h-full win98-inset bg-white overflow-auto text-xs">
      <div className="px-1 py-0.5 bg-[#000080] text-white text-[10px] font-bold sticky top-0">
        {users.length} users — {onlineCount} online now
      </div>
      {users.length === 0 && <div className="p-2 text-gray-500">No users yet.</div>}
      {sorted.map(u => {
        const rank = ranks.find(r => r.name === u.rank);
        const isOwner = u.isAdmin || u.username === "Max8abug";
        const isBusy = busy === u.username;
        const pres = presenceState(u.lastSeen);
        return (
          <div
            key={u.username}
            className="flex items-center gap-1 w-full px-1 py-0.5 hover:bg-blue-50 group border-b border-gray-100"
          >
            <button
              className="flex items-center gap-1 flex-1 text-left min-w-0"
              onClick={() => openPage(u.username)}
              title={`Open personal page — ${pres.tooltip}`}
            >
              <span className="relative shrink-0">
                <Avatar username={u.username} size={28} />
                <span
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-white ${pres.online ? "bg-green-500" : "bg-gray-400"}`}
                  title={pres.online ? "Online now" : pres.tooltip}
                />
              </span>
              <span className="flex-1 min-w-0">
                <span className="font-bold truncate block" style={{ color: u.isAdmin ? "#cc0000" : (rank?.color || "") }}>
                  {u.username}{u.isAdmin && " ★"}{u.rank && ` [${u.rank}]`}
                </span>
                <span className={`block text-[10px] ${pres.online ? "text-green-700 font-semibold" : "text-gray-500"}`} title={pres.tooltip}>
                  {pres.online ? "● online now" : `last seen ${pres.label}`}
                </span>
              </span>
            </button>
            {isAdmin && !isOwner && me?.username !== u.username && (
              <span className="flex gap-0.5 shrink-0 opacity-60 group-hover:opacity-100">
                <button
                  className="win98-button px-1 text-[10px]"
                  disabled={isBusy}
                  onClick={() => openIpLookup(u.username)}
                  title="See this user's IP history and any alt accounts"
                >scan ips</button>
                <button
                  className="win98-button px-1 text-[10px]"
                  disabled={isBusy}
                  onClick={() => onClearPage(u.username)}
                  title="Wipe this user's personal page"
                >clear page</button>
                <button
                  className="win98-button px-1 text-[10px]"
                  disabled={isBusy}
                  onClick={() => onBan(u.username)}
                  title="Ban this user (account stays, can't post)"
                >ban</button>
                <button
                  className="win98-button px-1 text-[10px] text-red-700"
                  disabled={isBusy}
                  onClick={() => onDelete(u.username)}
                  title="Permanently delete this account"
                >delete</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
