import { useDesktopStore } from '../store';
import { RedStrings } from './RedStrings';
import { Window } from './Window';
import { ToastHost } from './Toast';
import { ImageViewerHost } from './ImageViewer';
import { useRef, useEffect } from 'react';
import { useAuth } from '../lib/auth-store';
import { useThemeMode } from '../lib/theme';

export function Desktop({ page }: { page: string }) {
  const windows = useDesktopStore(state => state.windows[page] || []);
  const setActivePage = useDesktopStore(state => state.setActivePage);
  const boundsRef = useRef<HTMLDivElement>(null);
  const user = useAuth((s) => s.user);
  const siteSettings = useAuth((s) => s.siteSettings);
  const { darkMode } = useThemeMode();

  // A saved personal background must always win over the site default. Use
  // nullish fallback semantics so a real user value is never shadowed by the
  // default-background setting.
  const personalBackground = darkMode ? user?.darkBackgroundUrl : user?.backgroundUrl;
  const backgroundUrl = personalBackground ?? (darkMode
    ? siteSettings.darkBackgroundDataUrl
    : siteSettings.backgroundDataUrl);
  const bgStyle: React.CSSProperties = backgroundUrl
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: "cover", backgroundPosition: "center", backgroundColor: user?.backgroundColor || "#008080" }
    : { backgroundColor: user?.backgroundColor || "#008080" };

  useEffect(() => { setActivePage(page); }, [page, setActivePage]);

  useEffect(() => {
    const store = useDesktopStore.getState();
    if (!store.windows[page]) {
      useDesktopStore.setState(state => ({
        windows: { ...state.windows, [page]: [] },
        strings: { ...state.strings, [page]: [] }
      }));
    }
  }, [page]);

  return (
    <div
      ref={boundsRef}
      className={`desktop-surface absolute inset-0 overflow-hidden ${darkMode && !backgroundUrl ? "dark-solid-background" : ""}`}
      style={{ minWidth: '100vw', minHeight: '100vh', ...bgStyle }}
    >
      <RedStrings page={page} />
      {windows.map(w => (
        <Window key={w.id} window={w} page={page} boundsRef={boundsRef} />
      ))}
      <ToastHost />
      <ImageViewerHost />
    </div>
  );
}
