import { useEffect, useState } from "react";
import { fetchUserProfile, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";

const cache = new Map<string, PublicUser | null>();
const subs = new Map<string, Set<(v: PublicUser | null) => void>>();
const inflight = new Map<string, Promise<void>>();

function load(username: string) {
  if (cache.has(username)) return;
  if (inflight.has(username)) return;
  const p = fetchUserProfile(username)
    .then((u) => { cache.set(username, u || null); subs.get(username)?.forEach((cb) => cb(cache.get(username)!)); })
    .catch(() => { cache.set(username, null); })
    .finally(() => { inflight.delete(username); });
  inflight.set(username, p);
}

export function bustAvatarCache(username: string) {
  cache.delete(username);
  inflight.delete(username);
  load(username);
}

export function Avatar({ username, size = 32 }: { username: string; size?: number }) {
  const [u, setU] = useState<PublicUser | null>(() => cache.get(username) ?? null);
  const ranks = useAuth(s => s.ranks);
  useEffect(() => {
    if (!username) return;
    if (cache.has(username)) { setU(cache.get(username) ?? null); return; }
    let set = subs.get(username); if (!set) { set = new Set(); subs.set(username, set); }
    const cb = (v: PublicUser | null) => setU(v);
    set.add(cb);
    load(username);
    return () => { set?.delete(cb); };
  }, [username]);

  const rank = ranks.find(r => r.name === u?.rank);
  const ringColor = u?.isAdmin ? "#cc0000" : (rank?.color || "transparent");
  const url = u?.avatarUrl || null;
  const style: React.CSSProperties = {
    width: size, height: size, fontSize: Math.round(size * 0.5),
    boxShadow: ringColor !== "transparent" ? `0 0 0 2px ${ringColor}` : undefined,
  };
  if (url) return <img src={url} alt="" className="win98-inset object-cover shrink-0" style={style} />;
  return (
    <div className="win98-inset bg-gray-300 flex items-center justify-center shrink-0 font-bold" style={style}>
      {(username[0] || "?").toUpperCase()}
    </div>
  );
}
