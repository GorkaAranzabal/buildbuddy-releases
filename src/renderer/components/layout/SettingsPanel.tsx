import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import type { UEProjectAnalysis } from '../../../shared/types';
import { MCPSetupChecklist } from '../unreal/MCPSetupChecklist';

interface SettingsPanelProps {
  onClose: () => void;
  onBack: () => void;
  onLogout: () => void;
}

export function SettingsPanel({ onClose, onBack, onLogout }: SettingsPanelProps) {
  const { settings, setSettings, authState, unrealMCPStatus, unrealMCPProjectInfo, setUnrealMCPStatus, setUnrealMCPProjectInfo } = useAppStore();
  const [appVersion, setAppVersion] = useState('');

  // UE project state
  const [projectPath, setProjectPath] = useState('');
  const [projectAnalysis, setProjectAnalysis] = useState<UEProjectAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Unreal MCP state
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [unrealEnginePath, setUnrealEnginePath] = useState('');
  const [isMCPStarting, setIsMCPStarting] = useState(false);
  const [isMCPTesting, setIsMCPTesting] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [isDetectingEngine, setIsDetectingEngine] = useState(false);

  useEffect(() => {
    if (settings) {
      setMcpEnabled(settings.unrealMCPEnabled ?? false);
      setUnrealEnginePath(settings.unrealEnginePath ?? '');
    }
  }, [settings]);

  useEffect(() => {
    window.electronAPI.app.getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    // Load cached project analysis on mount
    window.electronAPI.project.getAnalysis().then((analysis: UEProjectAnalysis | null) => {
      if (analysis) setProjectAnalysis(analysis);
    });
    if (settings?.ueProjectPath) setProjectPath(settings.ueProjectPath);
    // Initialize MCP status
    window.electronAPI.unrealMcp.getStatus().then(setUnrealMCPStatus);
  }, []);

  const handleBrowseProject = async () => {
    const chosenPath = await window.electronAPI.project.browse();
    if (!chosenPath) return;
    setIsAnalyzing(true);
    try {
      const analysis = await window.electronAPI.project.analyze(chosenPath);
      setProjectAnalysis(analysis);
      setProjectPath(chosenPath);
      await window.electronAPI.settings.update({ ueProjectPath: chosenPath });
      const updatedSettings = await window.electronAPI.settings.get();
      setSettings(updatedSettings);
    } catch (err: any) {
      alert(err?.message || 'Failed to analyze project');
    }
    setIsAnalyzing(false);
  };

  const handleReanalyze = async () => {
    if (!projectPath) return;
    setIsAnalyzing(true);
    try {
      const analysis = await window.electronAPI.project.analyze(projectPath);
      setProjectAnalysis(analysis);
    } catch (err: any) {
      alert(err?.message || 'Failed to re-analyze project');
    }
    setIsAnalyzing(false);
  };

  const handleClearProject = async () => {
    setProjectPath('');
    setProjectAnalysis(null);
    await window.electronAPI.settings.update({ ueProjectPath: '' });
    const updatedSettings = await window.electronAPI.settings.get();
    setSettings(updatedSettings);
  };

  const handleMCPToggle = async (enabled: boolean) => {
    setMcpEnabled(enabled);
    await window.electronAPI.settings.update({ unrealMCPEnabled: enabled });
    const updatedSettings = await window.electronAPI.settings.get();
    setSettings(updatedSettings);
  };

  const handleStartMCP = async () => {
    setIsMCPStarting(true);
    setMcpError(null);
    try {
      // Save current paths first
      await window.electronAPI.settings.update({ unrealEnginePath, ueProjectPath: projectPath });
      const result = await window.electronAPI.unrealMcp.start();
      if (!result.success) {
        setMcpError(result.error || 'Failed to start MCP server');
      }
    } catch (err: any) {
      setMcpError(err?.message || 'Failed to start MCP server');
    }
    setIsMCPStarting(false);
  };

  const handleStopMCP = async () => {
    await window.electronAPI.unrealMcp.stop();
  };

  const handleTestMCPConnection = async () => {
    setIsMCPTesting(true);
    setMcpError(null);
    try {
      const info = await window.electronAPI.unrealMcp.testConnection();
      if (info) {
        setUnrealMCPProjectInfo(info);
      } else {
        setMcpError('Test failed — is Unreal Editor running with Remote Execution enabled?');
      }
    } catch (err: any) {
      setMcpError(err?.message || 'Test failed');
    }
    setIsMCPTesting(false);
  };

  const handleBrowseEnginePath = async () => {
    const chosen = await window.electronAPI.ue.browseEnginePath();
    if (!chosen) return;
    setUnrealEnginePath(chosen);
    await window.electronAPI.settings.update({ unrealEnginePath: chosen });
    const updatedSettings = await window.electronAPI.settings.get();
    setSettings(updatedSettings);
  };

  const handleDetectEnginePath = async () => {
    setIsDetectingEngine(true);
    try {
      const detected = await window.electronAPI.ue.detectEnginePath();
      if (detected) {
        setUnrealEnginePath(detected);
        await window.electronAPI.settings.update({ unrealEnginePath: detected });
        const updatedSettings = await window.electronAPI.settings.get();
        setSettings(updatedSettings);
      } else {
        setMcpError('No Unreal Engine installation found. Try browsing manually.');
      }
    } catch (err: any) {
      setMcpError(err?.message || 'Detection failed');
    }
    setIsDetectingEngine(false);
  };

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

        {/* UE Project */}
        <div className="space-y-2 pt-2 border-t border-white/[0.08]">
          <label className="text-white/70 text-sm">Unreal Engine Project</label>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-xs text-white/50 truncate">
              {projectPath || 'No project selected'}
            </p>
            <button
              onClick={handleBrowseProject}
              disabled={isAnalyzing}
              className="px-2.5 py-1 bg-white/[0.08] hover:bg-white/[0.12] disabled:opacity-50 rounded-lg text-white/80 text-xs font-medium transition-all whitespace-nowrap"
            >
              {isAnalyzing ? 'Analyzing…' : 'Browse'}
            </button>
            {projectPath && (
              <button
                onClick={handleClearProject}
                className="text-white/30 hover:text-red-400 transition-colors"
                title="Clear project"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {projectAnalysis && (
            <div className="flex items-center justify-between px-3 py-2 bg-white/[0.04] rounded-lg">
              <p className="text-xs text-white/60">
                <span className="text-green-400">✓</span>{' '}
                UE {projectAnalysis.engineVersion} · {projectAnalysis.contentStats.totalAssets} assets · {projectAnalysis.contentStats.totalMaps} maps
              </p>
              <button
                onClick={handleReanalyze}
                disabled={isAnalyzing}
                className="text-xs text-white/40 hover:text-white/70 disabled:opacity-50 transition-colors ml-2 whitespace-nowrap"
              >
                Re-analyze
              </button>
            </div>
          )}
        </div>

        {/* Unreal Engine Remote Control */}
        <div className="space-y-3 pt-2 border-t border-white/[0.08]">
          {/* Section header */}
          <div>
            <label className="text-white/70 text-sm">Unreal Engine Remote Control</label>
            <p className="text-white/35 text-xs mt-0.5">Control your Unreal Editor directly from Build Buddy</p>
          </div>

          {/* Step 1: Unreal Engine folder — required before enabling */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-white/50 text-xs">
                <span className="text-white/25 mr-1">Step 1 ·</span>Unreal Engine Folder
              </label>
              <button
                onClick={handleDetectEnginePath}
                disabled={isDetectingEngine}
                className="text-[11px] text-blue-400/70 hover:text-blue-400 disabled:opacity-40 transition-colors"
              >
                {isDetectingEngine ? 'Detecting…' : 'Auto-detect'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={unrealEnginePath}
                onChange={(e) => setUnrealEnginePath(e.target.value)}
                placeholder="/Users/Shared/Epic Games/UE_5.4"
                className="flex-1 px-3 py-2 bg-white/[0.06] border border-white/[0.1] rounded-lg text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-white/20 transition-all"
                onBlur={() => window.electronAPI.settings.update({ unrealEnginePath })}
              />
              <button
                onClick={handleBrowseEnginePath}
                className="px-2.5 py-2 bg-white/[0.08] hover:bg-white/[0.12] rounded-lg text-white/80 text-xs font-medium transition-all whitespace-nowrap"
              >
                Browse
              </button>
            </div>
            {!unrealEnginePath && (
              <p className="text-white/25 text-[11px]">Enter your Unreal Engine installation folder to continue</p>
            )}
          </div>

          {/* Step 2: Enable toggle — locked until path is set */}
          <div className="flex items-center justify-between">
            <div>
              <label className={`text-sm transition-colors ${unrealEnginePath ? 'text-white/70' : 'text-white/30'}`}>
                <span className="text-white/25 mr-1 text-xs">Step 2 ·</span>Enable Remote Control
              </label>
              {!unrealEnginePath && (
                <p className="text-white/25 text-[11px] mt-0.5">Set your Unreal Engine folder first</p>
              )}
            </div>
            <button
              onClick={() => unrealEnginePath && handleMCPToggle(!mcpEnabled)}
              disabled={!unrealEnginePath}
              className="relative flex-shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                width: '40px',
                height: '22px',
                borderRadius: '11px',
                background: mcpEnabled && unrealEnginePath ? '#3b82f6' : 'rgba(255,255,255,0.12)',
              }}
            >
              <span
                className="absolute top-0.5 bg-white rounded-full shadow transition-transform"
                style={{
                  width: '18px',
                  height: '18px',
                  left: '2px',
                  transform: mcpEnabled && unrealEnginePath ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>

          {mcpEnabled && unrealEnginePath && (
            <>
              {/* Status badge + controls */}
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                  style={{
                    background: unrealMCPStatus === 'connected' ? 'rgba(34,197,94,0.15)'
                      : unrealMCPStatus === 'starting' ? 'rgba(245,158,11,0.15)'
                      : unrealMCPStatus === 'error' ? 'rgba(239,68,68,0.15)'
                      : 'rgba(255,255,255,0.08)',
                    color: unrealMCPStatus === 'connected' ? '#4ade80'
                      : unrealMCPStatus === 'starting' ? '#fbbf24'
                      : unrealMCPStatus === 'error' ? '#f87171'
                      : 'rgba(255,255,255,0.4)',
                  }}
                >
                  {unrealMCPStatus === 'connected' ? 'Connected'
                    : unrealMCPStatus === 'starting' ? 'Starting...'
                    : unrealMCPStatus === 'error' ? 'Error'
                    : 'Disconnected'}
                </span>

                <div className="flex-1 flex gap-2 justify-end">
                  {unrealMCPStatus !== 'connected' ? (
                    <button
                      onClick={handleStartMCP}
                      disabled={isMCPStarting || unrealMCPStatus === 'starting'}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                      style={{
                        background: 'rgba(59,130,246,0.15)',
                        border: '1px solid rgba(59,130,246,0.2)',
                        color: '#60a5fa',
                      }}
                    >
                      {isMCPStarting ? 'Starting...' : 'Start Server'}
                    </button>
                  ) : (
                    <button
                      onClick={handleStopMCP}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 transition-all"
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      Stop Server
                    </button>
                  )}

                  {unrealMCPStatus === 'connected' && (
                    <button
                      onClick={handleTestMCPConnection}
                      disabled={isMCPTesting}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/60 transition-all disabled:opacity-50"
                      style={{ background: 'rgba(255,255,255,0.06)' }}
                    >
                      {isMCPTesting ? 'Testing...' : 'Test'}
                    </button>
                  )}
                </div>
              </div>

              {/* Inline error display */}
              {mcpError && (
                <div
                  className="px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}
                >
                  {mcpError.split('\n').map((line, i) => (
                    <p key={i} className="text-xs leading-relaxed" style={{ color: '#f87171' }}>{line}</p>
                  ))}
                </div>
              )}

              {/* Setup checklist — shown when disconnected or error */}
              {(unrealMCPStatus === 'disconnected' || unrealMCPStatus === 'error') && (
                <MCPSetupChecklist />
              )}

              {/* Project info — shown when connected and tested */}
              {unrealMCPStatus === 'connected' && unrealMCPProjectInfo && (
                <div
                  className="px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.12)' }}
                >
                  <p className="text-xs text-white/60">
                    <span style={{ color: '#4ade80' }}>Connected: </span>
                    {unrealMCPProjectInfo.projectName}
                    {' · '}UE {unrealMCPProjectInfo.engineVersion}
                    {unrealMCPProjectInfo.platform && ` · ${unrealMCPProjectInfo.platform}`}
                  </p>
                </div>
              )}

              {/* Reminder: update folder when switching projects */}
              <div
                className="px-3 py-2 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <p className="text-[11px] text-white/30 leading-relaxed">
                  Switching to a different Unreal Engine project? Update the folder above and follow the setup guide again.
                </p>
              </div>
            </>
          )}
        </div>

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
