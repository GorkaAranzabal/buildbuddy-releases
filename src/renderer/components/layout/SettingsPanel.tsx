import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { EngineMCPCard } from '../engines/EngineMCPCard';

interface SettingsPanelProps {
  onClose: () => void;
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsPanel({ onClose, onBack, onLogout }: SettingsPanelProps) {
  const { authState, selectedEngine } = useAppStore();
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    window.electronAPI.app.getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    window.electronAPI?.window?.resizeSettings?.(480, 560);
  }, []);

  return (
    <div
      className="mt-2 rounded-2xl border border-white/[0.12] overflow-hidden transition-all duration-200 ease-out"
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

      {/* Content */}
      <div className="p-4 overflow-y-auto" style={{ maxHeight: '440px' }}>
        <GeneralTab
          authState={authState}
          selectedEngine={selectedEngine}
          appVersion={appVersion}
          onLogout={onLogout}
        />
      </div>
    </div>
  );
}

function GeneralTab({
  authState,
  selectedEngine,
  appVersion,
  onLogout,
}: {
  authState: ReturnType<typeof useAppStore.getState>['authState'];
  selectedEngine: ReturnType<typeof useAppStore.getState>['selectedEngine'];
  appVersion: string;
  onLogout: () => void;
}) {
  const [logsCopied, setLogsCopied] = useState(false);
  const handleCopyLogs = async () => {
    const result = await (window.electronAPI as any).debug?.copyLogs();
    if (result?.success) {
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
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
            onClick={() => {
              window.electronAPI?.analytics?.track('upgrade_clicked', { source: 'settings' });
              window.open('https://build-buddy.app/pricing', '_blank');
            }}
            className="w-full px-3 py-2 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded-lg text-amber-400 text-xs font-medium transition-all"
          >
            Upgrade to Pro
          </button>
        )}
      </div>

      {/* Discord */}
      <div className="pb-2 border-b border-white/[0.08]">
        <button
          onClick={() => window.open('https://bit.ly/3wtMBG5', '_blank')}
          className="w-full flex items-center gap-2.5 px-3 py-2 bg-indigo-500/10 hover:bg-indigo-500/15 border border-indigo-500/20 rounded-lg text-indigo-300 text-xs font-medium transition-all"
        >
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.031.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          Join our Discord for feedback
        </button>
      </div>

      {/* Engine MCP — only for non-Unreal engines (Unreal uses the chat bar connect flow) */}
      {selectedEngine && selectedEngine !== 'unreal' && (
        <div className="pt-2 border-t border-white/[0.08]">
          <EngineMCPCard engine={selectedEngine} />
        </div>
      )}

      {/* Debug logs (temporary) */}
      <div className="pt-2 border-t border-white/[0.08]">
        <button
          onClick={handleCopyLogs}
          className="w-full px-3 py-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.10] rounded-lg text-white/70 hover:text-white/90 text-xs font-medium transition-all"
        >
          {logsCopied ? 'Copied! Paste in chat to share' : 'Copy Debug Logs'}
        </button>
      </div>

      {/* Version */}
      {appVersion && <p className="text-center text-white/25 text-[11px] pt-1">v{appVersion}</p>}

      {/* Quit */}
      <button
        onClick={() => window.electronAPI.app.quit()}
        className="w-full px-4 py-2 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg text-xs font-medium transition-all border border-transparent hover:border-red-500/20"
      >
        Quit BuildBuddy
      </button>
    </div>
  );
}
