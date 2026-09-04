import type { ComponentType, RefObject } from 'react';
import { useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bird,
  BookOpen,
  Coffee,
  Crown,
  ExternalLink,
  Gamepad2,
  Globe,
  Hash,
  Image,
  Link2,
  MessageCircle,
  MessagesSquare,
  Music,
  Newspaper,
  Pencil,
  Send,
  Spade,
  StickyNote,
  UserRound,
  Users,
  Vote,
  Youtube,
} from 'lucide-react';
import { Window } from './Window';
import { useDesktopStore, type WindowData, type WindowType } from '../store';

type MobileWindowProps = {
  window: WindowData;
  page: string;
  boundsRef: RefObject<HTMLDivElement | null>;
  mobile?: boolean;
  mode?: 'mobile';
  onMobileClose: () => void;
};

type AppDefinition = {
  label: string;
  type: WindowType;
  icon: typeof Newspaper;
  tone: string;
};

const EMPTY_WINDOWS: WindowData[] = [];

const APPS: AppDefinition[] = [
  { label: 'Site News', type: 'news', icon: Newspaper, tone: 'bg-[#f2d36b]' },
  { label: 'Photo Gallery', type: 'sharedphotos', icon: Image, tone: 'bg-[#f0a36b]' },
  { label: 'YouTube', type: 'youtube', icon: Youtube, tone: 'bg-[#e66d72]' },
  { label: 'Forum', type: 'forum', icon: MessagesSquare, tone: 'bg-[#b59be8]' },
  { label: 'Music', type: 'music', icon: Music, tone: 'bg-[#7fc6cf]' },
  { label: 'Polls', type: 'polls', icon: Vote, tone: 'bg-[#91c995]' },
  { label: 'Chess', type: 'chess', icon: Crown, tone: 'bg-[#d7a3c3]' },
  { label: 'Cafe', type: 'cafe', icon: Coffee, tone: 'bg-[#e0a77c]' },
  { label: 'Direct Messages', type: 'dms', icon: Send, tone: 'bg-[#7fadd9]' },
  { label: 'Users', type: 'userlist', icon: Users, tone: 'bg-[#93c8af]' },
  { label: 'Web Browser', type: 'browser', icon: Globe, tone: 'bg-[#9ab5e5]' },
  { label: 'My Page', type: 'mypage', icon: UserRound, tone: 'bg-[#d5a7dc]' },
  { label: 'Blackjack', type: 'blackjack', icon: Spade, tone: 'bg-[#cd8585]' },
  { label: 'Flappy Bird', type: 'flappy', icon: Bird, tone: 'bg-[#80c4d7]' },
  { label: 'Geometry Dash', type: 'geometry', icon: Gamepad2, tone: 'bg-[#d8b760]' },
  { label: 'Poker', type: 'poker', icon: Hash, tone: 'bg-[#bc8fd2]' },
  { label: 'Chatbox', type: 'chat', icon: MessageCircle, tone: 'bg-[#7db9bd]' },
  { label: 'Drawings', type: 'drawing', icon: Pencil, tone: 'bg-[#e5a279]' },
  { label: 'Guestbook', type: 'guestbook', icon: BookOpen, tone: 'bg-[#b2c889]' },
  { label: 'Visitor Counter', type: 'visits', icon: BarChart3, tone: 'bg-[#dfc276]' },
  { label: 'Notes', type: 'text', icon: StickyNote, tone: 'bg-[#e4d58a]' },
  { label: 'Shortcut', type: 'link', icon: Link2, tone: 'bg-[#a8b6c8]' },
];

const MobileWindow = Window as unknown as ComponentType<MobileWindowProps>;

function createWindowData(app: AppDefinition): Partial<WindowData> {
  return {
    type: app.type,
    title: app.label,
    x: 0,
    y: 0,
    width: 360,
    height: 680,
    state: 'normal',
    ...(app.type === 'link'
      ? { linkLabel: 'Open Home', linkTarget: '/' }
      : {}),
  };
}

export function MobileShell({ page }: { page: string }) {
  const boundsRef = useRef<HTMLDivElement>(null);
  const [openWindowId, setOpenWindowId] = useState<string | null>(null);
  const windows = useDesktopStore(
    (state) => state.windows[page] ?? EMPTY_WINDOWS,
  );
  const addWindow = useDesktopStore((state) => state.addWindow);
  const updateWindow = useDesktopStore((state) => state.updateWindow);
  const bringToFront = useDesktopStore((state) => state.bringToFront);
  const setActivePage = useDesktopStore((state) => state.setActivePage);

  const openWindow = useMemo(
    () => windows.find((candidate) => candidate.id === openWindowId) ?? null,
    [openWindowId, windows],
  );

  const launchApp = (app: AppDefinition) => {
    const currentWindows = useDesktopStore.getState().windows[page] ?? [];
    const existing = currentWindows.find((candidate) => candidate.type === app.type);

    if (existing) {
      updateWindow(page, existing.id, {
        state: 'normal',
        title: existing.title || app.label,
      });
      bringToFront(page, existing.id);
      setOpenWindowId(existing.id);
      setActivePage(page);
      return;
    }

    addWindow(page, createWindowData(app));
    const createdWindows = useDesktopStore.getState().windows[page] ?? [];
    const created = [...createdWindows]
      .reverse()
      .find((candidate) => candidate.type === app.type);

    if (created) {
      bringToFront(page, created.id);
      setOpenWindowId(created.id);
      setActivePage(page);
    }
  };

  const closeApp = () => {
    setOpenWindowId(null);
    setActivePage(page);
  };

  if (openWindow) {
    return (
      <div
        className="mobile-shell relative flex h-[100dvh] min-h-0 max-h-[100dvh] w-full flex-col overflow-hidden p-1"
        data-testid="mobile-app-view"
      >
        <header className="mobile-app-header win98-window relative z-[100] flex min-h-12 shrink-0 items-center justify-between gap-2 px-2 py-1">
          <div className="min-w-0">
            <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-[#4b4b4b]">
              PHOTO DESKTOP
            </p>
            <p
              className="truncate text-[13px] font-bold text-black"
              data-testid="text-open-app"
            >
              {openWindow.title}
            </p>
          </div>
          <button
            type="button"
            className="win98-button flex min-h-8 shrink-0 items-center gap-1 px-3 text-xs"
            onClick={closeApp}
            data-testid="button-mobile-close"
            aria-label={`Close ${openWindow.title}`}
          >
            <ExternalLink className="h-3.5 w-3.5 rotate-180" strokeWidth={2.5} />
            Back
          </button>
        </header>

        <div
          ref={boundsRef}
          className="mobile-window-stage relative min-h-0 flex-1 overflow-hidden"
          data-testid="mobile-window-stage"
        >
          <MobileWindow
            window={openWindow}
            page={page}
            boundsRef={boundsRef}
            mobile
            mode="mobile"
            onMobileClose={closeApp}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={boundsRef}
      className="mobile-shell flex h-[100dvh] min-h-0 max-h-[100dvh] w-full flex-col overflow-hidden p-1"
      data-testid="mobile-home-screen"
    >
      <header className="mobile-home-header win98-window flex shrink-0 items-center justify-between gap-3 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-bold uppercase tracking-[0.18em] text-[#4b4b4b]">
            PHOTO DESKTOP / POCKET
          </p>
          <h1 className="truncate text-[15px] font-bold text-black">
            App launcher
          </h1>
        </div>
        <div
          className="win98-inset shrink-0 px-2 py-1 text-right text-[9px] leading-tight text-black"
          data-testid="status-mobile-desktop"
        >
          <div className="font-bold text-[#006b65]">READY</div>
          <div>{APPS.length} apps</div>
        </div>
      </header>

      <main className="mobile-home-main min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-3 overscroll-contain">
        <div className="mb-3 flex items-end justify-between px-1">
          <div>
            <p className="text-[13px] font-bold text-white">Your programs</p>
            <p className="text-[10px] text-[#d7ffff]">
              Tap an app to open it full screen.
            </p>
          </div>
          <div className="text-[10px] text-[#d7ffff]" data-testid="text-page-path">
            {page}
          </div>
        </div>

        <section
          className="mobile-app-grid grid grid-cols-3 gap-2.5 sm:grid-cols-4"
          aria-label="Desktop applications"
          data-testid="app-grid"
        >
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.type}
                type="button"
                className="mobile-tile group flex min-h-[84px] flex-col items-center justify-start gap-1 rounded-sm px-1 py-2 text-center text-white transition-transform active:translate-y-px"
                onClick={() => launchApp(app)}
                data-testid={`button-launch-${app.type}`}
                aria-label={`Open ${app.label}`}
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center border-2 border-white/80 ${app.tone} text-[#14283d] shadow-[2px_2px_0_rgba(0,0,0,0.42)] transition-transform group-active:translate-y-px`}
                >
                  <Icon className="h-7 w-7" strokeWidth={1.8} />
                </span>
                <span className="max-w-full text-[11px] font-bold leading-[1.08] [text-shadow:1px_1px_0_#005050]">
                  {app.label}
                </span>
              </button>
            );
          })}
        </section>
      </main>

      <footer className="mobile-dock win98-window flex shrink-0 items-center justify-between gap-2 px-2 py-1.5 text-[10px] text-black">
        <span className="flex min-w-0 items-center gap-1.5" data-testid="text-mobile-footer">
          <span className="mobile-dock-led" aria-hidden="true" />
          <span className="truncate">Personal web desktop</span>
        </span>
        <span className="shrink-0 text-[#4b4b4b]">Scroll for more</span>
      </footer>
    </div>
  );
}