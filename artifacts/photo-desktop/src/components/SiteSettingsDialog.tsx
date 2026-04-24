import { useEffect, useRef, useState } from "react";
import { updateSiteSettings } from "../lib/api";
import { useAuth } from "../lib/auth-store";

// Downscale and convert any image file to a small data URL so the logo stays
// crisp in the start-menu button without bloating every API response that
// includes site settings.
function fileToLogoDataUrl(file: File, maxSize = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      // Animated GIFs would be lost during resize; preserve them as-is.
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
        // PNG keeps transparency, which matters for non-rectangular logos.
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = r.result as string;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function SiteSettingsDialog() {
  const settings = useAuth((s) => s.siteSettings);
  const refreshSiteSettings = useAuth((s) => s.refreshSiteSettings);
  const user = useAuth((s) => s.user);
  const [siteName, setSiteName] = useState(settings.siteName);
  const [preview, setPreview] = useState(settings.logoDataUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void refreshSiteSettings(); }, [refreshSiteSettings]);
  useEffect(() => { setSiteName(settings.siteName); setPreview(settings.logoDataUrl); }, [settings.siteName, settings.logoDataUrl]);

  if (!user?.isAdmin) {
    return <div className="p-3 text-sm text-red-700">Only the site owner can change these settings.</div>;
  }

  async function pickLogo(file: File) {
    setErr(null); setMsg(null);
    try {
      const data = await fileToLogoDataUrl(file, 96);
      setPreview(data);
    } catch { setErr("Could not read that image. Try a PNG or JPG."); }
  }

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await updateSiteSettings({ logoDataUrl: preview, siteName });
      await refreshSiteSettings();
      setMsg("Saved! The new logo will appear for all visitors.");
    } catch (e: any) { setErr(e?.message || "Failed to save"); }
    finally { setBusy(false); }
  }

  async function clearLogo() {
    setPreview("");
    setBusy(true); setErr(null); setMsg(null);
    try {
      await updateSiteSettings({ logoDataUrl: "" });
      await refreshSiteSettings();
      setMsg("Logo reset to the default.");
    } catch (e: any) { setErr(e?.message || "Failed to clear"); }
    finally { setBusy(false); }
  }

  return (
    <div className="w-full h-full flex flex-col gap-3 p-3 text-sm overflow-auto">
      <div>
        <div className="font-bold mb-1">Start Menu Logo</div>
        <div className="text-[11px] text-gray-700 mb-2">
          Shown next to the "{siteName || "Start"}" button on the taskbar. Upload a square PNG or JPG (transparent PNG works best).
        </div>
        <div className="flex items-center gap-3">
          <div className="win98-inset bg-[#c0c0c0] w-12 h-12 flex items-center justify-center overflow-hidden">
            {preview ? (
              <img src={preview} alt="logo preview" className="w-10 h-10 object-contain" />
            ) : (
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-green-500 shadow-inner" />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickLogo(f); e.target.value = ""; }}
            />
            <button className="win98-button px-2 py-0.5" disabled={busy} onClick={() => fileRef.current?.click()}>Choose Image…</button>
            <button className="win98-button px-2 py-0.5 text-red-700" disabled={busy || !preview} onClick={clearLogo}>Reset to default</button>
          </div>
        </div>
      </div>

      <div>
        <div className="font-bold mb-1">Site Name</div>
        <input
          className="win98-inset px-1 w-full"
          value={siteName}
          maxLength={60}
          onChange={(e) => setSiteName(e.target.value)}
        />
        <div className="text-[11px] text-gray-700 mt-1">Shown in the start menu sidebar. Limited to 60 characters.</div>
      </div>

      <div className="flex gap-1">
        <button className="win98-button px-3 py-0.5 font-bold" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save Changes"}</button>
      </div>
      {err && <div className="text-red-700 text-xs">{err}</div>}
      {msg && <div className="text-green-700 text-xs">{msg}</div>}
    </div>
  );
}
