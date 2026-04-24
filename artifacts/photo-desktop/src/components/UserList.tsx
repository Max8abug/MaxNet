import { useEffect, useState } from "react";
import { fetchUsers, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useDesktopStore } from "../store";
import { Avatar } from "./Avatar";

export function UserList({ page }: { page: string }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const addWindow = useDesktopStore((s) => s.addWindow);

  useEffect(() => { void refreshRanks(); fetchUsers().then(setUsers).catch(() => {}); }, [refreshRanks]);

  function openPage(u: string) {
    addWindow(page, { type: "userpage", title: `${u}'s page`, username: u, width: 480, height: 400 });
  }

  return (
    <div className="w-full h-full win98-inset bg-white overflow-auto text-xs p-1">
      {users.map(u => {
        const rank = ranks.find(r => r.name === u.rank);
        return (
          <button key={u.username} className="flex items-center gap-1 w-full text-left px-1 py-0.5 hover:bg-blue-100" onClick={() => openPage(u.username)}>
            <Avatar username={u.username} size={28} />
            <span className="font-bold flex-1" style={{ color: u.isAdmin ? "#cc0000" : (rank?.color || "") }}>
              {u.username}{u.isAdmin && " ★"}{u.rank && ` [${u.rank}]`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
