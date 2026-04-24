import { useEffect, useRef, useState } from "react";
import { createNews, deleteNews, fetchNews, updateNews, type NewsPost } from "../lib/api";
import { hasPermission, useAuth } from "../lib/auth-store";
import { Avatar } from "./Avatar";

// Downscale uploaded images so news posts stay light. Square images aren't
// required — the longest side is capped so portrait/landscape both work.
function fileToInlineImage(file: File, maxSize = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (file.type === "image/gif" || file.type === "image/svg+xml") {
        resolve(r.result as string);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        const ctx = c.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = r.result as string;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function fmt(d: string) { try { return new Date(d).toLocaleString(); } catch { return d; } }

export function News() {
  const me = useAuth((s) => s.user);
  const ranks = useAuth((s) => s.ranks);
  const refreshRanks = useAuth((s) => s.refreshRanks);
  const canPost = !!me && (me.isAdmin || hasPermission(me, "postNews", ranks));

  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try { setPosts(await fetchNews()); setErr(null); }
    catch (e: any) { setErr(e?.message || "Failed to load news"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refreshRanks(); void load(); }, [refreshRanks]);

  function resetForm() { setTitle(""); setBody(""); setImages([]); setEditingId(null); setErr(null); }

  async function pickImages(files: FileList | null) {
    if (!files) return;
    const out: string[] = [...images];
    for (const f of Array.from(files)) {
      if (out.length >= 8) break;
      try { out.push(await fileToInlineImage(f, 1000)); }
      catch { setErr("One of the images couldn't be read."); }
    }
    setImages(out);
  }

  async function submit() {
    if (!title.trim() && !body.trim() && images.length === 0) {
      setErr("Add a title, body, or at least one image."); return;
    }
    setBusy(true); setErr(null);
    try {
      if (editingId != null) {
        await updateNews(editingId, { title: title.trim(), body, images });
      } else {
        await createNews({ title: title.trim(), body, images });
      }
      resetForm();
      await load();
    } catch (e: any) { setErr(e?.message || "Failed to save post"); }
    finally { setBusy(false); }
  }

  function startEdit(p: NewsPost) {
    setEditingId(p.id);
    setTitle(p.title);
    setBody(p.body);
    setImages(p.images || []);
    setErr(null);
  }

  async function remove(p: NewsPost) {
    if (!confirm(`Delete this news post?\n\n"${p.title || p.body.slice(0, 60)}"`)) return;
    try { await deleteNews(p.id); if (editingId === p.id) resetForm(); await load(); }
    catch (e: any) { alert(e?.message || "Failed to delete"); }
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#c0c0c0] text-xs">
      {canPost && (
        <div className="p-2 border-b-2 border-b-[#808080] win98-inset bg-[#dcdcdc] m-1">
          <div className="font-bold mb-1">{editingId != null ? "Edit news post" : "Post site news"}</div>
          <input
            className="win98-inset px-1 w-full mb-1"
            placeholder="Title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="win98-inset px-1 w-full mb-1 resize-y"
            placeholder="What's the news? (line breaks are kept)"
            value={body}
            rows={4}
            maxLength={20000}
            onChange={(e) => setBody(e.target.value)}
          />
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt="" className="w-16 h-16 object-cover win98-inset" />
                  <button
                    className="absolute -top-1 -right-1 bg-red-700 text-white text-[9px] font-bold w-4 h-4 leading-none"
                    onClick={() => setImages(images.filter((_, j) => j !== i))}
                    title="Remove image"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => { void pickImages(e.target.files); e.target.value = ""; }}
            />
            <button
              className="win98-button px-2 py-0.5"
              disabled={busy || images.length >= 8}
              onClick={() => fileRef.current?.click()}
              title="Attach up to 8 images"
            >Attach Image{images.length >= 8 ? "s (max 8)" : "s"}</button>
            <button className="win98-button px-3 py-0.5 font-bold" disabled={busy} onClick={submit}>
              {busy ? "Saving…" : editingId != null ? "Update Post" : "Publish"}
            </button>
            {editingId != null && (
              <button className="win98-button px-2 py-0.5" disabled={busy} onClick={resetForm}>Cancel edit</button>
            )}
            <span className="ml-auto text-[10px] text-gray-700">{images.length}/8 images</span>
          </div>
          {err && <div className="text-red-700 mt-1">{err}</div>}
        </div>
      )}

      <div className="flex-1 overflow-auto p-1">
        {loading && <div className="p-2 text-gray-500">Loading…</div>}
        {!loading && posts.length === 0 && (
          <div className="p-3 text-gray-600 win98-inset bg-white">No news yet. {canPost ? "Be the first to post!" : "Check back later."}</div>
        )}
        {posts.map((p) => {
          const canEditThis = !!me && (me.isAdmin || me.username === p.author);
          return (
            <article key={p.id} className="win98-inset bg-white p-2 mb-1">
              <header className="flex items-center gap-1 mb-1">
                <Avatar username={p.author} size={24} />
                <span className="font-bold">{p.author}</span>
                <span className="text-gray-500 text-[10px]">{fmt(p.createdAt)}{p.updatedAt && p.updatedAt !== p.createdAt ? ` · edited ${fmt(p.updatedAt)}` : ""}</span>
                {canEditThis && (
                  <span className="ml-auto flex gap-0.5">
                    <button className="win98-button px-1 text-[10px]" onClick={() => startEdit(p)}>edit</button>
                    <button className="win98-button px-1 text-[10px] text-red-700" onClick={() => remove(p)}>delete</button>
                  </span>
                )}
              </header>
              {p.title && <h3 className="font-bold text-sm mb-1">{p.title}</h3>}
              {p.body && <div className="whitespace-pre-wrap mb-1">{p.body}</div>}
              {p.images && p.images.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.images.map((src, i) => (
                    <a key={i} href={src} target="_blank" rel="noopener noreferrer" title="Open full size">
                      <img src={src} alt="" className="max-h-48 object-contain win98-inset bg-gray-100" />
                    </a>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
