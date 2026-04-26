import React, { useState, useEffect } from 'react';
import type { EngineSetupStatus, EngineSetupStep } from '../../../../shared/types';
import { EngineIcon, ENGINE_NAMES } from '../common/EngineIcons';

interface EngineOnboardingCardProps {
  setupStatus: EngineSetupStatus;
  onDone: () => void;
  onDismiss: () => void;
}

export function EngineOnboardingCard({ setupStatus, onDone, onDismiss }: EngineOnboardingCardProps) {
  const [isInstalling, setIsInstalling] = useState(false);
  const [installDone, setInstallDone] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [addonInstalling, setAddonInstalling] = useState(false);
  const [addonDone, setAddonDone] = useState(false);
  const [addonError, setAddonError] = useState<string | null>(null);
  const [unitySetupRunning, setUnitySetupRunning] = useState(false);
  const [unitySetupDone, setUnitySetupDone] = useState(false);
  const [unitySetupError, setUnitySetupError] = useState<string | null>(null);
  const [blenderInstalling, setBlenderInstalling] = useState(false);
  const [blenderDone, setBlenderDone] = useState(false);
  const [blenderError, setBlenderError] = useState<string | null>(null);
  const [blenderVersions, setBlenderVersions] = useState<string[]>([]);
  // Unreal engine path step
  const [unrealEnginePath, setUnrealEnginePath] = useState('');
  const [isDetectingEngine, setIsDetectingEngine] = useState(false);
  const [enginePathError, setEnginePathError] = useState<string | null>(null);
  // UEFN path steps
  const [uefnEnginePath, setUefnEnginePath] = useState('');
  const [uefnProjectPath, setUefnProjectPath] = useState('');
  const [uefnPathError, setUefnPathError] = useState<string | null>(null);
  const [isDetectingUefn, setIsDetectingUefn] = useState(false);
  const engine = setupStatus.engine;

  // Load saved engine paths on mount
  useEffect(() => {
    if (engine === 'unreal') {
      window.electronAPI.settings.get().then((s) => {
        if (s?.unrealEnginePath) setUnrealEnginePath(s.unrealEnginePath);
      });
    }
    if (engine === 'uefn') {
      window.electronAPI.settings.get().then((s) => {
        if (s?.uefnEnginePath) setUefnEnginePath(s.uefnEnginePath ?? '');
        if (s?.uefnProjectPath) setUefnProjectPath(s.uefnProjectPath ?? '');
      });
    }
  }, [engine]);

  // Track onboarding start once per mount
  useEffect(() => {
    if (engine) {
      window.electronAPI?.analytics?.track('engine_setup_started', { engineType: engine });
    }
  }, [engine]);

  // Auto-trigger install on mount if there are automatic steps
  useEffect(() => {
    const hasAutoStep = setupStatus.pendingSteps.some(s => s.isAutomatic);
    if (!hasAutoStep || !engine) return;

    setIsInstalling(true);
    window.electronAPI.engine.installDeps(engine)
      .then((result: { success: boolean; error?: string }) => {
        if (!result.success && result.error) {
          setInstallError(result.error);
          window.electronAPI?.analytics?.track('engine_setup_failed', {
            engineType: engine,
            stage: 'deps',
            errorClass: /timeout/i.test(result.error) ? 'timeout' : 'other',
          });
        } else {
          setInstallDone(true);
        }
      })
      .catch((err: Error) => {
        setInstallError(err.message);
        window.electronAPI?.analytics?.track('engine_setup_failed', {
          engineType: engine,
          stage: 'deps',
          errorClass: /timeout/i.test(err.message) ? 'timeout' : /network|fetch/i.test(err.message) ? 'network' : 'other',
        });
      })
      .finally(() => setIsInstalling(false));
  }, []);

  const handleBrowseEnginePath = async () => {
    const chosen = await window.electronAPI.ue.browseEnginePath();
    if (chosen) {
      setUnrealEnginePath(chosen);
      await window.electronAPI.settings.update({ unrealEnginePath: chosen });
    }
  };

  const handleDetectEnginePath = async () => {
    setIsDetectingEngine(true);
    setEnginePathError(null);
    try {
      const detected = await window.electronAPI.ue.detectEnginePath();
      if (detected) {
        setUnrealEnginePath(detected);
        await window.electronAPI.settings.update({ unrealEnginePath: detected });
      } else {
        setEnginePathError('No Unreal Engine installation found. Try browsing manually.');
      }
    } catch (err) {
      setEnginePathError(err instanceof Error ? err.message : 'Detection failed');
    }
    setIsDetectingEngine(false);
  };

  const handleDetectUefnPath = async () => {
    setIsDetectingUefn(true);
    setUefnPathError(null);
    try {
      const detected = await (window.electronAPI as any).ue.detectUefnPath();
      if (detected) {
        setUefnEnginePath(detected);
        await window.electronAPI.settings.update({ uefnEnginePath: detected });
      } else {
        setUefnPathError('UEFN not found. Try browsing manually.');
      }
    } catch (err) {
      setUefnPathError(err instanceof Error ? err.message : 'Detection failed');
    }
    setIsDetectingUefn(false);
  };

  const handleBrowseUefnEnginePath = async () => {
    const chosen = await window.electronAPI.ue.browseEnginePath();
    if (chosen) {
      setUefnEnginePath(chosen);
      await window.electronAPI.settings.update({ uefnEnginePath: chosen });
    }
  };

  const handleBrowseUefnProjectPath = async () => {
    const chosen = await window.electronAPI.ue.browseEnginePath();
    if (chosen) {
      setUefnProjectPath(chosen);
      await window.electronAPI.settings.update({ uefnProjectPath: chosen });
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    await onDone();
    setIsConnecting(false);
  };

  const handleInstallGodotAddon = async () => {
    setAddonInstalling(true);
    setAddonError(null);
    try {
      const result: { success: boolean; canceled?: boolean; error?: string; projectPath?: string } =
        await (window.electronAPI as any).godot.installAddon();
      if (result.canceled) {
        // user dismissed the folder picker — do nothing
      } else if (!result.success) {
        setAddonError(result.error ?? 'Failed to copy addon');
      } else {
        setAddonDone(true);
      }
    } catch (err) {
      setAddonError(err instanceof Error ? err.message : String(err));
    }
    setAddonInstalling(false);
  };

  const handleUnitySetup = async () => {
    setUnitySetupRunning(true);
    setUnitySetupError(null);
    try {
      const result: { success: boolean; canceled?: boolean; error?: string } =
        await (window.electronAPI as any).unity.setupServer();
      if (result.canceled) {
        // user dismissed folder picker — do nothing
      } else if (!result.success) {
        setUnitySetupError(result.error ?? 'Setup failed');
      } else {
        setUnitySetupDone(true);
      }
    } catch (err) {
      setUnitySetupError(err instanceof Error ? err.message : String(err));
    }
    setUnitySetupRunning(false);
  };

  const handleBlenderInstall = async () => {
    setBlenderInstalling(true);
    setBlenderError(null);
    try {
      const result: { success: boolean; error?: string; versions?: string[] } =
        await (window.electronAPI as any).blender.installAddon();
      if (!result.success) {
        setBlenderError(result.error ?? 'Installation failed');
      } else {
        setBlenderDone(true);
        setBlenderVersions(result.versions ?? []);
      }
    } catch (err) {
      setBlenderError(err instanceof Error ? err.message : String(err));
    }
    setBlenderInstalling(false);
  };

  const manualSteps = setupStatus.pendingSteps.filter(s => !s.isAutomatic);
  const autoSteps = setupStatus.pendingSteps.filter(s => s.isAutomatic);

  if (!engine) return null;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-50 rounded-2xl"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
    >
      <div
        className="rounded-2xl border border-white/[0.12] mx-4 flex flex-col"
        style={{
          background: 'rgba(10,10,20,0.95)',
          backdropFilter: 'blur(60px)',
          WebkitBackdropFilter: 'blur(60px)',
          width: '400px',
          maxWidth: '100%',
          maxHeight: 'calc(100vh - 120px)',
        }}
      >
        {/* Scrollable content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center flex-shrink-0">
            <EngineIcon engine={engine} size={20} />
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">Set up {ENGINE_NAMES[engine]}</h3>
            <p className="text-white/50 text-xs">Complete these steps to enable remote control</p>
            {engine === 'uefn' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-400/15 text-amber-400 border border-amber-400/25 mt-0.5">β Experimental</span>
            )}
          </div>
          <button
            onClick={onDismiss}
            className="ml-auto w-6 h-6 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-all"
          >
            <svg className="w-3.5 h-3.5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Automatic steps */}
        {engine === 'uefn' && (
          <div
            className="rounded-xl p-3"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.18)' }}
          >
            <p className="text-amber-300/80 text-xs leading-relaxed">⚗️ UEFN support is experimental. Core features work, but some edge cases may behave unexpectedly. Windows only.</p>
          </div>
        )}

        {autoSteps.length > 0 && (
          <div
            className="rounded-xl p-3 space-y-1.5"
            style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}
          >
            <div className="flex items-center gap-2">
              {isInstalling ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
              ) : installDone ? (
                <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <div className="w-3.5 h-3.5 rounded-full bg-white/[0.1] flex-shrink-0" />
              )}
              <span className="text-xs text-blue-300 font-medium">
                {isInstalling ? 'Installing dependencies...' : installDone ? 'Dependencies ready' : 'Will install automatically'}
              </span>
            </div>
            {autoSteps.map(step => (
              <p key={step.n} className="text-xs text-white/50 pl-5">{step.desc}</p>
            ))}
            {installError && (
              <p className="text-xs text-red-400 pl-5 mt-1">{installError}</p>
            )}
          </div>
        )}

        {/* Manual steps */}
        {manualSteps.length > 0 && (
          <div className="space-y-2">
            <p className="text-white/60 text-xs font-medium uppercase tracking-wider">One-time setup</p>
            {manualSteps.map((step: EngineSetupStep) => {
              const isGodotAddonStep = engine === 'godot' && step.n === 1;
              const isUnitySetupStep = engine === 'unity' && step.n === 2;
              const isBlenderAddonStep = engine === 'blender' && step.n === 2;
              const isUnrealEnginePathStep = engine === 'unreal' && step.n === 3;
              const isUefnEnginePathStep = engine === 'uefn' && step.n === 3;
              return (
                <div
                  key={step.n}
                  className="rounded-xl p-3 space-y-2"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <p className="text-white/80 text-xs font-medium">{step.title}</p>
                  <p className="text-white/50 text-xs whitespace-pre-line">{step.desc}</p>
                  {isGodotAddonStep && (
                    <div className="space-y-1.5 pt-0.5">
                      {!addonDone ? (
                        <button
                          onClick={handleInstallGodotAddon}
                          disabled={addonInstalling}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 disabled:opacity-50 transition-all"
                        >
                          {addonInstalling ? (
                            <>
                              <div className="w-3 h-3 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                              Copying addon…
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              Do it for me
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-xs text-green-400">Addon copied to project</span>
                        </div>
                      )}
                      {addonError && <p className="text-xs text-red-400">{addonError}</p>}
                    </div>
                  )}
                  {isUnitySetupStep && (
                    <div className="space-y-1.5 pt-0.5">
                      {!unitySetupDone ? (
                        <button
                          onClick={handleUnitySetup}
                          disabled={unitySetupRunning}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 disabled:opacity-50 transition-all"
                        >
                          {unitySetupRunning ? (
                            <>
                              <div className="w-3 h-3 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                              Building server…
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              Do it for me
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          <span className="text-xs text-green-400">Server ready</span>
                        </div>
                      )}
                      {unitySetupError && <p className="text-xs text-red-400">{unitySetupError}</p>}
                    </div>
                  )}
                  {isBlenderAddonStep && (
                    <div className="space-y-1.5 pt-0.5">
                      {!blenderDone ? (
                        <>
                          <button
                            onClick={handleBlenderInstall}
                            disabled={blenderInstalling}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 disabled:opacity-50 transition-all"
                          >
                            {blenderInstalling ? (
                              <>
                                <div className="w-3 h-3 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                                Copying to Blender…
                              </>
                            ) : (
                              <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Do it for me
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => (window.electronAPI as any).blender.showAddon()}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white/60 transition-all"
                          >
                            Manual: show addon.py in Finder
                          </button>
                        </>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-xs text-green-400">Addon installed ✓</span>
                          </div>
                          <p className="text-white/50 text-xs">Addon installed and enabled in Blender. Now click "Done, connect me".</p>
                        </div>
                      )}
                      {blenderError && <p className="text-xs text-red-400">{blenderError}</p>}
                    </div>
                  )}
                  {isUnrealEnginePathStep && (
                    <div className="space-y-1.5 pt-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-white/40 text-[11px]">Engine folder</span>
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
                          onBlur={() => unrealEnginePath && window.electronAPI.settings.update({ unrealEnginePath })}
                          placeholder="/Users/Shared/Epic Games/UE_5.4"
                          className="flex-1 px-3 py-1.5 bg-white/[0.06] border border-white/[0.1] rounded-lg text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-white/20 transition-all"
                        />
                        <button
                          onClick={handleBrowseEnginePath}
                          className="px-2.5 py-1.5 bg-white/[0.08] hover:bg-white/[0.12] rounded-lg text-white/80 text-xs font-medium transition-all whitespace-nowrap"
                        >
                          Browse
                        </button>
                      </div>
                      {enginePathError && <p className="text-xs text-red-400">{enginePathError}</p>}
                    </div>
                  )}
                  {isUefnEnginePathStep && (
                    <div className="space-y-2 pt-0.5">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white/40 text-[11px]">UEFN install folder</span>
                          <button
                            onClick={handleDetectUefnPath}
                            disabled={isDetectingUefn}
                            className="text-[11px] text-blue-400/70 hover:text-blue-400 disabled:opacity-40 transition-colors"
                          >
                            {isDetectingUefn ? 'Detecting…' : 'Auto-detect'}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={uefnEnginePath}
                            onChange={(e) => setUefnEnginePath(e.target.value)}
                            onBlur={() => uefnEnginePath && window.electronAPI.settings.update({ uefnEnginePath })}
                            placeholder="/Users/Shared/Epic Games/UEFN"
                            className="flex-1 px-3 py-1.5 bg-white/[0.06] border border-white/[0.1] rounded-lg text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-white/20 transition-all"
                          />
                          <button
                            onClick={handleBrowseUefnEnginePath}
                            className="px-2.5 py-1.5 bg-white/[0.08] hover:bg-white/[0.12] rounded-lg text-white/80 text-xs font-medium transition-all whitespace-nowrap"
                          >
                            Browse
                          </button>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white/40 text-[11px]">UEFN project folder</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={uefnProjectPath}
                            onChange={(e) => setUefnProjectPath(e.target.value)}
                            onBlur={() => uefnProjectPath && window.electronAPI.settings.update({ uefnProjectPath })}
                            placeholder="/Users/me/Documents/MyFortniteIsland"
                            className="flex-1 px-3 py-1.5 bg-white/[0.06] border border-white/[0.1] rounded-lg text-xs text-white/90 placeholder-white/30 focus:outline-none focus:border-white/20 transition-all"
                          />
                          <button
                            onClick={handleBrowseUefnProjectPath}
                            className="px-2.5 py-1.5 bg-white/[0.08] hover:bg-white/[0.12] rounded-lg text-white/80 text-xs font-medium transition-all whitespace-nowrap"
                          >
                            Browse
                          </button>
                        </div>
                      </div>
                      {uefnPathError && <p className="text-xs text-red-400">{uefnPathError}</p>}
                    </div>
                  )}
                  {step.warn && (!isGodotAddonStep || addonDone) && (
                    <div
                      className="rounded-lg p-2.5 space-y-1"
                      style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
                    >
                      <p className="text-amber-300/70 text-xs whitespace-pre-line leading-relaxed">⚠ {step.warn}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        </div>{/* end scrollable content */}

        {/* Actions — fixed at bottom */}
        <div className="flex gap-2 p-4 pt-0 flex-shrink-0">
          <button
            onClick={onDismiss}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium text-white/50 hover:text-white/70 bg-white/[0.05] hover:bg-white/[0.08] transition-all"
          >
            Skip for now
          </button>
          <button
            onClick={handleConnect}
            disabled={isConnecting || isInstalling}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white transition-all"
          >
            {isConnecting ? 'Connecting...' : "Done, connect me"}
          </button>
        </div>
      </div>
    </div>
  );
}
