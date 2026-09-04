import { Moon, Sun } from 'lucide-react';
import { useThemeMode } from '../lib/theme';

export function ThemePreferencePrompt() {
  const { needsInitialChoice, chooseInitialTheme } = useThemeMode();

  if (!needsInitialChoice) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-[#001d2b]/55 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-preference-title"
    >
      <div className="theme-preference-dialog win98-window w-[420px] max-w-full bg-[#c0c0c0]">
        <div className="win98-titlebar px-2 py-1 text-sm">
          <span>Welcome to Photo Desktop</span>
        </div>
        <div className="flex flex-col gap-3 p-3 text-sm">
          <div>
            <h2 id="theme-preference-title" className="font-bold">
              Choose your display theme
            </h2>
            <p className="mt-1 text-xs text-gray-700">
              Pick the look you prefer. You can change this later from Settings.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="theme-choice-card theme-choice-card-light win98-button flex min-h-24 flex-col items-start justify-between gap-2 p-2 text-left"
              onClick={() => chooseInitialTheme(false)}
              data-testid="button-theme-light"
            >
              <span className="flex h-9 w-9 items-center justify-center bg-[#008080] text-white">
                <Sun className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-bold">Light mode</span>
                <span className="block text-[10px] font-normal text-gray-600">
                  Classic bright desktop
                </span>
              </span>
            </button>
            <button
              type="button"
              className="theme-choice-card theme-choice-card-dark win98-button flex min-h-24 flex-col items-start justify-between gap-2 bg-[#1b222b] p-2 text-left text-white"
              onClick={() => chooseInitialTheme(true)}
              data-testid="button-theme-dark"
            >
              <span className="flex h-9 w-9 items-center justify-center bg-[#6d185f] text-white">
                <Moon className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-bold">Dark mode</span>
                <span className="block text-[10px] font-normal text-white/70">
                  Softer, low-light surfaces
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}