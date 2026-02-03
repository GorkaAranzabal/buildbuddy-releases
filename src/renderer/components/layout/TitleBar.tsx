import React from 'react';
import { useAppStore } from '../../store';

export function TitleBar() {
  const { isPinned, setCollapsed, setPinned, activeView, setActiveView } = useAppStore();

  const handleCollapse = () => {
    setCollapsed(true);
    window.electronAPI.window.collapse(true);
  };

  const handleTogglePin = () => {
    const newPinned = !isPinned;
    setPinned(newPinned);
    window.electronAPI.window.pin(newPinned);
  };

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.1] drag-region">
      {/* Title and navigation */}
      <div className="flex items-center gap-3 no-drag">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <span className="text-sm font-medium text-white/90">Gorka Copilot</span>
        </div>

        {/* Navigation tabs */}
        <div className="flex items-center gap-1 ml-2">
          <NavButton
            active={activeView === 'chat'}
            onClick={() => setActiveView('chat')}
            title="Chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </NavButton>
          <NavButton
            active={activeView === 'history'}
            onClick={() => setActiveView('history')}
            title="History"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </NavButton>
          <NavButton
            active={activeView === 'settings'}
            onClick={() => setActiveView('settings')}
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </NavButton>
        </div>
      </div>

      {/* Window controls */}
      <div className="flex items-center gap-1 no-drag">
        {/* Pin button */}
        <button
          onClick={handleTogglePin}
          className={`p-2 rounded-xl hover:bg-white/[0.06] transition-all duration-200 ${
            isPinned ? 'text-white/90' : 'text-white/50'
          }`}
          title={isPinned ? 'Unpin (disable always on top)' : 'Pin (always on top)'}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isPinned ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            )}
          </svg>
        </button>

        {/* Collapse button */}
        <button
          onClick={handleCollapse}
          className="p-2 rounded-xl hover:bg-white/[0.06] transition-all duration-200 text-white/50 hover:text-white/80"
          title="Collapse"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}

function NavButton({ active, onClick, children, title }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-xl transition-all duration-200 ${
        active
          ? 'bg-white/[0.06] text-white/95 border border-white/[0.1]'
          : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'
      }`}
      title={title}
    >
      {children}
    </button>
  );
}
