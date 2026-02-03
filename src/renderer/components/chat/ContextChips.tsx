import React from 'react';
import { useAppStore, selectIsConnected, selectProjectName, selectEngineVersion } from '../../store';

export function ContextChips() {
  const isConnected = useAppStore(selectIsConnected);
  const projectName = useAppStore(selectProjectName);
  const engineVersion = useAppStore(selectEngineVersion);
  const lastContextUpdate = useAppStore((state) => state.lastContextUpdate);

  const getTimeSinceUpdate = (): string => {
    if (!lastContextUpdate) return 'No data';
    const seconds = Math.floor((Date.now() - lastContextUpdate) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return 'Over 1h ago';
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.1]">
      {/* Engine chip */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs">
        <svg className="w-3.5 h-3.5 text-white/60" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
        <span className="text-white/90 font-medium">Unreal</span>
      </div>

      {/* Connection status */}
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs border font-medium ${
          isConnected 
            ? 'bg-green-500/10 text-green-300 border-green-400/20' 
            : 'bg-orange-500/10 text-orange-300 border-orange-400/20'
        }`}
      >
        <div
          className={`w-1.5 h-1.5 rounded-full ${
            isConnected ? 'bg-green-400 status-pulse' : 'bg-orange-400'
          }`}
        />
        <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
      </div>

      {/* Project info (if connected) */}
      {isConnected && projectName && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs text-white/80">
          <svg className="w-3.5 h-3.5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          <span className="max-w-[100px] truncate">{projectName}</span>
        </div>
      )}

      {/* Engine version (if connected) */}
      {isConnected && engineVersion && (
        <div className="px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs text-white/60">
          UE {engineVersion}
        </div>
      )}

      {/* Last update time */}
      {isConnected && (
        <div className="ml-auto text-xs text-white/40">Updated {getTimeSinceUpdate()}</div>
      )}
    </div>
  );
}
