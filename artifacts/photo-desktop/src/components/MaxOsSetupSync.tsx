import { useState } from "react";
import { LoginDialog } from "./LoginDialog";
import { getRankInfo, useAuth } from "../lib/auth-store";
import { useCreateMaxOsSetupRequest } from "@workspace/api-client-react";

const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function MaxOsSetupSync() {
  const params = new URLSearchParams(window.location.search);
  const active = params.get("maxnet-os-setup") === "1";
  const state = params.get("maxnet-os-state") || "";
  const { user, loading, ranks } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const createSyncRequest = useCreateMaxOsSetupRequest();
  const rank = user ? getRankInfo(user.rank, ranks) : null;
  if (!active || dismissed) return null;

  async function syncToMaxOs() {
    if (!STATE_PATTERN.test(state)) {
      setError("This setup link is invalid. Close it and start MaxOS account sync again.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { code } = await createSyncRequest.mutateAsync({ data: { state } });
      const callback = new URL("maxnet-os://sync");
      callback.searchParams.set("state", state);
      callback.searchParams.set("code", code);
      setCallbackUrl(callback.toString());
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare the MaxOS settings sync.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[40] flex items-center justify-center bg-black/55 p-4">
        <section
          className="w-full max-w-lg border-2 border-[#182c32] bg-[#e8f0ed] p-1 text-[#142328] shadow-[0_20px_70px_rgba(0,0,0,.45)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="maxos-sync-title"
        >
          <header className="bg-gradient-to-r from-[#146d70] to-[#24454a] px-4 py-3 text-white">
            <h1 id="maxos-sync-title" className="text-lg font-bold">Connect MaxNet to MaxOS</h1>
            <p className="mt-1 text-sm text-white/85">Use your MaxNet account to bring your preferences to this computer.</p>
          </header>
          <div className="space-y-4 p-4">
            {loading ? (
              <p role="status" data-testid="status-maxos-sync-loading">Checking your MaxNet sign-in…</p>
            ) : !user ? (
              <>
                <p>Sign in to sync your MaxNet display theme, profile background, account rank and site permissions, and the apps currently available on MaxNet.</p>
                <p className="text-sm text-gray-700">The sync sends no MaxNet password or browser session to the MaxOS helper. Your browser keeps sign-in locally for MaxNet apps. Site permissions do not grant Linux administrator or sudo access.</p>
                <button
                  type="button"
                  className="win98-button min-h-10 w-full px-3 font-bold"
                  onClick={() => setLoginOpen(true)}
                  data-testid="button-maxos-sign-in"
                >
                  Sign in to MaxNet
                </button>
              </>
            ) : (
              <>
                <div className="border border-[#8a9a96] bg-white/80 p-3" data-testid="summary-maxos-account">
                  <div className="text-sm">Signed in as <strong>{user.username}</strong></div>
                  <div className="mt-1 text-sm">
                    MaxNet rank: <strong>{user.isAdmin ? "Administrator" : rank?.name || user.rank || "Member"}</strong>
                  </div>
                  <div className="mt-1 text-sm">
                    Display theme: <strong>{user.displayTheme || "site default"}</strong>
                  </div>
                  <div className="mt-1 text-sm">
                    Profile background: <strong>{user.backgroundUrl || user.darkBackgroundUrl ? "available" : "not set"}</strong>
                  </div>
                </div>
                <p className="text-sm text-gray-700">MaxOS will save a local copy of these preferences and MaxNet permissions for this account. The site remains the authority for access to MaxNet features. Your local OS password or PIN stays on this computer.</p>
                {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
                {callbackUrl ? (
                  <div className="space-y-2">
                    <p className="text-sm font-bold" role="status" data-testid="status-maxos-sync-ready">Your one-time sync code is ready. Return to the MaxOS desktop to finish.</p>
                    <a
                      href={callbackUrl}
                      className="win98-button flex min-h-10 w-full items-center justify-center px-3 font-bold"
                      data-testid="link-return-to-maxos"
                    >
                      Return to MaxOS
                    </a>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="win98-button min-h-10 w-full px-3 font-bold disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void syncToMaxOs()}
                    data-testid="button-sync-maxos-settings"
                  >
                    {busy ? "Preparing sync…" : "Sync my MaxNet settings"}
                  </button>
                )}
              </>
            )}
            {error && !user && <p className="text-sm text-red-800" role="alert">{error}</p>}
            <button
              type="button"
              className="w-full px-3 py-2 text-sm underline"
              data-testid="button-dismiss-maxos-sync"
              onClick={() => {
                params.delete("maxnet-os-setup");
                params.delete("maxnet-os-state");
                const query = params.toString();
                window.history.replaceState(window.history.state, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
                setDismissed(true);
              }}
            >
              Not now
            </button>
          </div>
        </section>
      </div>
      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </>
  );
}
