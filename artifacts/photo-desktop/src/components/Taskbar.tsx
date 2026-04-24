import { useEffect, useState } from 'react';
import { useDesktopStore } from '../store';
import { useLocation } from 'wouter';
import { useAuth, userColor } from '../lib/auth-store';
import { LoginDialog } from './LoginDialog';
import { ProfileDialog } from './ProfileDialog';

export function Taskbar({ page }: { page: string }) {
  const { addWindow, isStringMode, setStringMode, resetState, windows, toggleWindowState, bringToFront } = useDesktopStore();
  const [startOpen, setStartOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { user, ranks, refresh, refreshRanks, logout } = useAuth();
  const wins = windows[page] || [];

  useEffect(() => { void refresh(); void refreshRanks(); }, [refresh, refreshRanks]);

  const open = (data: any) => { addWindow(page, data); setStartOpen(false); };
  const items: { label: string; act: () => void }[] = [
    { label: "Open Photo Gallery", act: () => open({ type: 'sharedphotos', title: 'Photo Gallery', width: 460, height: 460 }) },
    { label: "Add Photo Window (URL)", act: () => { const url = window.prompt('Paste a photo URL:', '') || ''; open({ type: 'photo', title: 'New Photo', imageUrl: url.trim() || '/src/assets/nature-1.png', width: 400, height: 450 }); } },
    { label: "Add Synced YouTube", act: () => { const url = window.prompt('Paste a YouTube URL or ID:', '') || ''; open({ type: 'youtube', title: 'YouTube', youtubeUrl: url.trim(), width: 480, height: 320 }); } },
    { label: "Open Forum", act: () => open({ type: 'forum', title: 'Forum', width: 460, height: 420 }) },
    { label: "Open Music Player", act: () => open({ type: 'music', title: 'Music Player', width: 360, height: 380 }) },
    { label: "Open Polls", act: () => open({ type: 'polls', title: 'Polls', width: 380, height: 420 }) },
    { label: "Open Chess Lobbies", act: () => open({ type: 'chess', title: 'Chess', width: 600, height: 520 }) },
    { label: "Open Cafe", act: () => open({ type: 'cafe', title: 'Cafe', width: 720, height: 560 }) },
    { label: "Open DMs", act: () => open({ type: 'dms', title: 'Direct Messages', width: 460, height: 380 }) },
    { label: "Browse Users", act: () => open({ type: 'userlist', title: 'Users', width: 240, height: 400 }) },
    { label: "My Page", act: () => open({ type: 'mypage', title: user ? `${user.username}'s page` : 'My Page', width: 520, height: 440 }) },
    { label: "Play Blackjack", act: () => open({ type: 'blackjack', title: 'Blackjack', width: 520, height: 480 }) },
    { label: "Play Flappy Bird", act: () => open({ type: 'flappy', title: 'Flappy Bird', width: 560, height: 540 }) },
    { label: "Add Chatbox", act: () => open({ type: 'chat', title: 'Chatbox', width: 360, height: 420 }) },
    { label: "Add Drawing Pad", act: () => open({ type: 'drawing', title: 'Visitor Drawings', width: 460, height: 440 }) },
    { label: "Add Guestbook", act: () => open({ type: 'guestbook', title: 'Guestbook', width: 320, height: 380 }) },
    { label: "Add Visitor Counter", act: () => open({ type: 'visits', title: 'Visitor Counter', width: 260, height: 180 }) },
    { label: "Add Text Note", act: () => open({ type: 'text', title: 'Notes', content: 'Write something here...', width: 300, height: 200 }) },
    { label: "Add Link Shortcut", act: () => open({ type: 'link', title: 'Shortcut', linkLabel: 'Go to About', linkTarget: '/about', width: 200, height: 150 }) },
  ];
  if (user?.isAdmin) items.push({ label: "★ Manage Ranks", act: () => open({ type: 'ranksadmin', title: 'Ranks Admin', width: 480, height: 500 }) });

  const colorStyle = user ? { color: userColor(user, ranks) || undefined } : {};

  return (
    <div className="absolute bottom-0 left-0 right-0 h-10 bg-[#c0c0c0] border-t-2 border-t-white flex items-center px-1 z-[9999] shadow-[inset_0_1px_0_#dfdfdf]">
      <div className="relative">
        <button
          className={`win98-button h-8 px-2 mr-2 flex items-center gap-2 font-bold ${startOpen ? 'border-t-black border-l-black border-r-white border-b-white shadow-[inset_1px_1px_#808080]' : ''}`}
          onClick={() => setStartOpen(!startOpen)}
        >
          <div className="w-5 h-5 bg-gradient-to-br from-blue-600 to-green-500 shadow-inner" />
          Start
        </button>
        {startOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-72 bg-[#c0c0c0] win98-window flex p-1" style={{ maxHeight: 'calc(100dvh - 4rem)' }}>
            <div className="w-8 bg-gradient-to-b from-[#000080] to-[#1084d0] flex flex-col justify-end p-1 shrink-0">
              <span className="text-white font-bold -rotate-90 transform origin-bottom-left whitespace-nowrap mb-8 text-xl">Portfolio 98</span>
            </div>
            <div className="flex-1 flex flex-col p-1 gap-0.5 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 4.5rem)' }}>
              {items.map((it, i) => (
                <button key={i} className="text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-sm" onClick={it.act}>{it.label}</button>
              ))}
              <div className="h-[2px] w-full border-t border-t-[#808080] border-b border-b-white my-1" />
              <button className="text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-sm" onClick={() => { setLocation('/'); setStartOpen(false); }}>Go to Home</button>
              <button className="text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-sm" onClick={() => { setLocation('/street'); setStartOpen(false); }}>Go to Street</button>
              <button className="text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-sm" onClick={() => { setLocation('/about'); setStartOpen(false); }}>Go to About</button>
              <div className="h-[2px] w-full border-t border-t-[#808080] border-b border-b-white my-1" />
              <button className="text-left px-3 py-1 hover:bg-[#000080] hover:text-white text-sm" onClick={() => { resetState(); setStartOpen(false); }}>Reset All Desktops</button>
            </div>
          </div>
        )}
      </div>

      <div className="h-[80%] w-[2px] border-l border-l-[#808080] border-r border-r-white mx-1" />

      <button
        className={`win98-button h-8 px-2 flex items-center gap-1 ${isStringMode ? 'border-t-black border-l-black border-r-white border-b-white shadow-[inset_1px_1px_#808080] bg-gray-300' : ''}`}
        onClick={() => setStringMode(!isStringMode)}
      >
        <div className="w-3 h-3 bg-red-600 rounded-full" />
        {isStringMode ? 'Cancel' : 'String'}
      </button>

      <div className="flex items-center gap-1 ml-1 flex-1 overflow-x-auto">
        {wins.filter(w => (w.state || 'normal') === 'min').map(w => (
          <button key={w.id} className="win98-button h-7 px-2 max-w-[140px] truncate text-xs" onClick={() => { toggleWindowState(page, w.id, 'min'); bringToFront(page, w.id); }}>
            {w.title}
          </button>
        ))}
      </div>

      {user ? (
        <div className="flex items-center gap-1 mr-2">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-7 h-7 win98-inset object-cover cursor-pointer" onClick={() => setProfileOpen(true)} />
          ) : (
            <button className="win98-button h-8 px-2 text-xs" onClick={() => setProfileOpen(true)}>Profile</button>
          )}
          <span className="text-xs px-1 font-bold" style={colorStyle}>
            {user.isAdmin ? '★ ' : ''}{user.username}{user.rank && ` [${user.rank}]`}
          </span>
          <button className="win98-button h-8 px-2 text-xs" onClick={() => void logout()}>Log Out</button>
        </div>
      ) : (
        <button className="win98-button h-8 px-3 mr-2" onClick={() => setLoginOpen(true)}>Log In</button>
      )}

      <div className="win98-inset h-8 px-3 flex items-center text-xs">
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>

      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
