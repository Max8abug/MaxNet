import { useDesktopStore } from '../store';
import { RedStrings } from './RedStrings';
import { Window } from './Window';
import { useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth-store';

export function Desktop({ page }: { page: string }) {
  const windows = useDesktopStore(state => state.windows[page] || []);
  const setActivePage = useDesktopStore(state => state.setActivePage);
  const boundsRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const user = useAuth((s) => s.user);

  const bgStyle: React.CSSProperties = user?.backgroundUrl
    ? { backgroundImage: `url(${user.backgroundUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : user?.backgroundColor
      ? { backgroundColor: user.backgroundColor }
      : {};

  useEffect(() => {
    setActivePage(page);
  }, [page, setActivePage]);

  // Initial setup for missing pages
  useEffect(() => {
    const store = useDesktopStore.getState();
    if (!store.windows[page]) {
      // Just initialize empty if it doesn't exist
      useDesktopStore.setState(state => ({
        windows: { ...state.windows, [page]: [] },
        strings: { ...state.strings, [page]: [] }
      }));
    }
  }, [page]);

  return (
    <div 
      ref={boundsRef}
      className="absolute inset-0 overflow-hidden" 
      style={{ minWidth: '100vw', minHeight: '100vh', ...bgStyle }}
    >
      <RedStrings page={page} />
      {windows.map(w => (
        <Window key={w.id} window={w} page={page} boundsRef={boundsRef} />
      ))}
    </div>
  );
}
