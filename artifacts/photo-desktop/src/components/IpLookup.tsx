import { useEffect, useState } from "react";
import { addIpBan, banAccountAndAllIps, fetchIpBans, fetchUserIps, removeIpBan, type IpBan, type UserIpReport } from "../lib/api";
import { useAuth } from "../lib/auth-store";

function fmt(d: string) {
  try { return new Date(d).toLocaleString(); } catch { return d; }
}

export function IpLookup({ username }: { username: string }) {
  const me = useAuth((s) => s.user);
  const [report, setReport] = useState<UserIpReport | null>(null);
  const [bans, setBans] = useState<IpBan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"user" | "all">("user");

  async function load() {
    setErr(null);
    try {
      const [r, b] = await Promise.all([fetchUserIps(username), fetchIpBans()]);
      setReport(r); setBans(b);
    } catch (e: any) {
      setErr(e?.message || "Failed to load IP records");
    }
  }
  useEffect(() => { void load(); }, [username]);

  if (!me?.isAdmin) {
    return <div className="p-3 text-sm text-red-700">Only admins can view IP records.</div>;
  }

  async function ban(ip: string) {
    const reason = prompt(`Ban IP ${ip}?\nUsers from this IP won't be able to log in or sign up.\nOptional reason:`, "");
    if (reason === null) return;
    setBusy(ip);
    try { await addIpBan(ip, reason); await load(); }
    catch (e: any) { alert(e?.message || "Failed to ban IP"); }
    finally { setBusy(null); }
  }
  async function unban(ip: string) {
    if (!confirm(`Lift the IP ban on ${ip}?`)) return;
    setBusy(ip);
    try { await removeIpBan(ip); await load(); }
    catch (e: any) { alert(e?.message || "Failed to unban IP"); }
    finally { setBusy(null); }
  }

  async function nukeAccount() {
    const ipCount = report?.ips.length ?? 0;
    if (!confirm(
      `Ban the account "${username}" and ban all ${ipCount} IP(s) we've seen them on?\n\n` +
      `Anyone signing in from those IPs (including alts) will be blocked.`
    )) return;
    const reason = prompt("Optional reason (shown in the audit log):", "") ?? "";
    setBusy("__nuke__");
    try {
      const result = await banAccountAndAllIps(username, reason);
      await load();
      alert(`Banned account "${result.username}" and ${result.bannedIps} of ${result.totalIps} IP(s).`);
    }
    catch (e: any) { alert(e?.message || "Failed to ban account + IPs"); }
    finally { setBusy(null); }
  }

  return (
    <div className="w-full h-full flex flex-col text-xs">
      <div className="flex items-center gap-1 p-1 bg-[#c0c0c0] border-b border-[#808080]">
        <button
          className={`win98-button px-2 py-0.5 ${view === "user" ? "border-t-black border-l-black border-r-white border-b-white shadow-[inset_1px_1px_#808080]" : ""}`}
          onClick={() => setView("user")}
        >IPs for {username}</button>
        <button
          className={`win98-button px-2 py-0.5 ${view === "all" ? "border-t-black border-l-black border-r-white border-b-white shadow-[inset_1px_1px_#808080]" : ""}`}
          onClick={() => setView("all")}
        >All IP Bans ({bans.length})</button>
        {view === "user" && (
          <button
            className="win98-button px-2 py-0.5 text-red-700 font-bold"
            disabled={busy === "__nuke__"}
            title={`Ban ${username} and every IP we've ever seen them on`}
            onClick={nukeAccount}
          >{busy === "__nuke__" ? "banning…" : "ban account + all IPs"}</button>
        )}
        <button className="win98-button px-2 py-0.5 ml-auto" onClick={load}>refresh</button>
      </div>

      {err && <div className="p-2 text-red-700">{err}</div>}

      {view === "user" && (
        <div className="flex-1 overflow-auto p-2 bg-white">
          {!report && <div className="text-gray-500">Loading…</div>}
          {report && report.ips.length === 0 && (
            <div className="text-gray-500">No IPs recorded yet for <b>{username}</b>. They'll appear after the user's next login.</div>
          )}
          {report && report.ips.map((r) => (
            <div key={r.ip} className="win98-inset bg-[#f4f4f4] p-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold">{r.ip}</span>
                {r.banned ? (
                  <span className="bg-red-700 text-white px-1 text-[10px]">BANNED</span>
                ) : null}
                <span className="text-gray-600">{r.hits} login{r.hits !== 1 ? "s" : ""}</span>
                <span className="text-gray-600">last: {fmt(r.lastSeen)}</span>
                <span className="ml-auto flex gap-0.5">
                  {r.banned ? (
                    <button className="win98-button px-1 text-[10px]" disabled={busy === r.ip} onClick={() => unban(r.ip)}>unban IP</button>
                  ) : (
                    <button className="win98-button px-1 text-[10px] text-red-700" disabled={busy === r.ip} onClick={() => ban(r.ip)}>ip ban</button>
                  )}
                </span>
              </div>
              {r.alts.length > 0 ? (
                <div className="mt-1 pt-1 border-t border-gray-300">
                  <div className="text-[10px] text-gray-700 mb-1">
                    Other accounts from this IP ({r.alts.length}) — likely alts:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.alts.map((a) => (
                      <span key={a.username} className="win98-button px-1 text-[10px]" title={`${a.hits} login(s), last ${fmt(a.lastSeen)}`}>
                        {a.username}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-1 pt-1 border-t border-gray-300 text-[10px] text-gray-500">No other accounts from this IP.</div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === "all" && (
        <div className="flex-1 overflow-auto p-2 bg-white">
          {bans.length === 0 && <div className="text-gray-500">No IPs are currently banned.</div>}
          {bans.map((b) => (
            <div key={b.ip} className="flex items-center gap-2 win98-inset bg-[#f4f4f4] p-1 mb-1">
              <span className="font-mono font-bold">{b.ip}</span>
              <span className="text-gray-600 truncate flex-1">{b.reason || "(no reason)"}</span>
              <span className="text-gray-500 text-[10px]">by {b.bannedBy}</span>
              <button className="win98-button px-1 text-[10px]" disabled={busy === b.ip} onClick={() => unban(b.ip)}>unban</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
