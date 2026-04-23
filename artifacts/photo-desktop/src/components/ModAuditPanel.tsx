import { useEffect, useState } from "react";
import { type ChatAuditEntry } from "../lib/api";

const BASE = "/api";

async function fetchAudit(area: string): Promise<ChatAuditEntry[]> {
  const r = await fetch(`${BASE}/audit?area=${encodeURIComponent(area)}`, { credentials: "include" });
  if (!r.ok) return [];
  return r.json();
}

function tagColor(action: string): string {
  switch (action) {
    case "post": return "text-blue-700";
    case "delete": case "delete-thread": return "text-orange-700";
    case "thread": return "text-green-700";
    case "clear": return "text-red-700 font-bold";
    case "ban": return "text-red-700 font-bold";
    case "unban": return "text-green-700";
    case "blocked": return "text-purple-700";
    default: return "text-gray-700";
  }
}

export function ModAuditPanel({ area }: { area: string }) {
  const [entries, setEntries] = useState<ChatAuditEntry[]>([]);
  async function refresh() { setEntries(await fetchAudit(area)); }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t); }, [area]);
  return (
    <div className="flex-1 win98-inset bg-white p-1 overflow-auto font-mono text-[11px]">
      <div className="flex justify-between mb-1 sticky top-0 bg-white">
        <span className="font-bold">{area} history (newest first)</span>
        <button className="win98-button px-1 text-[10px]" onClick={refresh}>Refresh</button>
      </div>
      {entries.length === 0 ? <div className="text-gray-500">No activity.</div> :
        entries.map((e) => (
          <div key={e.id} className="border-b border-dashed border-gray-300 py-0.5 break-words">
            <span className="text-gray-500">{new Date(e.createdAt).toLocaleString()}</span>{" "}
            <span className={tagColor(e.action)}>[{e.action}]</span>{" "}
            <span className="font-bold">{e.actor}</span>
            {e.target && <> → <span className="font-bold">{e.target}</span></>}
            {e.body && <>: <span className="text-gray-800">{e.body}</span></>}
          </div>
        ))}
    </div>
  );
}
