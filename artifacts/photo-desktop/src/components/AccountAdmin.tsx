import { useEffect, useState } from "react";
import {
  adminUpdateAccount,
  fetchDeviceAppeals,
  fetchUsers,
  resolveDeviceAppeal,
  type DeviceAppeal,
  type PublicUser,
} from "../lib/api";
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
  const [tab, setTab] = useState<"accounts" | "appeals">("accounts");
  const [appeals, setAppeals] = useState<DeviceAppeal[]>([]);
  const [appealsLoading, setAppealsLoading] = useState(false);
  const [appealBusy, setAppealBusy] = useState<number | null>(null);

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

  async function loadAppeals() {
    setAppealsLoading(true);
    try {
      setAppeals(await fetchDeviceAppeals());
    } catch (e: any) {
      setErr(e?.message || "Could not load device appeals");
    } finally {
      setAppealsLoading(false);
    }
  }

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

  async function resolveAppeal(appeal: DeviceAppeal, decision: "approved" | "denied") {
    const action = decision === "approved" ? "approve" : "deny";
    const response = prompt(`${action === "approve" ? "Approval note" : "Reason for denial"} for ${appeal.username}:`, "");
    if (response === null) return;
    setAppealBusy(appeal.id);
    setErr(null);
    try {
      await resolveDeviceAppeal(appeal.id, decision, response);
      setNotice(`${appeal.username}'s device appeal was ${decision}.`);
      await loadAppeals();
    } catch (e: any) {
      setErr(e?.message || "Could not resolve appeal");
    } finally {
      setAppealBusy(null);
    }
  }

  return (
    <div className="w-full h-full flex flex-col gap-2 text-xs overflow-auto">
      <div className="flex gap-1 shrink-0">
        <button className={`win98-button px-2 py-1 ${tab === "accounts" ? "font-bold bg-blue-100" : ""}`} onClick={() => setTab("accounts")}>
          Accounts
        </button>
        <button
          className={`win98-button px-2 py-1 ${tab === "appeals" ? "font-bold bg-blue-100" : ""}`}
          onClick={() => { setTab("appeals"); void loadAppeals(); }}
        >
          Device Appeals
        </button>
      </div>

      {tab === "appeals" ? (
        <div className="flex flex-col gap-2 overflow-auto">
          <div className="text-gray-600">
            Flagged devices pause login until an admin reviews the account's written appeal. Device IDs are internal numeric references only.
          </div>
          {appealsLoading && <div className="text-gray-500">Loading appeals…</div>}
          {!appealsLoading && appeals.length === 0 && <div className="text-gray-500">No device appeals.</div>}
          {appeals.map((appeal) => (
            <div key={appeal.id} className="win98-inset bg-white p-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{appeal.username}</span>
                <span className="text-[10px] text-gray-600">device #{appeal.deviceId}</span>
                <span className={`px-1 text-[10px] font-bold ${appeal.status === "open" ? "bg-yellow-200 text-yellow-900" : appeal.status === "approved" ? "bg-green-200 text-green-900" : "bg-red-200 text-red-900"}`}>
                  {appeal.status}
                </span>
                <span className="ml-auto text-[10px] text-gray-500">{new Date(appeal.createdAt).toLocaleString()}</span>
              </div>
              <div className="whitespace-pre-wrap break-words border border-gray-300 bg-[#fffbe6] p-1">{appeal.message}</div>
              {appeal.adminResponse && <div className="text-gray-600">Admin response: {appeal.adminResponse}</div>}
              {appeal.status === "open" && (
                <div className="flex gap-1 justify-end pt-1">
                  <button className="win98-button px-2 py-1 text-green-800 font-bold" disabled={appealBusy === appeal.id} onClick={() => void resolveAppeal(appeal, "approved")}>
                    Approve device
                  </button>
                  <button className="win98-button px-2 py-1 text-red-800" disabled={appealBusy === appeal.id} onClick={() => void resolveAppeal(appeal, "denied")}>
                    Deny
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
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
        </>
      )}
      {tab === "appeals" && (
        <>
          {err && <div className="text-red-700">{err}</div>}
          {notice && <div className="text-green-700">{notice}</div>}
        </>
      )}
    </div>
  );
}