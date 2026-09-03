import { useRef, useState } from "react";
import { useAuth } from "../lib/auth-store";
import { changePassword } from "../lib/api";
import { useThemeMode } from "../lib/theme";
import { TIME_ZONE_OPTIONS } from "../lib/time-settings";

interface Props { onClose: () => void; }

function fileToDataUrl(file: File, maxSize = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToDataUrlRaw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ProfileDialog({ onClose }: Props) {
  const { user, updateProfile } = useAuth();
  const { darkMode, setDarkMode } = useThemeMode();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [color, setColor] = useState(user?.backgroundColor || "#008080");
  const [timeZone, setTimeZone] = useState(user?.timeZone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const darkBgRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  async function pickAvatar(file: File) {
    setBusy(true); setErr(null);
    try {
      // Store at higher resolution so small chat/forum displays stay sharp.
      const dataUrl = await fileToDataUrl(file, 384);
      await updateProfile({ avatarUrl: dataUrl });
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function pickBg(file: File) {
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file, 1600);
      await updateProfile({ backgroundUrl: dataUrl, backgroundColor: null });
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function pickDarkBg(file: File) {
    setBusy(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file, 1600);
      await updateProfile({ darkBackgroundUrl: dataUrl });
    } catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function applyColor() {
    setBusy(true); setErr(null);
    try { await updateProfile({ backgroundColor: color, backgroundUrl: null }); }
    catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function clearAvatar() {
    setBusy(true);
    try { await updateProfile({ avatarUrl: null }); }
    finally { setBusy(false); }
  }

  async function clearBg() {
    setBusy(true);
    try { await updateProfile({ backgroundUrl: null, darkBackgroundUrl: null, backgroundColor: null }); }
    finally { setBusy(false); }
  }

  async function clearLightBg() {
    setBusy(true); setErr(null);
    try { await updateProfile({ backgroundUrl: null }); }
    catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function clearDarkBg() {
    setBusy(true); setErr(null);
    try { await updateProfile({ darkBackgroundUrl: null }); }
    catch (e: any) { setErr(e?.message || "Failed"); }
    finally { setBusy(false); }
  }

  async function applyTimeZone(value: string) {
    setTimeZone(value);
    setBusy(true); setErr(null);
    try {
      await updateProfile({ timeZone: value || null });
    } catch (e: any) {
      setErr(e?.message || "Failed to save time zone");
    } finally {
      setBusy(false);
    }
  }

  async function applyPassword() {
    setBusy(true); setErr(null); setPasswordNotice(null);
    if (newPassword !== confirmPassword) {
      setErr("New passwords do not match.");
      setBusy(false);
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordNotice("Password changed.");
    } catch (e: any) {
      setErr(e?.message || "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="win98-window bg-[#c0c0c0] w-[360px] flex flex-col" onPointerDown={(e) => e.stopPropagation()}>
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between text-sm">
          <span>Profile Settings — {user.username}</span>
          <button className="win98-button px-1.5 leading-none" onClick={onClose}>x</button>
        </div>
        <div className="p-3 flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-3">
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" className="w-16 h-16 win98-inset object-cover" style={{ imageRendering: "auto" }} />
              : <div className="w-16 h-16 win98-inset bg-gray-300 flex items-center justify-center text-2xl">?</div>}
            <div className="flex flex-col gap-1 flex-1">
              <button className="win98-button px-2 py-0.5" disabled={busy} onClick={() => avatarRef.current?.click()}>
                Change Avatar...
              </button>
              <button className="win98-button px-2 py-0.5 text-xs" disabled={busy} onClick={clearAvatar}>
                Remove Avatar
              </button>
            </div>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickAvatar(f); e.target.value = ""; }} />
          </div>

          <div className="border-t border-gray-400 pt-2">
            <div className="font-bold mb-1">Light Mode Background</div>
            <div className="flex flex-col gap-1">
              <button className="win98-button px-2 py-0.5" disabled={busy} onClick={() => bgRef.current?.click()}>
                Upload Background Image...
              </button>
              <input ref={bgRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickBg(f); e.target.value = ""; }} />
              <div className="flex items-center gap-2 mt-1">
                <span>Solid color:</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="win98-inset" />
                <button className="win98-button px-2 py-0.5" disabled={busy} onClick={applyColor}>Apply</button>
              </div>
              <button className="win98-button px-2 py-0.5 text-xs self-start" disabled={busy || !user.backgroundUrl} onClick={clearLightBg}>
                Reset Light Background
              </button>
            </div>
          </div>
          <div className="border-t border-gray-400 pt-2">
            <div className="font-bold mb-1">Dark Mode Background</div>
            <div className="text-[11px] text-gray-700 mb-1">
              Used only while dark mode is enabled. If empty, the site’s dark default is used.
            </div>
            <button className="win98-button px-2 py-0.5" disabled={busy} onClick={() => darkBgRef.current?.click()}>
              Upload Dark Background Image...
            </button>
            <input ref={darkBgRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickDarkBg(f); e.target.value = ""; }} />
            <button className="win98-button px-2 py-0.5 text-xs self-start mt-1" disabled={busy || !user.darkBackgroundUrl} onClick={clearDarkBg}>
              Reset Dark Background
            </button>
          </div>
          <button className="win98-button px-2 py-0.5 text-xs self-start" disabled={busy || (!user.backgroundUrl && !user.darkBackgroundUrl && !user.backgroundColor)} onClick={clearBg}>
            Reset All Backgrounds
          </button>
          <div className="border-t border-gray-400 pt-2">
            <div className="font-bold mb-1">Password</div>
            <div className="flex flex-col gap-1">
              <input
                className="win98-inset px-1 py-0.5"
                type="password"
                autoComplete="current-password"
                placeholder="Current password"
                value={currentPassword}
                disabled={busy}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input
                className="win98-inset px-1 py-0.5"
                type="password"
                autoComplete="new-password"
                placeholder="New password (4-128 characters)"
                value={newPassword}
                disabled={busy}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                className="win98-inset px-1 py-0.5"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                value={confirmPassword}
                disabled={busy}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                className="win98-button px-2 py-0.5 text-xs self-start"
                disabled={busy || !currentPassword || !newPassword || !confirmPassword}
                onClick={() => void applyPassword()}
              >
                Change Password
              </button>
              {passwordNotice && <div className="text-green-700 text-xs">{passwordNotice}</div>}
            </div>
          </div>
          <div className="border-t border-gray-400 pt-2">
            <div className="font-bold mb-1">Display</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={darkMode}
                onChange={(e) => setDarkMode(e.target.checked)}
              />
              <span>Dark mode</span>
            </label>
            <div className="text-xs text-gray-600 mt-1">
              Uses softer dark surfaces to reduce bright backgrounds.
            </div>
            <label className="flex items-center gap-2 mt-2">
              <span className="shrink-0">Time zone:</span>
              <select
                className="win98-inset min-w-0 flex-1 px-1 py-0.5"
                value={timeZone}
                disabled={busy}
                onChange={(e) => void applyTimeZone(e.target.value)}
              >
                {TIME_ZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <div className="text-xs text-gray-600 mt-1">
              Dates and times across the site use this setting.
            </div>
          </div>
          {err && <div className="text-red-700 text-xs">{err}</div>}
        </div>
      </div>
    </div>
  );
}
