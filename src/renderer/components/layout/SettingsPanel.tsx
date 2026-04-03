import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { EngineMCPCard } from '../engines/EngineMCPCard';

interface SettingsPanelProps {
  onClose: () => void;
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsPanel({ onClose, onBack, onLogout }: SettingsPanelProps) {
  const { settings, authState, selectedEngine } = useAppStore();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.electronAPI.app.getVersion().then(setAppVersion);
  }, []);

  return (
    <div
      className="mt-2 rounded-2xl border border-white/[0.12] overflow-hidden"
      style={{
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(80px) saturate(200%)',
        WebkitBackdropFilter: 'blur(80px) saturate(200%)',
        width: '480px',
        maxHeight: '500px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-white/70 hover:text-white/90 text-sm transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="text-white/90 font-medium">Settings</h2>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-white/[0.1] hover:bg-white/[0.15] flex items-center justify-center transition-all"
        >
          <svg className="w-3.5 h-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Settings content */}
      <div className="p-4 space-y-4 overflow-y-auto" style={{ maxHeight: '440px' }}>
        {/* Account */}
        <div className="space-y-2 pb-4 border-b border-white/[0.08]">
          <label className="text-white/70 text-sm">Account</label>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/90 text-sm">{authState?.email}</p>
              <p className="text-xs">
                {authState?.entitlement?.active ? (
                  <span className="text-green-400">Pro Plan</span>
                ) : (
                  <span className="text-white/40">Free Plan</span>
                )}
              </p>
            </div>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg text-xs font-medium transition-all"
            >
              Sign Out
            </button>
          </div>
          {!authState?.entitlement?.active && (
            <button
              onClick={() => window.open('https://build-buddy.app/pricing', '_blank')}
              className="w-full px-3 py-2 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded-lg text-amber-400 text-xs font-medium transition-all"
            >
              Upgrade to Pro
            </button>
          )}
        </div>

        {/* Engine MCP — only for non-Unreal engines (Unreal uses the chat bar connect flow) */}
        {selectedEngine && selectedEngine !== 'unreal' && (
          <div className="pt-2 border-t border-white/[0.08]">
            <EngineMCPCard engine={selectedEngine} />
          </div>
        )}

        {/* Version */}
        {appVersion && (
          <p className="text-center text-white/25 text-[11px] pt-1">v{appVersion}</p>
        )}

        {/* Quit */}
        <button
          onClick={() => window.electronAPI.app.quit()}
          className="w-full px-4 py-2 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg text-xs font-medium transition-all border border-transparent hover:border-red-500/20"
        >
          Quit BuildBuddy
        </button>
      </div>
    </div>
  );
}
