import React, { useState } from 'react';
import { useAppStore, selectIsPro } from '../../store';
import type { SelectedEngine } from '../../../../shared/types';
import { EngineIcon, ENGINE_NAMES } from '../common/EngineIcons';
import { UpgradePrompt } from '../auth/UpgradePrompt';

interface EngineMCPCardProps {
  engine: NonNullable<SelectedEngine>;
}

export function EngineMCPCard({ engine }: EngineMCPCardProps) {
  const { engineMCPStatus, setEngineMCPStatus, settings } = useAppStore();
  const isPro = useAppStore(selectIsPro);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleStart = async () => {
    if (!isPro && !settings?.devMode) {
      setShowUpgrade(true);
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      const result = await window.electronAPI.engineMcp.start();
      if (!result?.success) {
        setError(result?.error ?? 'Failed to start');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
    setIsStarting(false);
  };

  const handleStop = async () => {
    await window.electronAPI.engineMcp.stop();
    setEngineMCPStatus('disconnected');
  };

  const statusColor = engineMCPStatus === 'connected' ? '#4ade80'
    : engineMCPStatus === 'starting' ? '#fbbf24'
    : engineMCPStatus === 'error' ? '#f87171'
    : 'rgba(255,255,255,0.4)';

  const statusBg = engineMCPStatus === 'connected' ? 'rgba(34,197,94,0.15)'
    : engineMCPStatus === 'starting' ? 'rgba(245,158,11,0.15)'
    : engineMCPStatus === 'error' ? 'rgba(239,68,68,0.15)'
    : 'rgba(255,255,255,0.08)';

  const statusLabel = engineMCPStatus === 'connected' ? 'Connected'
    : engineMCPStatus === 'starting' ? 'Starting...'
    : engineMCPStatus === 'error' ? 'Error'
    : 'Disconnected';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <EngineIcon engine={engine} size={14} />
        <label className="text-white/70 text-sm">{ENGINE_NAMES[engine]} Remote Control</label>
      </div>

      <div
        className="rounded-xl p-3 space-y-3"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center justify-between">
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ background: statusBg, color: statusColor }}
          >
            {statusLabel}
          </span>

          <div className="flex gap-2">
            {engineMCPStatus !== 'connected' ? (
              <button
                onClick={handleStart}
                disabled={isStarting || engineMCPStatus === 'starting'}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
              >
                {isStarting || engineMCPStatus === 'starting' ? 'Starting...' : 'Connect'}
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)' }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {showUpgrade && (
          <UpgradePrompt
            title="Pro Feature"
            message="Engine Remote Control is available on the Pro plan. Upgrade to directly control UEFN, Unity, Godot, Blender, and more from the AI."
            onDismiss={() => setShowUpgrade(false)}
          />
        )}

        {!showUpgrade && error && (
          <p className="text-xs text-red-400/80 bg-red-500/10 rounded-lg px-2 py-1.5">{error}</p>
        )}

        {!showUpgrade && (engineMCPStatus === 'disconnected' || engineMCPStatus === 'error') ? (
          <p className="text-xs text-white/40">
            Make sure {ENGINE_NAMES[engine]} is open and the plugin is enabled before connecting.
          </p>
        ) : null}
      </div>
    </div>
  );
}
