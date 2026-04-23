import { useDesktopStore } from '../store';
import { RedStrings } from './RedStrings';
import { Window } from './Window';
import { useRef, useEffect } from 'react';
import { useLocation } from 'wouter';

export function Desktop({ page }: { page: string }) {
  const windows = useDesktopStore(state => state.windows[page] || []);
  const setActivePage = useDesktopStore(state => state.setActivePage);
  const boundsRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

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
      style={{ minWidth: '100vw', minHeight: '100vh' }}
    >
      <RedStrings page={page} />
      {windows.map(w => (
        <Window key={w.id} window={w} page={page} boundsRef={boundsRef} />
      ))}
    </div>
  );
}
