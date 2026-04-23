import { useEffect, useState } from "react";
import { fetchUserProfile } from "../lib/api";

const cache = new Map<string, string | null>();
const subs = new Map<string, Set<(v: string | null) => void>>();
const inflight = new Map<string, Promise<void>>();

function load(username: string) {
  if (cache.has(username)) return;
  if (inflight.has(username)) return;
  const p = fetchUserProfile(username)
    .then((u) => { cache.set(username, u?.avatarUrl ?? null); subs.get(username)?.forEach((cb) => cb(cache.get(username)!)); })
    .catch(() => { cache.set(username, null); })
    .finally(() => { inflight.delete(username); });
  inflight.set(username, p);
}

export function Avatar({ username, size = 24 }: { username: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(() => cache.get(username) ?? null);
  useEffect(() => {
    if (!username) return;
    if (cache.has(username)) { setUrl(cache.get(username) ?? null); return; }
    let set = subs.get(username); if (!set) { set = new Set(); subs.set(username, set); }
    const cb = (v: string | null) => setUrl(v);
    set.add(cb);
    load(username);
    return () => { set?.delete(cb); };
  }, [username]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.5) };
  if (url) return <img src={url} alt="" className="win98-inset object-cover shrink-0" style={style} />;
  return (
    <div className="win98-inset bg-gray-300 flex items-center justify-center shrink-0 font-bold" style={style}>
      {(username[0] || "?").toUpperCase()}
    </div>
  );
}
