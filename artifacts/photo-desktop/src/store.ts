import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type WindowType = 'photo' | 'gallery' | 'text' | 'link' | 'youtube' | 'drawing' | 'chat' | 'visits' | 'guestbook' | 'sharedphotos' | 'forum' | 'blackjack' | 'flappy' | 'music' | 'polls' | 'chess' | 'cafe' | 'dms' | 'userpage' | 'ranksadmin' | 'userlist' | 'mypage';

export type WindowState = 'normal' | 'min' | 'max';

export interface WindowData {
  id: string;
  type: WindowType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  title: string;
  content?: string;
  imageUrl?: string;
  images?: string[];
  linkTarget?: string;
  linkLabel?: string;
  youtubeUrl?: string;
  state?: WindowState;
  prev?: { x: number; y: number; width: number; height: number };
  // for userpage
  username?: string;
}

export interface StringConnection {
  id: string;
  fromId: string;
  toId: string;
}

export interface DesktopState {
  windows: Record<string, WindowData[]>;
  strings: Record<string, StringConnection[]>;
  activePage: string;
  maxZIndex: number;
  isStringMode: boolean;
  stringStartId: string | null;

  addWindow: (page: string, data: Partial<WindowData>) => void;
  updateWindow: (page: string, id: string, data: Partial<WindowData>) => void;
  removeWindow: (page: string, id: string) => void;
  bringToFront: (page: string, id: string) => void;
  toggleWindowState: (page: string, id: string, mode: WindowState) => void;

  addString: (page: string, fromId: string, toId: string) => void;
  removeString: (page: string, id: string) => void;

  setStringMode: (active: boolean) => void;
  setStringStart: (id: string | null) => void;
  setActivePage: (page: string) => void;

  resetState: () => void;
}

const initialWindows = {
  '/': [
    { id: 'w1', type: 'text', x: 50, y: 50, width: 300, height: 200, zIndex: 1, title: 'readme.txt', content: '# Welcome to my desktop\nI am a photographer. This is my digital space.\n\nClick and drag windows. Resize them. Draw strings between them.' },
    { id: 'w2', type: 'sharedphotos', x: 400, y: 80, width: 460, height: 460, zIndex: 2, title: 'Photo Gallery' },
    { id: 'w3', type: 'link', x: 100, y: 300, width: 250, height: 150, zIndex: 3, title: 'Shortcut to Street', linkTarget: '/street', linkLabel: 'Open Street Desk' }
  ],
  '/street': [
    { id: 's1', type: 'gallery', x: 100, y: 100, width: 500, height: 400, zIndex: 1, title: 'Street Gallery', images: ['/src/assets/street-1.png', '/src/assets/street-2.png', '/src/assets/street-3.png'] },
    { id: 's2', type: 'link', x: 650, y: 150, width: 200, height: 120, zIndex: 2, title: 'Go Home', linkTarget: '/', linkLabel: 'Back to Home' }
  ],
  '/about': [
    { id: 'a1', type: 'text', x: 200, y: 100, width: 400, height: 300, zIndex: 1, title: 'bio.txt', content: 'A photographer exploring the intersection of light and memory. Currently based in neo-tokyo.' },
    { id: 'a2', type: 'link', x: 200, y: 450, width: 200, height: 120, zIndex: 2, title: 'Go Home', linkTarget: '/', linkLabel: 'Back to Home' }
  ]
} as Record<string, WindowData[]>;

const initialStrings = {
  '/': [{ id: 'str1', fromId: 'w1', toId: 'w2' }]
} as Record<string, StringConnection[]>;

export const useDesktopStore = create<DesktopState>()(
  persist(
    (set, get) => ({
      windows: initialWindows,
      strings: initialStrings,
      activePage: '/',
      maxZIndex: 10,
      isStringMode: false,
      stringStartId: null,

      addWindow: (page, data) => set((state) => {
        const id = 'win_' + Math.random().toString(36).substring(2, 9);
        const zIndex = state.maxZIndex + 1;
        const newWindow = {
          id, type: 'text', x: 100, y: 100, width: 300, height: 200, zIndex, title: 'New Window', state: 'normal',
          ...data
        } as WindowData;
        return {
          windows: { ...state.windows, [page]: [...(state.windows[page] || []), newWindow] },
          maxZIndex: zIndex
        };
      }),

      updateWindow: (page, id, data) => set((state) => ({
        windows: {
          ...state.windows,
          [page]: (state.windows[page] || []).map(w => w.id === id ? { ...w, ...data } : w)
        }
      })),

      removeWindow: (page, id) => set((state) => ({
        windows: {
          ...state.windows,
          [page]: (state.windows[page] || []).filter(w => w.id !== id)
        },
        strings: {
          ...state.strings,
          [page]: (state.strings[page] || []).filter(s => s.fromId !== id && s.toId !== id)
        }
      })),

      bringToFront: (page, id) => set((state) => {
        const zIndex = state.maxZIndex + 1;
        return {
          windows: {
            ...state.windows,
            [page]: (state.windows[page] || []).map(w => w.id === id ? { ...w, zIndex } : w)
          },
          maxZIndex: zIndex
        };
      }),

      toggleWindowState: (page, id, mode) => set((state) => ({
        windows: {
          ...state.windows,
          [page]: (state.windows[page] || []).map(w => {
            if (w.id !== id) return w;
            const cur = w.state || 'normal';
            if (mode === 'min') {
              return { ...w, state: cur === 'min' ? 'normal' : 'min' };
            }
            if (mode === 'max') {
              if (cur === 'max') {
                const p = w.prev;
                return { ...w, state: 'normal', x: p?.x ?? w.x, y: p?.y ?? w.y, width: p?.width ?? w.width, height: p?.height ?? w.height };
              }
              return { ...w, state: 'max', prev: { x: w.x, y: w.y, width: w.width, height: w.height } };
            }
            return w;
          })
        }
      })),

      addString: (page, fromId, toId) => set((state) => {
        if (fromId === toId) return state;
        const exists = (state.strings[page] || []).some(
          s => (s.fromId === fromId && s.toId === toId) || (s.fromId === toId && s.toId === fromId)
        );
        if (exists) return state;

        const id = 'str_' + Math.random().toString(36).substring(2, 9);
        return {
          strings: { ...state.strings, [page]: [...(state.strings[page] || []), { id, fromId, toId }] },
          stringStartId: null,
          isStringMode: false
        };
      }),

      removeString: (page, id) => set((state) => ({
        strings: {
          ...state.strings,
          [page]: (state.strings[page] || []).filter(s => s.id !== id)
        }
      })),

      setStringMode: (active) => set({ isStringMode: active, stringStartId: null }),
      setStringStart: (id) => set({ stringStartId: id }),
      setActivePage: (page) => set({ activePage: page }),

      resetState: () => set({ windows: initialWindows, strings: initialStrings, activePage: '/', maxZIndex: 10, isStringMode: false, stringStartId: null })
    }),
    {
      name: 'photo-desktop-storage',
      version: 2,
      migrate: (persistedState: any, version: number) => {
        if (version < 2 && persistedState?.windows?.['/']) {
          // Replace default w2 photo window with sharedphotos
          persistedState.windows['/'] = persistedState.windows['/'].map((w: WindowData) =>
            (w.id === 'w2' && w.type === 'photo' && w.title === 'latest_shot.jpg')
              ? { ...w, type: 'sharedphotos', title: 'Photo Gallery', width: 460, height: 460, imageUrl: undefined, content: undefined }
              : w
          );
        }
        return persistedState;
      },
    }
  )
);
