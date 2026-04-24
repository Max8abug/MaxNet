import { useEffect, useState } from "react";
import { fetchUsers, addBan, adminDeleteUser, clearUserPage, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useDesktopStore } from "../store";
import { Avatar } from "./Avatar";

export function UserList({ page }: { page: string }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const me = useAuth((s) => s.user);
  const isAdmin = !!me?.isAdmin;
  const addWindow = useDesktopStore((s) => s.addWindow);

  async function load() {
    try { setUsers(await fetchUsers()); } catch {}
  }
  useEffect(() => { void refreshRanks(); void load(); }, [refreshRanks]);

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
      {users.length === 0 && <div className="p-2 text-gray-500">No users yet.</div>}
      {users.map(u => {
        const rank = ranks.find(r => r.name === u.rank);
        const isOwner = u.isAdmin || u.username === "Max8abug";
        const isBusy = busy === u.username;
        return (
          <div
            key={u.username}
            className="flex items-center gap-1 w-full px-1 py-0.5 hover:bg-blue-50 group border-b border-gray-100"
          >
            <button
              className="flex items-center gap-1 flex-1 text-left min-w-0"
              onClick={() => openPage(u.username)}
              title="Open personal page"
            >
              <Avatar username={u.username} size={28} />
              <span className="font-bold truncate" style={{ color: u.isAdmin ? "#cc0000" : (rank?.color || "") }}>
                {u.username}{u.isAdmin && " ★"}{u.rank && ` [${u.rank}]`}
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
