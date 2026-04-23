import { useEffect, useState } from 'react';
import { useDesktopStore } from '../store';
import { useLocation } from 'wouter';
import { useAuth } from '../lib/auth-store';
import { LoginDialog } from './LoginDialog';

export function Taskbar({ page }: { page: string }) {
  const { addWindow, isStringMode, setStringMode, resetState } = useDesktopStore();
  const [startOpen, setStartOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { user, refresh, logout } = useAuth();

  useEffect(() => { void refresh(); }, [refresh]);

  const handleAddPhoto = () => {
    const url = window.prompt('Paste a photo URL (leave empty to set later by double-clicking):', '');
    addWindow(page, {
      type: 'photo',
      title: 'New Photo',
      imageUrl: url ? url.trim() : '/src/assets/nature-1.png',
      width: 400, height: 450
    });
    setStartOpen(false);
  };

  const handleAddYouTube = () => {
    const url = window.prompt('Paste a YouTube URL or video ID:', '');
    addWindow(page, {
      type: 'youtube',
      title: 'YouTube',
      youtubeUrl: url ? url.trim() : '',
      width: 480, height: 320,
    });
    setStartOpen(false);
  };

  const handleAddText = () => {
    addWindow(page, { type: 'text', title: 'Notes', content: 'Write something here...', width: 300, height: 200 });
    setStartOpen(false);
  };

  const handleAddDrawing = () => {
    addWindow(page, { type: 'drawing', title: 'Visitor Drawings', width: 460, height: 420 });
    setStartOpen(false);
  };

  const handleAddChat = () => {
    addWindow(page, { type: 'chat', title: 'Chatbox', width: 360, height: 380 });
    setStartOpen(false);
  };

  const handleAddVisits = () => {
    addWindow(page, { type: 'visits', title: 'Visitor Counter', width: 260, height: 180 });
    setStartOpen(false);
  };

  const handleAddGuestbook = () => {
    addWindow(page, { type: 'guestbook', title: 'Guestbook', width: 320, height: 380 });
    setStartOpen(false);
  };

  const handleAddSharedPhotos = () => {
    addWindow(page, { type: 'sharedphotos', title: 'Photo Gallery', width: 460, height: 460 });
    setStartOpen(false);
  };

  const handleAddLink = () => {
    addWindow(page, {
      type: 'link', title: 'Shortcut',
      linkLabel: 'Go to About', linkTarget: '/about',
      width: 200, height: 150
    });
    setStartOpen(false);
  };

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
          <div className="absolute bottom-full left-0 mb-1 w-64 bg-[#c0c0c0] win98-window flex flex-col p-1 gap-1">
            <div className="flex">
              <div className="w-8 bg-gradient-to-b from-[#000080] to-[#1084d0] flex flex-col justify-end p-1">
                <span className="text-white font-bold -rotate-90 transform origin-bottom-left whitespace-nowrap mb-8 text-xl">
                  Portfolio 98
                </span>
              </div>
              <div className="flex-1 flex flex-col p-1 gap-1">
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddSharedPhotos}>
                  Open Photo Gallery
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddPhoto}>
                  Add Photo Window (URL)
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddYouTube}>
                  Add YouTube Window
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddText}>
                  Add Text Note
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddLink}>
                  Add Link Shortcut
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddDrawing}>
                  Add Drawing Pad
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddChat}>
                  Add Chatbox
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddGuestbook}>
                  Add Guestbook
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={handleAddVisits}>
                  Add Visitor Counter
                </button>
                <div className="h-[2px] w-full border-t border-t-[#808080] border-b border-b-white my-1" />
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={() => { setLocation('/'); setStartOpen(false); }}>
                  Go to Home
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={() => { setLocation('/street'); setStartOpen(false); }}>
                  Go to Street
                </button>
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={() => { setLocation('/about'); setStartOpen(false); }}>
                  Go to About
                </button>
                <div className="h-[2px] w-full border-t border-t-[#808080] border-b border-b-white my-1" />
                <button className="text-left px-4 py-2 hover:bg-[#000080] hover:text-white" onClick={() => { resetState(); setStartOpen(false); }}>
                  Reset All Desktops
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="h-[80%] w-[2px] border-l border-l-[#808080] border-r border-r-white mx-2" />

      <button
        className={`win98-button h-8 px-4 flex items-center gap-2 ${isStringMode ? 'border-t-black border-l-black border-r-white border-b-white shadow-[inset_1px_1px_#808080] bg-gray-300' : ''}`}
        onClick={() => setStringMode(!isStringMode)}
      >
        <div className="w-3 h-3 bg-red-600 rounded-full" />
        {isStringMode ? 'Cancel String' : 'Draw String'}
      </button>

      <div className="flex-1" />

      {user ? (
        <div className="flex items-center gap-1 mr-2">
          <span className={`text-xs px-2 ${user.isAdmin ? 'text-red-700 font-bold' : ''}`}>
            {user.isAdmin ? 'admin: ' : ''}{user.username}
          </span>
          <button className="win98-button h-8 px-3" onClick={() => void logout()}>Log Out</button>
        </div>
      ) : (
        <button className="win98-button h-8 px-3 mr-2" onClick={() => setLoginOpen(true)}>
          Log In
        </button>
      )}

      <div className="win98-inset h-8 px-3 flex items-center text-xs">
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>

      {loginOpen && <LoginDialog onClose={() => setLoginOpen(false)} />}
    </div>
  );
}
