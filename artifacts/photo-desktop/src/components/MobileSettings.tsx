import { useState } from 'react';
import { LogIn, Moon, Palette, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth-store';
import { useThemeMode } from '../lib/theme';
import { LoginDialog } from './LoginDialog';
import { ProfileDialog } from './ProfileDialog';

export function MobileSettings({ onRequestLogin }: { onRequestLogin: () => void }) {
  const user = useAuth((state) => state.user);
  const { darkMode, setDarkMode } = useThemeMode();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="mobile-settings flex h-full flex-col gap-3 overflow-y-auto p-3 text-sm">
      <div className="mobile-settings-hero win98-inset flex items-center gap-3 p-3">
        <div className="mobile-settings-mark flex h-12 w-12 shrink-0 items-center justify-center">
          <Palette className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <div className="font-bold">Pocket settings</div>
          <div className="text-xs text-gray-600">
            Tune the look and feel of your desktop.
          </div>
        </div>
      </div>

      <section className="mobile-settings-card win98-inset p-3">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <Moon className="h-4 w-4" />
          Appearance
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(event) => setDarkMode(event.target.checked)}
          />
          <span>Use dark mode</span>
        </label>
        <p className="mt-1 text-xs text-gray-600">
          Applies immediately across the desktop, windows, and launcher.
        </p>
      </section>

      <section className="mobile-settings-card win98-inset p-3">
        <div className="mb-2 flex items-center gap-2 font-bold">
          <UserRound className="h-4 w-4" />
          Account
        </div>
        {user ? (
          <>
            <div className="mb-2 text-xs text-gray-600">
              Signed in as <b>{user.username}</b>
              {user.isAdmin ? ' · administrator' : ''}
            </div>
            <button
              type="button"
              className="win98-button flex min-h-9 w-full items-center justify-center gap-2 px-3 text-xs"
              onClick={() => setProfileOpen(true)}
            >
              <UserRound className="h-4 w-4" />
              Open profile settings
            </button>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-600">
              Sign in to change your avatar, background, timezone, username, or password.
            </p>
            <button
              type="button"
              className="win98-button flex min-h-9 w-full items-center justify-center gap-2 px-3 text-xs"
              onClick={onRequestLogin}
            >
              <LogIn className="h-4 w-4" />
              Log in or create an account
            </button>
          </>
        )}
      </section>

      {profileOpen && (
        <ProfileDialog mobile onClose={() => setProfileOpen(false)} />
      )}
    </div>
  );
}