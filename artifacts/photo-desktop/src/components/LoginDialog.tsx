import { useState } from "react";
import { useAuth } from "../lib/auth-store";

interface Props { onClose: () => void; }

export function LoginDialog({ onClose }: Props) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      if (mode === "login") await login(username, password);
      else await signup(username, password);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="win98-window bg-[#c0c0c0] w-[300px] flex flex-col" onPointerDown={(e) => e.stopPropagation()}>
        <div className="bg-[#000080] text-white px-2 py-1 flex items-center justify-between text-sm">
          <span>{mode === "login" ? "Log In" : "Create Account"}</span>
          <button className="win98-button px-1.5 leading-none" onClick={onClose}>x</button>
        </div>
        <div className="p-3 flex flex-col gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span>Username</span>
            <input
              className="win98-inset px-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Password</span>
            <input
              type="password"
              className="win98-inset px-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            />
          </label>
          {err && <div className="text-red-700 text-xs">{err}</div>}
          <div className="flex gap-2 mt-1">
            <button className="win98-button px-3 py-1 font-bold" disabled={busy} onClick={submit}>
              {mode === "login" ? "Log In" : "Sign Up"}
            </button>
            <button
              className="win98-button px-3 py-1"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Need an account?" : "Have an account?"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
