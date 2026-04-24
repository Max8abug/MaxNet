import { useEffect, useRef, useState } from "react";
import {
  fetchThreads, fetchThreadOrLock, createThreadWithOpts, postReply,
  deleteForumPost, deleteForumThread, unlockThread,
  type ForumThread, type ForumPost,
} from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { Avatar, getCachedAvatar } from "./Avatar";
import { showFullscreen } from "./ImageViewer";

interface Props { onRequestLogin?: () => void; }

function fileToDataUrl(file: File, maxSize = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        if (file.type === "image/gif") resolve(r.result as string);
        else resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = r.result as string;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function Forum({ onRequestLogin }: Props) {
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [thread, setThread] = useState<{ thread: ForumThread; posts: ForumPost[] } | null>(null);
  const [lockPrompt, setLockPrompt] = useState<{ threadId: number; title: string; password: string; err?: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pw, setPw] = useState("");
  const [reply, setReply] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const user = useAuth((s) => s.user);
  const isAdmin = !!user?.isAdmin;

  async function refreshList() { try { setThreads(await fetchThreads()); } catch {} }
  async function refreshThread(id: number) {
    try {
      const r = await fetchThreadOrLock(id);
      if (r.ok) { setThread({ thread: r.thread, posts: r.posts }); setLockPrompt(null); }
      else { setLockPrompt({ threadId: id, title: r.thread.title, password: "" }); setThread(null); }
    } catch { setOpenId(null); }
  }

  useEffect(() => { void refreshList(); }, []);
  useEffect(() => {
    if (openId === null) return;
    void refreshThread(openId);
    const t = setInterval(() => { if (!lockPrompt) refreshThread(openId); }, 6000);
    return () => clearInterval(t);
  }, [openId, !!lockPrompt]);

  async function submitNew() {
    if (!user) { onRequestLogin?.(); return; }
    if (!title.trim() || !body.trim()) return;
    setBusy(true); setErr(null);
    try {
      const t = await createThreadWithOpts(title, body, pw || undefined);
      setComposing(false); setTitle(""); setBody(""); setPw("");
      await refreshList(); setOpenId(t.id);
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function submitReply() {
    if (!user) { onRequestLogin?.(); return; }
    if (!reply.trim() && !imageData) return;
    if (openId === null) return;
    setBusy(true); setErr(null);
    try {
      await postReply(openId, reply, imageData);
      setReply(""); setImageData(null);
      await refreshThread(openId);
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function pickImage(file: File) { try { setImageData(await fileToDataUrl(file)); } catch { setErr("Image failed"); } }

  async function delPost(id: number) { try { await deleteForumPost(id); if (openId !== null) await refreshThread(openId); } catch {} }
  async function delThread(id: number) {
    if (!confirm("Delete this entire thread?")) return;
    try { await deleteForumThread(id); setOpenId(null); await refreshList(); } catch {}
  }

  async function tryUnlock() {
    if (!lockPrompt) return;
    try { await unlockThread(lockPrompt.threadId, lockPrompt.password); await refreshThread(lockPrompt.threadId); }
    catch (e: any) { setLockPrompt({ ...lockPrompt, err: e?.message || "Failed" }); }
  }

  if (openId !== null && lockPrompt) {
    return (
      <div className="w-full h-full flex flex-col text-sm">
        <div className="flex items-center gap-1 mb-2 shrink-0">
          <button className="win98-button px-2 py-0.5 text-xs" onClick={() => { setOpenId(null); setLockPrompt(null); void refreshList(); }}>← Back</button>
          <div className="font-bold flex-1 truncate">🔒 {lockPrompt.title}</div>
        </div>
        <div className="win98-inset bg-white p-3 flex flex-col gap-2 items-center">
          <div className="text-xs">This thread is password-protected.</div>
          <input type="password" className="win98-inset px-2 py-1" placeholder="Password" value={lockPrompt.password} onChange={e => setLockPrompt({ ...lockPrompt, password: e.target.value, err: undefined })} onKeyDown={e => e.key === "Enter" && tryUnlock()} />
          {lockPrompt.err && <div className="text-red-700 text-xs">{lockPrompt.err}</div>}
          <button className="win98-button px-3 py-1" onClick={tryUnlock}>Unlock</button>
        </div>
      </div>
    );
  }

  if (openId !== null && thread) {
    return (
      <div className="w-full h-full flex flex-col text-sm">
        <div className="flex items-center gap-1 mb-1 shrink-0">
          <button className="win98-button px-2 py-0.5 text-xs" onClick={() => { setOpenId(null); setThread(null); void refreshList(); }}>← Back</button>
          <div className="font-bold flex-1 truncate">{thread.thread.hasPassword && "🔒 "}{thread.thread.title}</div>
          {isAdmin && <button className="win98-button px-2 py-0.5 text-xs text-red-700" onClick={() => delThread(thread.thread.id)}>Delete Thread</button>}
        </div>
        <div className="flex-1 win98-inset bg-white p-1 overflow-auto flex flex-col gap-1">
          {thread.posts.map((p) => (
            <div key={p.id} className="border-b border-gray-200 pb-2 group flex gap-2">
              <Avatar username={p.author} size={52} onClick={() => { const av = getCachedAvatar(p.author); if (av) showFullscreen(av); }} />
              <div className="flex-1">
                <div className="flex items-center gap-1 text-[11px]">
                  <span className={`font-bold ${p.author === "Max8abug" ? "text-red-700" : ""}`}>{p.author}</span>
                  <span className="text-gray-500">{new Date(p.createdAt).toLocaleString()}</span>
                  {isAdmin && p.author !== "Max8abug" && (
                    <button className="win98-button px-1 text-[10px] ml-auto opacity-0 group-hover:opacity-100" onClick={() => delPost(p.id)}>delete</button>
                  )}
                </div>
                {p.body && <div className="whitespace-pre-wrap break-words text-[12px] mt-0.5">{p.body}</div>}
                {p.imageUrl && <img src={p.imageUrl} alt="" className="max-w-[300px] max-h-[200px] mt-1 win98-inset cursor-zoom-in" onClick={() => showFullscreen(p.imageUrl!)} />}
              </div>
            </div>
          ))}
        </div>
        {err && <div className="text-red-700 text-xs">{err}</div>}
        {user ? (
          <div className="mt-1 flex flex-col gap-1 shrink-0">
            <textarea className="win98-inset px-1 py-0.5 resize-none" rows={2} placeholder="Reply..." value={reply} onChange={(e) => setReply(e.target.value)} />
            <div className="flex gap-1 items-center">
              <input ref={fileRef} type="file" accept="image/*,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ""; }} />
              <button className="win98-button px-2 text-xs" onClick={() => fileRef.current?.click()}>{imageData ? "Image ✓" : "Attach Image"}</button>
              {imageData && <button className="win98-button px-2 text-xs" onClick={() => setImageData(null)}>x</button>}
              <div className="flex-1" />
              <button className="win98-button px-3" disabled={busy} onClick={submitReply}>Reply</button>
            </div>
          </div>
        ) : (
          <button className="win98-button px-2 py-1 mt-1" onClick={onRequestLogin}>Log in to reply</button>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col text-sm">
      <div className="flex gap-1 mb-1 shrink-0">
        <div className="font-bold flex-1">Forum</div>
        {user
          ? <button className="win98-button px-2 py-0.5 text-xs" onClick={() => setComposing((v) => !v)}>{composing ? "Cancel" : "+ New Thread"}</button>
          : <button className="win98-button px-2 py-0.5 text-xs" onClick={onRequestLogin}>Log in to post</button>}
      </div>
      {composing && (
        <div className="mb-1 shrink-0 flex flex-col gap-1 win98-inset bg-white p-1">
          <input className="win98-inset px-1 text-xs" placeholder="Thread title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="win98-inset px-1 text-xs resize-none" rows={3} placeholder="First post..." value={body} onChange={(e) => setBody(e.target.value)} />
          <input type="password" className="win98-inset px-1 text-xs" placeholder="Optional password (leave blank for public)" value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <div className="text-red-700 text-xs">{err}</div>}
          <button className="win98-button px-2 self-end text-xs" disabled={busy} onClick={submitNew}>Post Thread</button>
        </div>
      )}
      <div className="flex-1 win98-inset bg-white overflow-auto">
        {threads.length === 0 ? (
          <div className="text-gray-500 text-xs p-2">No threads yet.</div>
        ) : (
          threads.map((t) => (
            <button key={t.id} onClick={() => setOpenId(t.id)}
              className="w-full text-left px-2 py-1 border-b border-gray-200 hover:bg-[#000080] hover:text-white flex items-center gap-2">
              <Avatar username={t.author} size={36} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-xs truncate">{t.hasPassword && "🔒 "}{t.title}</div>
                <div className="text-[10px] opacity-70">
                  by {t.author} · {t.postCount} post{t.postCount === 1 ? "" : "s"} · {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
