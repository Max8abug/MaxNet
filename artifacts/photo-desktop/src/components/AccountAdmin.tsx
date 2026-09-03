import { useEffect, useState } from "react";
import { adminUpdateAccount, fetchUsers, type PublicUser } from "../lib/api";
import { useAuth } from "../lib/auth-store";

export function AccountAdmin() {
  const me = useAuth((s) => s.user);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [nextUsername, setNextUsername] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const rows = await fetchUsers();
      setUsers(rows);
      setSelected((current) => {
        const stillExists = current && rows.some((u) => u.username === current);
        return stillExists ? current : (rows[0]?.username || "");
      });
    } catch (e: any) {
      setErr(e?.message || "Could not load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const selectedUser = users.find((u) => u.username === selected) || null;
  const ownerSelected = selectedUser?.username === "Max8abug";

  useEffect(() => {
    setNextUsername(selectedUser?.username || "");
    setNextPassword("");
    setErr(null);
    setNotice(null);
  }, [selectedUser?.username]);

  if (!me?.isAdmin) return <div className="p-2 text-xs">Admin only.</div>;

  async function save() {
    if (!selectedUser) return;
    const cleanUsername = nextUsername.trim();
    const usernameChanged = cleanUsername !== selectedUser.username;
    const passwordChanged = nextPassword.length > 0;
    if (!usernameChanged && !passwordChanged) {
      setErr("Change the username or enter a new password.");
      return;
    }
    if (ownerSelected && usernameChanged) {
      setErr("The site owner username cannot be changed.");
      return;
    }
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await adminUpdateAccount(selectedUser.username, {
        ...(usernameChanged ? { username: cleanUsername } : {}),
        ...(passwordChanged ? { password: nextPassword } : {}),
      });
      setSelected(result.username);
      setNextPassword("");
      setNotice(`Saved changes for ${result.username}.`);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Could not update account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full h-full flex flex-col gap-2 text-xs overflow-auto">
      <div className="font-bold">Manage Account Credentials</div>
      <div className="text-gray-600">
        Select an account to change its username or set a new password. Leave the password blank to keep it unchanged.
      </div>

      <label className="flex items-center gap-1">
        <span className="font-bold shrink-0">Account:</span>
        <select
          className="win98-inset px-1 py-0.5 flex-1 min-w-0"
          value={selected}
          disabled={loading || busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.username} value={u.username}>
              {u.username}{u.isAdmin ? " (admin)" : ""}
            </option>
          ))}
        </select>
      </label>

      {loading && <div className="text-gray-500">Loading accounts…</div>}
      {!loading && !selectedUser && <div className="text-gray-500">No accounts found.</div>}
      {selectedUser && (
        <div className="win98-inset bg-white p-2 flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span>Username</span>
            <input
              className="win98-inset px-1"
              value={nextUsername}
              disabled={busy || ownerSelected}
              onChange={(e) => setNextUsername(e.target.value)}
              maxLength={32}
            />
          </label>
          {ownerSelected && <div className="text-[10px] text-gray-600">The site owner name is reserved and cannot be renamed.</div>}
          <label className="flex flex-col gap-1">
            <span>New password</span>
            <input
              type="password"
              className="win98-inset px-1"
              value={nextPassword}
              disabled={busy}
              onChange={(e) => setNextPassword(e.target.value)}
              placeholder="Leave blank to keep current password"
              maxLength={128}
            />
          </label>
          <button className="win98-button px-3 py-1 self-end" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save Account"}
          </button>
        </div>
      )}
      {err && <div className="text-red-700">{err}</div>}
      {notice && <div className="text-green-700">{notice}</div>}
    </div>
  );
}