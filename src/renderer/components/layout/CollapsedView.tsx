import React from 'react';
import { useAppStore, selectIsConnected } from '../../store';

export function CollapsedView() {
  const setCollapsed = useAppStore((state) => state.setCollapsed);
  const isConnected = useAppStore(selectIsConnected);

  const handleExpand = () => {
    setCollapsed(false);
    window.electronAPI.window.collapse(false);
  };

  return (
    <div
      className="w-full h-full flex items-center justify-center cursor-pointer drag-region"
      onClick={handleExpand}
      title="Click to expand Gorka Copilot"
    >
      <div className="relative no-drag">
        {/* Main icon */}
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg hover:scale-105 transition-transform">
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>

        {/* Connection status indicator */}
        <div
          className={`absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-zinc-900 ${
            isConnected ? 'bg-overlay-success' : 'bg-overlay-error'
          }`}
          title={isConnected ? 'Connected to Unreal' : 'Disconnected'}
        />
      </div>
    </div>
  );
}
