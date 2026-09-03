import { useEffect, useState } from "react";
import { fetchRanks, createRank, deleteRank, assignRank, fetchUsers, type Rank, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";

const PERMS = ["deleteMessages", "ban", "dm", "manageRanks", "cafeTheme", "postNews"];
const BUILTINS = ["admin", "mod", "vip"];

export function RanksAdmin() {
  const user = useAuth((s) => s.user);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#888888");
  const [tier, setTier] = useState(10);
  const [perms, setPerms] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setRanks(await fetchRanks()); setUsers(await fetchUsers()); } catch {}
  }
  useEffect(() => { void refresh(); }, []);

  if (!user?.isAdmin) return <div className="p-2 text-xs">Admin only.</div>;

  async function create() {
    setErr(null);
    try { await createRank(name, color, perms, tier); setName(""); setPerms([]); await refresh(); }
    catch (e: any) { setErr(e?.message || "Failed"); }
  }
  async function del(n: string) { if (!confirm(`Delete rank ${n}?`)) return; try { await deleteRank(n); await refresh(); } catch {} }
  async function assign(u: string, rank: string) {
    try { await assignRank(u, rank === "" ? null : rank); await refresh(); } catch (e: any) { alert(e?.message || "Failed"); }
  }

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1 overflow-auto">
      <div className="font-bold">Ranks</div>
      <div className="win98-inset bg-white p-1 flex flex-col gap-1">
        {ranks.map(r => (
          <div key={r.id} className="flex items-center gap-1">
            <span className="font-bold w-20" style={{ color: r.color }}>{r.name}</span>
            <span className="text-[10px] text-gray-500">tier {r.tier}</span>
            <span className="text-[10px] flex-1 truncate">{r.permissions.join(", ")}</span>
            {!BUILTINS.includes(r.name) && <button className="win98-button px-1 text-[10px]" onClick={() => del(r.name)}>x</button>}
          </div>
        ))}
      </div>
      <div className="font-bold mt-2">+ New Rank</div>
      <div className="win98-inset bg-white p-1 flex flex-col gap-1">
        <input className="win98-inset px-1" placeholder="rank name" value={name} onChange={e => setName(e.target.value)} />
        <div className="flex gap-1 items-center">
          <span>color</span><input type="color" value={color} onChange={e => setColor(e.target.value)} />
          <span>tier</span><input type="number" min={1} max={99} className="win98-inset px-1 w-14" value={tier} onChange={e => setTier(Number(e.target.value))} />
        </div>
        <div className="flex flex-wrap gap-1">
          {PERMS.map(p => (
            <label key={p} className="flex items-center gap-0.5"><input type="checkbox" checked={perms.includes(p)} onChange={e => setPerms(e.target.checked ? [...perms, p] : perms.filter(x => x !== p))} />{p}</label>
          ))}
        </div>
        {err && <div className="text-red-700">{err}</div>}
        <button className="win98-button px-2 self-end" onClick={create}>Create</button>
      </div>
      <div className="font-bold mt-2">Assign Ranks</div>
      <div className="win98-inset bg-white p-1 flex flex-col gap-1">
        {users.map(u => (
          <div key={u.username} className="flex items-center gap-1">
            <span className="flex-1 truncate" style={{ color: ranks.find(r => r.name === u.rank)?.color || (u.isAdmin ? "#cc0000" : "") }}>{u.username}{u.isAdmin && " (admin)"}</span>
            <select className="win98-inset" value={u.rank || ""} onChange={e => assign(u.username, e.target.value)}>
              <option value="">(none)</option>
              {ranks.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
