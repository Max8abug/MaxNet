import { useEffect, useState } from "react";
import { fetchPolls, createPoll, votePoll, deletePoll, type Poll } from "../lib/api";
import { useAuth } from "../lib/auth-store";

export function Polls() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const [err, setErr] = useState<string | null>(null);
  const user = useAuth((s) => s.user);

  async function refresh() { try { setPolls(await fetchPolls()); } catch {} }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t); }, []);

  async function submit() {
    setErr(null);
    try {
      await createPoll(q, opts.filter(o => o.trim()));
      setQ(""); setOpts(["", ""]); setComposing(false); await refresh();
    } catch (e: any) { setErr(e?.message || "Failed"); }
  }
  async function vote(p: Poll, optionId: number) {
    try { await votePoll(p.id, optionId); await refresh(); } catch {}
  }

  return (
    <div className="w-full h-full flex flex-col text-xs gap-1">
      <div className="flex gap-1 shrink-0">
        <div className="font-bold flex-1">Polls</div>
        {user && <button className="win98-button px-2" onClick={() => setComposing(v => !v)}>{composing ? "Cancel" : "+ New Poll"}</button>}
      </div>
      {composing && (
        <div className="win98-inset bg-white p-2 flex flex-col gap-1 shrink-0">
          <input className="win98-inset px-1" placeholder="Question" value={q} onChange={e => setQ(e.target.value)} />
          {opts.map((o, i) => (
            <input key={i} className="win98-inset px-1" placeholder={`Option ${i + 1}`} value={o} onChange={e => setOpts(opts.map((x, j) => j === i ? e.target.value : x))} />
          ))}
          <div className="flex gap-1">
            {opts.length < 10 && <button className="win98-button px-2" onClick={() => setOpts([...opts, ""])}>+ Option</button>}
            {opts.length > 2 && <button className="win98-button px-2" onClick={() => setOpts(opts.slice(0, -1))}>- Option</button>}
            <div className="flex-1" />
            <button className="win98-button px-2" onClick={submit}>Create</button>
          </div>
          {err && <div className="text-red-700">{err}</div>}
        </div>
      )}
      <div className="flex-1 win98-inset bg-white overflow-auto p-1 flex flex-col gap-2">
        {polls.length === 0 ? <div className="text-gray-500 p-2">No polls yet.</div> :
          polls.map(p => {
            const total = Object.keys(p.votes).length;
            const myVote = user ? p.votes[user.username] : undefined;
            return (
              <div key={p.id} className="border border-gray-300 p-1">
                <div className="flex items-start gap-1">
                  <div className="font-bold flex-1">{p.question}</div>
                  {user?.isAdmin && <button className="win98-button px-1 text-[10px] text-red-700" onClick={() => deletePoll(p.id).then(refresh)}>x</button>}
                </div>
                <div className="text-[10px] text-gray-500">by {p.creator} · {total} vote{total === 1 ? "" : "s"}</div>
                <div className="flex flex-col gap-0.5 mt-1">
                  {p.options.map(o => {
                    const count = Object.values(p.votes).filter(v => v === o.id).length;
                    const pct = total ? Math.round((count / total) * 100) : 0;
                    const mine = myVote === o.id;
                    return (
                      <button key={o.id} className={`text-left px-1 py-0.5 border ${mine ? "bg-blue-200 border-blue-700" : "bg-gray-100 border-gray-400"} relative overflow-hidden`} onClick={() => user && vote(p, o.id)} disabled={!user}>
                        <div className="absolute inset-y-0 left-0 bg-blue-300/40" style={{ width: `${pct}%` }} />
                        <div className="relative flex justify-between"><span>{o.label}</span><span>{pct}% ({count})</span></div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
