import React, { useRef, useState, useCallback } from 'react';
import { useDesktopStore, WindowData } from '../store';
import { useLocation } from 'wouter';
import { X, Square, Minus } from 'lucide-react';
import { DrawingPad } from './DrawingPad';
import { ChatBox } from './ChatBox';
import { VisitCounter } from './VisitCounter';
import { Guestbook } from './Guestbook';
import { SharedPhotos } from './SharedPhotos';
import { LoginDialog } from './LoginDialog';
import { Forum } from './Forum';
import { Blackjack } from './Blackjack';
import { Flappy } from './Flappy';
import { SyncedYouTube } from './SyncedYouTube';
import { MusicPlayer } from './MusicPlayer';
import { Polls } from './Polls';
import { Chess } from './Chess';
import { Cafe } from './Cafe';
import { DMs } from './DMs';
import { UserPage } from './UserPage';
import { RanksAdmin } from './RanksAdmin';
import { SiteSettingsDialog } from './SiteSettingsDialog';
import { IpLookup } from './IpLookup';
import { News } from './News';
import { UserList } from './UserList';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { useAuth } from '../lib/auth-store';

function getYouTubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  try {
    const trimmed = url.trim();
    if (/youtube\.com\/embed\//.test(trimmed)) return trimmed;
    let m = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = trimmed.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = trimmed.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    if (/^[A-Za-z0-9_-]{6,}$/.test(trimmed)) return `https://www.youtube.com/embed/${trimmed}`;
    return null;
  } catch { return null; }
}

export function Window({
  window: w,
  page,
  boundsRef,
}: {
  window: WindowData;
  page: string;
  boundsRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { updateWindow, removeWindow, bringToFront, isStringMode, stringStartId, setStringStart, addString, toggleWindowState } = useDesktopStore();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPos = useRef<{ x: number; y: number } | null>(null);

  const handleWindowClick = () => {
    if (isStringMode) {
      if (!stringStartId) setStringStart(w.id);
      else addString(page, stringStartId, w.id);
    }
  };

  const flushPos = useCallback(() => {
    rafRef.current = null;
    if (pendingPos.current) {
      updateWindow(page, w.id, pendingPos.current);
      pendingPos.current = null;
    }
  }, [updateWindow, page, w.id]);

  const winState = w.state || 'normal';
  const isMin = winState === 'min';
  const isMax = winState === 'max';

  const handleTitleBarPointerDown = (e: React.PointerEvent) => {
    if (isStringMode || isEditing || isMax) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    bringToFront(page, w.id);
    const startPointerX = e.clientX;
    const startPointerY = e.clientY;
    const startX = w.x;
    const startY = w.y;
    const bounds = boundsRef.current?.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (moveEvent: PointerEvent) => {
      let nx = startX + (moveEvent.clientX - startPointerX);
      let ny = startY + (moveEvent.clientY - startPointerY);
      if (bounds) {
        nx = Math.max(0, Math.min(nx, bounds.width - w.width));
        ny = Math.max(0, Math.min(ny, bounds.height - w.height));
      } else { nx = Math.max(0, nx); ny = Math.max(0, ny); }
      if (elRef.current) elRef.current.style.transform = `translate3d(${nx}px, ${ny}px, 0)`;
      pendingPos.current = { x: nx, y: ny };
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushPos);
    };
    const onUp = (upEvent: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try { target.releasePointerCapture(upEvent.pointerId); } catch {}
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (pendingPos.current) { updateWindow(page, w.id, pendingPos.current); pendingPos.current = null; }
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const handleResize = (e: React.PointerEvent) => {
    if (isMax || isMin) return;
    e.preventDefault(); e.stopPropagation(); bringToFront(page, w.id);
    const startX = e.clientX; const startY = e.clientY;
    const startW = w.width; const startH = w.height;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let pendingSize: { width: number; height: number } | null = null;
    let raf: number | null = null;
    const flush = () => {
      raf = null;
      if (pendingSize && elRef.current) {
        elRef.current.style.width = `${pendingSize.width}px`;
        elRef.current.style.height = `${pendingSize.height}px`;
      }
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      const newW = Math.max(200, startW + (moveEvent.clientX - startX));
      const newH = Math.max(150, startH + (moveEvent.clientY - startY));
      pendingSize = { width: newW, height: newH };
      if (raf === null) raf = requestAnimationFrame(flush);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerUp);
      try { target.releasePointerCapture(upEvent.pointerId); } catch {}
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
      if (pendingSize) { updateWindow(page, w.id, pendingSize); pendingSize = null; }
    };
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
  };

  const isActive = useDesktopStore(state => state.maxZIndex === w.zIndex);

  if (isMin) {
    return (
      <div
        className="absolute win98-window flex items-center cursor-pointer"
        style={{ top: 0, left: 0, transform: `translate3d(${w.x}px, ${(boundsRef.current?.clientHeight || 600) - 64}px, 0)`, width: 160, zIndex: w.zIndex }}
        onClick={() => { toggleWindowState(page, w.id, 'min'); bringToFront(page, w.id); }}
      >
        <div className="win98-titlebar shrink-0 w-full px-1 truncate text-xs">{w.title}</div>
      </div>
    );
  }

  const bounds = boundsRef.current;
  const maxStyle = isMax && bounds ? {
    width: bounds.clientWidth, height: bounds.clientHeight - 40, transform: 'translate3d(0,0,0)',
  } : { width: w.width, height: w.height, transform: `translate3d(${w.x}px, ${w.y}px, 0)` };

  return (
    <div
      ref={elRef}
      onPointerDown={() => bringToFront(page, w.id)}
      onClick={handleWindowClick}
      className={`absolute win98-window flex flex-col ${isStringMode ? 'cursor-crosshair' : ''} ${isStringMode && stringStartId === w.id ? 'ring-4 ring-red-500' : ''}`}
      style={{ ...maxStyle, zIndex: w.zIndex, top: 0, left: 0, willChange: 'transform', touchAction: 'none' } as React.CSSProperties}
    >
      <div
        className={`win98-titlebar ${isActive ? '' : 'inactive'} shrink-0 cursor-move select-none`}
        onPointerDown={handleTitleBarPointerDown}
        style={{ touchAction: 'none' }}
        onDoubleClick={() => toggleWindowState(page, w.id, 'max')}
      >
        <div className="flex items-center gap-2 overflow-hidden px-1">
          <div className="w-4 h-4 bg-white/20" />
          <span className="truncate text-sm tracking-wide">{w.title}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0 px-1">
          <button className="win98-button w-5 h-5 flex items-center justify-center pointer-events-auto" onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleWindowState(page, w.id, 'min'); }}>
            <Minus className="w-3 h-3" strokeWidth={3} />
          </button>
          <button className="win98-button w-5 h-5 flex items-center justify-center pointer-events-auto" onPointerDown={e => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleWindowState(page, w.id, 'max'); }}>
            <Square className="w-3 h-3" strokeWidth={3} />
          </button>
          <button className="win98-button w-5 h-5 flex items-center justify-center pointer-events-auto"
            onPointerDown={e => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); removeWindow(page, w.id); }}>
            <X className="w-3 h-3" strokeWidth={3} />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-auto win98-inset bg-white p-2 text-black pointer-events-auto flex flex-col relative group"
        onDoubleClick={() => setIsEditing(true)}
      >
        {isEditing && (
          <div className="absolute inset-0 bg-[#c0c0c0] z-50 p-2 flex flex-col gap-2 overflow-auto text-sm">
            <div className="font-bold mb-2">Edit Window</div>
            <label className="flex flex-col">Title
              <input type="text" className="win98-inset px-1" value={w.title} onChange={e => updateWindow(page, w.id, { title: e.target.value })} />
            </label>
            {w.type === 'photo' && (
              <>
                <label className="flex flex-col">Image URL
                  <input type="text" className="win98-inset px-1" value={w.imageUrl || ''} onChange={e => updateWindow(page, w.id, { imageUrl: e.target.value })} />
                </label>
                <label className="flex flex-col">Caption
                  <input type="text" className="win98-inset px-1" value={w.content || ''} onChange={e => updateWindow(page, w.id, { content: e.target.value })} />
                </label>
              </>
            )}
            {w.type === 'link' && (
              <>
                <label className="flex flex-col">Link Label
                  <input type="text" className="win98-inset px-1" value={w.linkLabel || ''} onChange={e => updateWindow(page, w.id, { linkLabel: e.target.value })} />
                </label>
                <label className="flex flex-col">Link Target (e.g. /about)
                  <input type="text" className="win98-inset px-1" value={w.linkTarget || ''} onChange={e => updateWindow(page, w.id, { linkTarget: e.target.value })} />
                </label>
              </>
            )}
            {w.type === 'text' && (
              <label className="flex flex-col flex-1">Content
                <textarea className="win98-inset px-1 flex-1 resize-none" value={w.content || ''} onChange={e => updateWindow(page, w.id, { content: e.target.value })} />
              </label>
            )}
            {w.type === 'youtube' && (
              <label className="flex flex-col">YouTube URL or video ID
                <input type="text" className="win98-inset px-1" value={w.youtubeUrl || ''} onChange={e => updateWindow(page, w.id, { youtubeUrl: e.target.value })} />
              </label>
            )}
            <button className="win98-button mt-auto" onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}>Done</button>
          </div>
        )}

        {w.type === 'text' && !isEditing && (
          <div className="w-full h-full font-mono text-sm whitespace-pre-wrap break-words overflow-auto">
            {w.content || ''}
          </div>
        )}

        {w.type === 'photo' && !isEditing && (
          <div className="w-full h-full flex flex-col">
            <div className="flex-1 bg-black overflow-hidden flex items-center justify-center pointer-events-none">
              {w.imageUrl ? <img src={w.imageUrl} alt={w.title} className="max-w-full max-h-full object-contain" draggable={false} /> :
                <div className="text-white/50 text-sm">No Image</div>}
            </div>
            {w.content && <div className="mt-2 text-sm italic shrink-0 text-center font-serif pointer-events-none">{w.content}</div>}
          </div>
        )}

        {w.type === 'gallery' && !isEditing && (
          <div className="grid grid-cols-3 gap-2 overflow-auto auto-rows-max h-full">
            {(w.images || []).map((img, i) => (
              <div key={i} className="aspect-square bg-gray-200 border border-gray-400 cursor-pointer hover:border-blue-500 overflow-hidden"
                onClick={() => {
                  const store = useDesktopStore.getState();
                  store.addWindow(page, { type: 'photo', title: `Photo ${i + 1}`, imageUrl: img, x: w.x + 50 + (i * 20), y: w.y + 50 + (i * 20), width: 400, height: 450 });
                }}>
                <img src={img} alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
            ))}
          </div>
        )}

        {w.type === 'youtube' && !isEditing && <SyncedYouTube />}
        {w.type === 'link' && !isEditing && (
          <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <button className="win98-button text-lg px-8 py-4 bg-gray-300 w-full"
              onClick={() => { if (w.linkTarget) setLocation(w.linkTarget); }}>
              {w.linkLabel || 'Open Link'}
            </button>
            <div className="mt-4 text-xs text-gray-500 truncate pointer-events-none">Target: {w.linkTarget}</div>
          </div>
        )}

        {w.type === 'drawing' && !isEditing && <DrawingPad onRequestLogin={() => setShowLogin(true)} />}
        {w.type === 'chat' && !isEditing && <ChatBox onRequestLogin={() => setShowLogin(true)} />}
        {w.type === 'visits' && !isEditing && <VisitCounter />}
        {w.type === 'guestbook' && !isEditing && <Guestbook />}
        {w.type === 'sharedphotos' && !isEditing && <SharedPhotos />}
        {w.type === 'forum' && !isEditing && <Forum onRequestLogin={() => setShowLogin(true)} />}
        {w.type === 'blackjack' && !isEditing && <Blackjack onRequestLogin={() => setShowLogin(true)} />}
        {w.type === 'flappy' && !isEditing && <Flappy onRequestLogin={() => setShowLogin(true)} />}
        {w.type === 'music' && !isEditing && <MusicPlayer />}
        {w.type === 'polls' && !isEditing && <Polls />}
        {w.type === 'chess' && !isEditing && <Chess />}
        {w.type === 'cafe' && !isEditing && <Cafe />}
        {w.type === 'dms' && !isEditing && <DMs initialPeer={w.dmPeer} />}
        {w.type === 'userpage' && !isEditing && <UserPage username={w.username || ''} />}
        {w.type === 'mypage' && !isEditing && <MyPageRouter />}
        {w.type === 'ranksadmin' && !isEditing && <RanksAdmin />}
        {w.type === 'sitesettings' && !isEditing && <SiteSettingsDialog />}
        {w.type === 'iplookup' && !isEditing && <IpLookup username={w.username || ''} />}
        {w.type === 'news' && !isEditing && <News />}
        {w.type === 'userlist' && !isEditing && <UserList page={page} />}
        {w.type === 'diagnostics' && !isEditing && <DiagnosticsPanel />}
        {showLogin && <LoginDialog onClose={() => setShowLogin(false)} />}

        {!isMax && (
          <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end p-0.5 opacity-50 group-hover:opacity-100"
            onPointerDown={handleResize} style={{ touchAction: 'none' }}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M 10 0 L 10 10 L 0 10 Z" fill="transparent" />
              <path d="M 8 2 L 10 0 M 6 4 L 10 0 M 4 6 L 10 0 M 2 8 L 10 0 M 0 10 L 10 0" stroke="black" strokeWidth="1" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function MyPageRouter() {
  const u = useAuth(s => s.user);
  if (!u) return <div className="p-2 text-xs">Log in to customize your page.</div>;
  return <UserPage username={u.username} />;
}
