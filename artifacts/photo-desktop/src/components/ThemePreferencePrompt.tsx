import { Moon, Sun } from 'lucide-react';
import { THEME_OPTIONS, useThemeMode } from '../lib/theme';

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
            {THEME_OPTIONS.map((option) => {
              const isDark = option.value.endsWith("dark");
              const isXp = option.value.startsWith("xp-");
              const isVista = option.value === "vista" || option.value === "vista-dark";
              const isGold = option.value === "gold";
              const isSilver = option.value === "silver";
              const Icon = isDark ? Moon : Sun;
              const description = isXp
                ? isDark ? "XP blue with dark surfaces" : "Classic XP blue and green"
                : isVista ? isDark ? "Dark Aero glass and midnight surfaces" : "Translucent glass and Aero blue"
                  : isGold ? "Ornate carved gold window frames"
                    : isSilver ? "Ornate silver frames with cool blue accents"
                    : isDark ? "Classic desktop in low-light colors" : "Classic bright desktop";
              const iconSurface = isXp
                ? "rounded-md bg-gradient-to-b from-[#3d8cf5] to-[#0640b0]"
                : isVista ? isDark
                  ? "rounded-md bg-gradient-to-br from-[#446c86] via-[#26394c] to-[#0d1623]"
                  : "rounded-md bg-gradient-to-br from-[#7fe3d4] via-[#4e9ed2] to-[#14385c]"
                  : isGold ? "bg-gradient-to-br from-[#fff3b0] via-[#c8921e] to-[#5a3b05]"
                    : isSilver ? "bg-gradient-to-br from-[#f4f7fb] via-[#aebbc9] to-[#374d65]"
                    : isDark ? "bg-[#6d185f]" : "bg-[#008080]";
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`theme-choice-card win98-button flex min-h-24 flex-col items-start justify-between gap-2 p-2 text-left ${isDark ? "text-white" : ""}`}
                  style={isDark ? { backgroundColor: "#1b222b", color: "#fff" } : undefined}
                  onClick={() => chooseInitialTheme(option.value)}
                  data-testid={
                    option.value === "classic-light" ? "button-theme-light"
                      : option.value === "classic-dark" ? "button-theme-dark"
                        : `button-theme-${option.value}`
                  }
                >
                  <span className={`flex h-9 w-9 items-center justify-center text-white ${iconSurface}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-bold">{option.label}</span>
                    <span className={`block text-[10px] font-normal ${isDark ? "text-white/70" : "text-gray-600"}`}>
                      {description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}