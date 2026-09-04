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
  DatabaseBackup,
  Activity,
  Settings,
  ShieldCheck,
  UserCog,
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
import { useAuth } from '../lib/auth-store';

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
  size: 'wide' | 'medium' | 'small';
  subtitle?: string;
  adminOnly?: boolean;
};

const EMPTY_WINDOWS: WindowData[] = [];

const APPS: AppDefinition[] = [
  { label: 'Site News', type: 'news', icon: Newspaper, tone: 'bg-[#f2d36b]', size: 'wide', subtitle: 'Latest updates' },
  { label: 'Chatbox', type: 'chat', icon: MessageCircle, tone: 'bg-[#7db9bd]', size: 'wide', subtitle: 'Live conversation' },
  { label: 'Forum', type: 'forum', icon: MessagesSquare, tone: 'bg-[#b59be8]', size: 'wide', subtitle: 'Community threads' },
  { label: 'Direct Messages', type: 'dms', icon: Send, tone: 'bg-[#7fadd9]', size: 'wide', subtitle: 'Private messages' },
  { label: 'Photo Gallery', type: 'sharedphotos', icon: Image, tone: 'bg-[#f0a36b]', size: 'medium' },
  { label: 'YouTube', type: 'youtube', icon: Youtube, tone: 'bg-[#e66d72]', size: 'medium' },
  { label: 'Cafe', type: 'cafe', icon: Coffee, tone: 'bg-[#e0a77c]', size: 'medium' },
  { label: 'Music', type: 'music', icon: Music, tone: 'bg-[#7fc6cf]', size: 'medium' },
  { label: 'Polls', type: 'polls', icon: Vote, tone: 'bg-[#91c995]', size: 'medium' },
  { label: 'Users', type: 'userlist', icon: Users, tone: 'bg-[#93c8af]', size: 'medium' },
  { label: 'My Page', type: 'mypage', icon: UserRound, tone: 'bg-[#d5a7dc]', size: 'medium' },
  { label: 'Web Browser', type: 'browser', icon: Globe, tone: 'bg-[#9ab5e5]', size: 'medium' },
  { label: 'Settings', type: 'settings', icon: Settings, tone: 'bg-[#9ca9bb]', size: 'medium', subtitle: 'Theme & account' },
  { label: 'Chess', type: 'chess', icon: Crown, tone: 'bg-[#d7a3c3]', size: 'small' },
  { label: 'Blackjack', type: 'blackjack', icon: Spade, tone: 'bg-[#cd8585]', size: 'small' },
  { label: 'Flappy Bird', type: 'flappy', icon: Bird, tone: 'bg-[#80c4d7]', size: 'small' },
  { label: 'Geometry Dash', type: 'geometry', icon: Gamepad2, tone: 'bg-[#d8b760]', size: 'small' },
  { label: 'Poker', type: 'poker', icon: Hash, tone: 'bg-[#bc8fd2]', size: 'small' },
  { label: 'Drawings', type: 'drawing', icon: Pencil, tone: 'bg-[#e5a279]', size: 'small' },
  { label: 'Guestbook', type: 'guestbook', icon: BookOpen, tone: 'bg-[#b2c889]', size: 'small' },
  { label: 'Visitor Counter', type: 'visits', icon: BarChart3, tone: 'bg-[#dfc276]', size: 'small' },
  { label: 'Notes', type: 'text', icon: StickyNote, tone: 'bg-[#e4d58a]', size: 'small' },
  { label: 'Shortcut', type: 'link', icon: Link2, tone: 'bg-[#a8b6c8]', size: 'small' },
  { label: 'Ranks Admin', type: 'ranksadmin', icon: ShieldCheck, tone: 'bg-[#d18cc0]', size: 'medium', adminOnly: true },
  { label: 'Account Admin', type: 'accountadmin', icon: UserCog, tone: 'bg-[#c493d3]', size: 'medium', adminOnly: true },
  { label: 'Site Settings', type: 'sitesettings', icon: Settings, tone: 'bg-[#a78cdb]', size: 'medium', adminOnly: true },
  { label: 'Backup / Restore', type: 'sitebackup', icon: DatabaseBackup, tone: 'bg-[#c29c75]', size: 'medium', adminOnly: true },
  { label: 'Diagnostics', type: 'diagnostics', icon: Activity, tone: 'bg-[#8fb2ce]', size: 'medium', adminOnly: true },
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
  const user = useAuth((state) => state.user);
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
  const apps = useMemo(
    () => APPS.filter((app) => !app.adminOnly || user?.isAdmin),
    [user?.isAdmin],
  );
  const regularApps = apps.filter((app) => !app.adminOnly);
  const adminApps = apps.filter((app) => app.adminOnly);

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
          <div>{apps.length} apps</div>
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
          {regularApps.map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.type}
                type="button"
                className={`mobile-tile mobile-tile--${app.size} group flex flex-col rounded-sm px-2 py-2 text-white transition-transform active:translate-y-px`}
                onClick={() => launchApp(app)}
                data-testid={`button-launch-${app.type}`}
                aria-label={`Open ${app.label}`}
              >
                <span
                  className={`mobile-tile-icon flex items-center justify-center border-2 border-white/80 ${app.tone} text-[#14283d] shadow-[2px_2px_0_rgba(0,0,0,0.42)] transition-transform group-active:translate-y-px`}
                >
                  <Icon className="h-7 w-7" strokeWidth={1.8} />
                </span>
                <span className="mobile-tile-label max-w-full text-[11px] font-bold leading-[1.08] [text-shadow:1px_1px_0_#005050]">{app.label}</span>
                {app.subtitle && <span className="mobile-tile-subtitle">{app.subtitle}</span>}
              </button>
            );
          })}
        </section>
        {adminApps.length > 0 && (
          <>
            <div className="mobile-section-label mt-4 px-1">
              <span>Administrator tools</span>
              <span className="mobile-section-rule" aria-hidden="true" />
            </div>
            <section
              className="mobile-app-grid mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-4"
              aria-label="Administrator applications"
              data-testid="admin-app-grid"
            >
              {adminApps.map((app) => {
                const Icon = app.icon;
                return (
                  <button
                    key={app.type}
                    type="button"
                    className={`mobile-tile mobile-tile--${app.size} mobile-tile--admin group flex flex-col rounded-sm px-2 py-2 text-white transition-transform active:translate-y-px`}
                    onClick={() => launchApp(app)}
                    data-testid={`button-launch-${app.type}`}
                    aria-label={`Open ${app.label}`}
                  >
                    <span className={`mobile-tile-icon flex items-center justify-center border-2 border-white/80 ${app.tone} text-[#14283d] shadow-[2px_2px_0_rgba(0,0,0,0.42)] transition-transform group-active:translate-y-px`}>
                      <Icon className="h-7 w-7" strokeWidth={1.8} />
                    </span>
                    <span className="mobile-tile-label max-w-full text-[11px] font-bold leading-[1.08] [text-shadow:1px_1px_0_#005050]">{app.label}</span>
                  </button>
                );
              })}
            </section>
          </>
        )}
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