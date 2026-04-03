import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore, selectIsPro } from '../../store';
import { MessageBubble } from '../chat/MessageBubble';
import { StreamingMessage } from '../chat/StreamingMessage';
import { GuidedStepView } from '../chat/GuidedStepView';
import { UpgradePrompt } from '../auth/UpgradePrompt';
import { FairUseTimeoutBanner } from '../common/FairUseTimeoutBanner';
import { detectSteps, hasEarlyStepIntent } from '../../utils/stepDetector';
import type { ChatMessage } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

interface ExpandedPanelProps {
  onClose: () => void;
}

const QUICK_ACTIONS = [
  { id: 'assist', label: 'Assist', icon: '✦' },
  { id: 'followup', label: 'Follow-up questions', icon: '💬' },
  { id: 'recap', label: 'Recap', icon: '↻' },
];

const enableDoItForMe = true;
const enableQuickActions = false;

const HISTORY_WINDOW_SIZE = 10;
const SUMMARIZE_THRESHOLD = 16;

export function ExpandedPanel({ onClose }: ExpandedPanelProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingResponseRef = useRef<string>('');
  const threadRestoredRef = useRef(false);
  
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeTitle, setUpgradeTitle] = useState('');
  const [upgradeMessage, setUpgradeMessage] = useState('');
  const [showFairUseTimeout, setShowFairUseTimeout] = useState(false);
  const [fairUseUnlockedAt, setFairUseUnlockedAt] = useState<number | null>(null);
  const [fairUseRequestType, setFairUseRequestType] = useState<'chat' | 'rc'>('chat');
  const [updateReady, setUpdateReady] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateDismissedAt, setUpdateDismissedAt] = useState<number | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamingRevealed, setStreamingRevealed] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const {
    messages,
    isLoading,
    streamingResponse,
    currentContext,
    addMessage,
    setLoading,
    setStreamingResponse,
    appendStreamingResponse,
    setAttachedScreenshot,
    authState,
    dailyUsage,
    setDailyUsage,
    settings,
    memorySummary,
    summarizedUpTo,
    loadThread,
    setMemorySummary,
    setSummarizedUpTo,
    startNewThread,
    guidedSteps,
    guidedModePending,
    enterGuidedMode,
    setGuidedModePending,
    selectedEngine,
    engineMCPStatus,
    unrealMCPStatus,
    agentMode,
    setAgentMode,
  } = useAppStore();
  const isPro = useAppStore(selectIsPro);

  const activeMCPStatus = selectedEngine === 'unreal' ? unrealMCPStatus : engineMCPStatus;
  const isMCPConnected = !!(selectedEngine && activeMCPStatus === 'connected');

  const startMCP = () => {
    if (!isPro && !settings?.devMode) {
      setUpgradeTitle('Pro Feature');
      setUpgradeMessage('Engine Remote Control is available on the Pro plan. Upgrade to directly control Unreal, Unity, Godot, Blender, and more from the AI.');
      setShowUpgradePrompt(true);
      return;
    }
    if (selectedEngine === 'unreal') window.electronAPI.unrealMcp.start();
    else (window.electronAPI as any).engineMcp.start();
  };
  const stopMCP = () => {
    if (selectedEngine === 'unreal') window.electronAPI.unrealMcp.stop();
    else (window.electronAPI as any).engineMcp.stop();
  };

  // Reset any stale guided mode state on mount (can get stuck after HMR reloads or re-opens)
  useEffect(() => {
    const state = useAppStore.getState();
    if (state.guidedModePending || state.guidedSteps) {
      state.exitGuidedMode();
    }
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    streamingResponseRef.current = streamingResponse;
  }, [streamingResponse]);

  // When a new AI request starts, hold the streaming display briefly to let step detection run first.
  // This prevents the user from seeing typing text that will immediately switch to guided mode.
  useEffect(() => {
    if (isLoading) {
      setStreamingRevealed(false);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      revealTimerRef.current = setTimeout(() => {
        if (!useAppStore.getState().guidedModePending) {
          setStreamingRevealed(true);
        }
      }, 600);
    } else {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      setStreamingRevealed(false);
    }
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    };
  }, [isLoading]);

  // Early intent: as soon as "1. " appears on its own line, hide the stream and
  // show "Preparing guided steps…" — before the 600ms reveal timer fires.
  // This prevents the user from seeing the raw typed text before guided mode kicks in.
  useEffect(() => {
    if (!streamingResponse || guidedModePending || streamingRevealed) return;
    const state = useAppStore.getState();
    const activeStatus = state.selectedEngine === 'unreal' ? state.unrealMCPStatus : state.engineMCPStatus;
    if (state.selectedEngine && activeStatus === 'connected' && state.agentMode === 'action') return;
    if (hasEarlyStepIntent(streamingResponse)) {
      setGuidedModePending(true);
    }
  }, [streamingResponse, guidedModePending, streamingRevealed, setGuidedModePending]);

  // Detect steps mid-stream so we can hide the typing and go straight to guided mode.
  // Skip only when MCP is active AND in action mode — tool calls handle execution directly.
  useEffect(() => {
    if (!streamingResponse || guidedModePending) return;
    const state = useAppStore.getState();
    const activeStatus = state.selectedEngine === 'unreal' ? state.unrealMCPStatus : state.engineMCPStatus;
    if (state.selectedEngine && activeStatus === 'connected' && state.agentMode === 'action') return;
    const detected = detectSteps(streamingResponse);
    if (detected) {
      setGuidedModePending(true);
      setStreamingRevealed(false);
    }
  }, [streamingResponse, guidedModePending, setGuidedModePending]);

  const showStepsUI = !!(guidedSteps || guidedModePending);
  const hasMessages = messages.length > 0 || (streamingResponse && !guidedModePending);

  // Restore active thread on mount
  useEffect(() => {
    if (threadRestoredRef.current) return;
    threadRestoredRef.current = true;

    (async () => {
      try {
        const activeId = await window.electronAPI.threads.getActive();
        if (activeId) {
          const thread = await window.electronAPI.threads.get(activeId);
          if (thread && thread.messages.length > 0) {
            loadThread(thread);
          }
        }
      } catch (err) {
        console.error('Failed to restore thread:', err);
      }
    })();
  }, [loadThread]);

  // Auto-expand window to conversation size when first message arrives
  useEffect(() => {
    if (hasMessages) {
      window.electronAPI?.window.growForConversation();
    }
  }, [!!hasMessages]);

  // Auto-focus textarea on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Listen for auto-update events
  useEffect(() => {
    const unsubReady = window.electronAPI.updater.onUpdateReady(() => {
      setUpdateReady(true);
      setUpdateDownloading(null);
      setUpdateError(null);
    });
    const unsubDownloading = window.electronAPI.updater.onDownloading((version) => {
      setUpdateDownloading(version);
      setUpdateError(null);
    });
    const unsubError = window.electronAPI.updater.onError((message) => {
      setUpdateError(message);
      setUpdateDownloading(null);
    });
    return () => { unsubReady(); unsubDownloading(); unsubError(); };
  }, []);

  const dismissUpdatePopup = () => {
    setUpdateDismissedAt(Date.now());
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setUpdateDismissedAt(null);
    }, 30 * 60 * 1000);
  };

  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  const showUpdatePopup = (updateReady || !!updateError) && !updateDismissedAt;

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    if (input) {
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingResponse]);

  // Trigger async summarization when message count exceeds threshold
  const triggerSummarizationIfNeeded = useCallback(async (currentMessages: ChatMessage[], currentSummarizedUpTo: number, currentMemorySummary: string | null) => {
    if (currentMessages.length <= SUMMARIZE_THRESHOLD) return;

    const summarizeEnd = currentMessages.length - HISTORY_WINDOW_SIZE;
    if (summarizeEnd <= currentSummarizedUpTo) return;

    const messagesToSummarize = currentMessages
      .slice(currentSummarizedUpTo, summarizeEnd)
      .map((m) => ({ role: m.role, content: m.content }));

    if (messagesToSummarize.length === 0) return;

    try {
      console.log(`[Summarize] Summarizing messages ${currentSummarizedUpTo}-${summarizeEnd}`);
      const summary = await window.electronAPI.ai.summarize({
        messages: messagesToSummarize,
        existingSummary: currentMemorySummary || undefined,
      });
      if (summary) {
        setMemorySummary(summary);
        setSummarizedUpTo(summarizeEnd);
        console.log('[Summarize] Summary updated, covers up to index', summarizeEnd);
      }
    } catch (err) {
      console.error('[Summarize] Failed:', err);
    }
  }, [setMemorySummary, setSummarizedUpTo]);

  // Set up AI response listeners
  useEffect(() => {
    const unsubscribeStream = window.electronAPI.ai.onStream((chunk) => {
      appendStreamingResponse(chunk);
    });

    const unsubscribeComplete = window.electronAPI.ai.onComplete(() => {
      const currentResponse = streamingResponseRef.current;
      if (currentResponse) {
        const messageId = uuidv4();
        const assistantMessage: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: currentResponse,
          timestamp: Date.now(),
        };
        addMessage(assistantMessage);
        setStreamingResponse('');

        // Check for step-by-step content and enter guided mode.
        // Skip only when MCP is active AND in action mode — tool calls handle execution directly.
        const detected = detectSteps(currentResponse);
        const state = useAppStore.getState();
        const activeStatus2 = state.selectedEngine === 'unreal' ? state.unrealMCPStatus : state.engineMCPStatus;
        const mcpActive = !!(state.selectedEngine && activeStatus2 === 'connected');
        if (detected && !(mcpActive && state.agentMode === 'action')) {
          const lastUserMsg = state.messages.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
          enterGuidedMode(detected.steps, messageId, lastUserMsg);
        } else {
          setGuidedModePending(false);
        }

        // Check if summarization is needed (async, non-blocking)
        triggerSummarizationIfNeeded(
          state.messages,
          state.summarizedUpTo,
          state.memorySummary
        );
      }
      setLoading(false);
    });

    const unsubscribeError = window.electronAPI.ai.onError((error) => {
      console.error('AI error:', error.message);
      setLoading(false);
      setStreamingResponse('');

      if (error.type === 'fair_use_timeout') {
        setFairUseUnlockedAt(error.unlockedAt ?? Date.now() + 15 * 60 * 1000);
        setFairUseRequestType(isMCPConnected && agentMode === 'action' ? 'rc' : 'chat');
        setShowFairUseTimeout(true);
        return;
      }

      if (error.type === 'entitlement_limit') {
        setUpgradeTitle('');
        setUpgradeMessage(error.message);
        setShowUpgradePrompt(true);
        return;
      }

      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
    });

    return () => {
      unsubscribeStream();
      unsubscribeComplete();
      unsubscribeError();
    };
  }, [addMessage, appendStreamingResponse, setLoading, setStreamingResponse, triggerSummarizationIfNeeded, enterGuidedMode, setGuidedModePending]);

  const buildWindowedHistory = () => {
    const allMessages = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));
    return allMessages.slice(-HISTORY_WINDOW_SIZE);
  };

  const handleSend = async (prompt: string) => {
    if (!prompt.trim() || isLoading) return;

    // Clear input immediately for instant UI feedback
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setGuidedModePending(false);
    setStreamingResponse('');
    setLoading(true);

    try {
      const canAskResult = await window.electronAPI.auth.checkCanAsk();
      if (!canAskResult.allowed) {
        setLoading(false);
        setUpgradeTitle('');
        setUpgradeMessage(canAskResult.reason || '');
        setShowUpgradePrompt(true);
        setInput(prompt); // restore input so user doesn't lose their message
        return;
      }
    } catch (err) {
      console.error('Entitlement check failed:', err);
    }

    try {
      const fairUseState = await (window.electronAPI as any).fairuse.getState();
      if (fairUseState?.timeoutUntil && Date.now() < fairUseState.timeoutUntil) {
        setLoading(false);
        setFairUseUnlockedAt(fairUseState.timeoutUntil);
        setFairUseRequestType(isMCPConnected && agentMode === 'action' ? 'rc' : 'chat');
        setShowFairUseTimeout(true);
        setInput(prompt);
        return;
      }
    } catch (err) {
      console.error('Fair-use pre-check failed:', err);
    }

    let screenshot = null;
    try {
      screenshot = await window.electronAPI.capture.fullscreenSync();
    } catch (err) {
      console.error('Auto-screenshot failed:', err);
    }

    const isMCPOrder = isMCPConnected && agentMode === 'action';
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachedContext: currentContext || undefined,
      attachedScreenshot: screenshot
        ? { id: screenshot.id, thumbnailPath: screenshot.imagePath }
        : undefined,
      isOrder: isMCPOrder,
    };
    addMessage(userMessage);

    const conversationHistory = buildWindowedHistory();
    const currentMemorySummary = useAppStore.getState().memorySummary;

    console.log('Sending to AI with screenshot:', !!screenshot, 'history length:', conversationHistory.length, 'has recap:', !!currentMemorySummary);
    window.electronAPI.ai.ask({
      prompt,
      context: currentContext,
      screenshot,
      mode: 'general',
      agentMode,
      conversationHistory,
      memorySummary: currentMemorySummary || undefined,
    });

    try {
      const usage = await window.electronAPI.auth.getUsage();
      setDailyUsage(usage);
    } catch (err) {
      console.error('Failed to update usage:', err);
    }
  };

  const handleDoItForMe = () => {
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const action = lastUserMessage?.content || '';
    const prompt = action ? `Do it for me: ${action}` : 'Do it for me';

    setInput(prompt);
    setTimeout(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const handleQuickAction = (actionId: string) => {
    switch (actionId) {
      case 'assist':
        handleSend('Help me with what I\'m looking at');
        break;
      case 'followup':
        handleSend('Suggest some follow-up questions');
        break;
      case 'recap':
        handleSend('Give me a recap of what we discussed');
        break;
    }
  };

  const handleNewChat = () => {
    startNewThread();
  };

  const isBusy = isLoading;

  return (
    <>
      <div
        className="relative mt-2 rounded-2xl border border-white/[0.12] overflow-hidden flex flex-col w-full"
        style={{
          background: 'rgba(0, 0, 0, 0.78)',
          backdropFilter: 'blur(80px) saturate(200%)',
          WebkitBackdropFilter: 'blur(80px) saturate(200%)',
          maxHeight: 'calc(100vh - 52px)',
        }}
      >
        {/* Top bar with New Chat and Close */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]">
          {hasMessages ? (
            <button
              onClick={handleNewChat}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/60 hover:text-white/80 text-xs font-medium transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Chat
            </button>
          ) : (
            <div />
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-full bg-white/[0.1] hover:bg-white/[0.15] flex items-center justify-center transition-all"
          >
            <svg className="w-3.5 h-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Update banner */}
        {/* Update downloading banner */}
        {!updateReady && updateDownloading && (
          <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
            <span className="animate-spin inline-flex h-3 w-3 rounded-full border border-blue-400 border-t-transparent flex-shrink-0" />
            <span className="text-blue-300 text-xs">Downloading update v{updateDownloading}…</span>
          </div>
        )}
        {/* Update error banner */}
        {!updateReady && updateError && (
          <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border-b border-red-500/20">
            <span className="text-red-300 text-xs">Update failed — {updateError}</span>
            <a
              href="https://www.build-buddy.app"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 bg-red-500/80 hover:bg-red-400 rounded-md text-white text-[11px] font-medium transition-all whitespace-nowrap"
            >
              Download manually
            </a>
          </div>
        )}
        {/* Update ready banner */}
        {updateReady && (
          <div className="flex items-center justify-between px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
            <div className="flex items-center gap-2">
              <span className="text-blue-300 text-xs">A new version is available</span>
              <a
                href="https://www.build-buddy.app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400/60 hover:text-blue-300 text-[10px] underline underline-offset-2 transition-colors"
              >
                download manually
              </a>
            </div>
            <button
              onClick={() => window.electronAPI.updater.install()}
              className="px-2.5 py-1 bg-blue-500 hover:bg-blue-400 rounded-md text-white text-[11px] font-medium transition-all"
            >
              Restart to Update
            </button>
          </div>
        )}

        {/* Steps UI takes over the entire panel body */}
        {showStepsUI && !showUpgradePrompt && (
          guidedSteps ? (
            <GuidedStepView />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-8">
              <div className="w-5 h-5 border-2 border-blue-400/50 border-t-transparent rounded-full animate-spin" />
              <span className="text-blue-300/70 text-sm">Preparing guided steps...</span>
            </div>
          )
        )}

        {/* Normal chat view (hidden when steps UI is active) */}
        {!showStepsUI && (
          <>
            {/* Messages area */}
            {hasMessages && (
              <div className="overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: 'calc(100vh - 210px)' }}>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {streamingResponse && streamingRevealed && (
                  <StreamingMessage content={streamingResponse} />
                )}
                {isLoading && !streamingRevealed && !streamingResponse && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Upgrade Prompt */}
            {showUpgradePrompt && (
              <UpgradePrompt
                title={upgradeTitle}
                message={upgradeMessage}
                onDismiss={() => setShowUpgradePrompt(false)}
              />
            )}

            {/* Fair-use timeout banner */}
            {showFairUseTimeout && fairUseUnlockedAt && (
              <FairUseTimeoutBanner
                unlockedAt={fairUseUnlockedAt}
                requestType={fairUseRequestType}
                onDismiss={() => {
                  setShowFairUseTimeout(false);
                  setFairUseUnlockedAt(null);
                }}
              />
            )}

            {/* Update notification popup */}
            {showUpdatePopup && !showUpgradePrompt && (
              <div className={`mx-4 mb-3 rounded-xl border px-4 py-4 ${updateReady ? 'border-blue-500/20 bg-blue-500/[0.06]' : 'border-red-500/20 bg-red-500/[0.06]'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${updateReady ? 'bg-blue-500/20' : 'bg-red-500/20'}`}>
                      <svg className={`h-4 w-4 ${updateReady ? 'text-blue-400' : 'text-red-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white/90">
                        {updateReady ? 'Update ready to install' : 'Update failed to download'}
                      </p>
                      <p className="mt-0.5 text-xs text-white/50">
                        {updateReady
                          ? 'A new version of Build Buddy is available. Restart now to apply it.'
                          : 'Auto-update failed. You can download the latest version from our website.'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={dismissUpdatePopup}
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/[0.08] hover:bg-white/[0.14] transition-all"
                  >
                    <svg className="h-3 w-3 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  {updateReady && (
                    <button
                      onClick={() => window.electronAPI.updater.install()}
                      className="flex-1 rounded-lg bg-blue-500 py-2 text-xs font-semibold text-white hover:bg-blue-400 transition-all"
                    >
                      Restart to Update
                    </button>
                  )}
                  <a
                    href="https://build-buddy.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg border border-white/[0.12] bg-white/[0.06] py-2 text-center text-xs font-medium text-white/70 hover:bg-white/[0.10] hover:text-white/90 transition-all"
                  >
                    Download from website
                  </a>
                </div>
              </div>
            )}
          </>
        )}

        {/* Normal chat controls (hidden during guided mode) */}
        {!showStepsUI && (
          <>
            {/* Remaining asks row — only shown for limited free users */}
            {!showUpgradePrompt && authState?.entitlement && !authState.entitlement.features?.unlimited_asks && !settings?.devMode && (
              <div className="flex items-center px-4 py-1.5">
                <span className="text-white/30 text-xs">
                  {(() => {
                    const limit = authState.entitlement.features?.daily_limit ?? 10;
                    const used = dailyUsage?.askCount ?? 0;
                    const remaining = Math.max(0, limit - used);
                    return `${remaining} ask${remaining !== 1 ? 's' : ''} remaining this week`;
                  })()}
                </span>
              </div>
            )}

            {/* Input area */}
            <div className="px-4 pb-4 pt-3 border-t border-white/[0.08]">
              {/* MCP status + Do it for me — same row above textarea */}
              {selectedEngine || (enableDoItForMe && messages.length > 0) ? (
                <div className="flex items-center justify-between mb-2">
                  {/* Left: MCP status with optional Connect button */}
                  {selectedEngine ? (
                    <div className="flex items-center gap-1.5">
                      {activeMCPStatus === 'connected' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                          <span className="text-xs text-green-400/80">MCP connected</span>
                          {/* Guide / Act toggle — only visible when MCP is connected */}
                          <div className="ml-2 flex items-center rounded-full border border-white/[0.12] bg-white/[0.04] p-0.5">
                            <button
                              onClick={() => setAgentMode('guide')}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${agentMode === 'guide' ? 'bg-blue-500/30 text-blue-300' : 'text-white/30 hover:text-white/60'}`}
                              title="Guide mode: AI explains steps for you to follow manually"
                            >
                              Guide
                            </button>
                            <button
                              onClick={() => setAgentMode('action')}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${agentMode === 'action' ? 'bg-purple-500/30 text-purple-300' : 'text-white/30 hover:text-white/60'}`}
                              title="Action mode: AI executes directly in the editor"
                            >
                              Act
                            </button>
                          </div>
                          {selectedEngine === 'godot' && (
                            <button
                              onClick={async () => {
                                const result = await (window.electronAPI as any).godot.installAddon();
                                if (result?.projectPath) {
                                  const updated = await window.electronAPI.settings.get();
                                  if (updated) useAppStore.getState().setSettings(updated);
                                }
                              }}
                              className="ml-1 px-2 py-0.5 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-white/40 hover:text-white/70 text-xs transition-all"
                              title={settings?.godotProjectPath || 'Select project folder'}
                            >
                              📁 {settings?.godotProjectPath
                                ? settings.godotProjectPath.split('/').pop() || 'Folder'
                                : 'Add folder'}
                            </button>
                          )}
                          {selectedEngine === 'unreal' && (
                            <button
                              onClick={async () => {
                                const result = await (window.electronAPI as any).unreal.selectProjectFolder();
                                if (result?.projectPath) {
                                  const updated = await window.electronAPI.settings.get();
                                  if (updated) useAppStore.getState().setSettings(updated);
                                }
                              }}
                              className="ml-1 px-2 py-0.5 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-white/40 hover:text-white/70 text-xs transition-all"
                              title={settings?.ueProjectPath || 'Select UE project folder'}
                            >
                              📁 {settings?.ueProjectPath
                                ? settings.ueProjectPath.split('/').pop() || 'Project'
                                : 'Add project'}
                            </button>
                          )}
                        </>
                      ) : activeMCPStatus === 'starting' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block animate-pulse" />
                          <span className="text-xs text-yellow-400/80">MCP connecting…</span>
                        </>
                      ) : activeMCPStatus === 'error' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                          <span className="text-xs text-red-400/80">MCP error</span>
                          <button
                            onClick={startMCP}
                            className="ml-1 px-2 py-0.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-white/50 hover:text-white/80 text-xs transition-all"
                          >
                            Reconnect
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-white/20 inline-block" />
                          <span className="text-xs text-white/30">MCP disconnected</span>
                          {selectedEngine === 'unreal' && (
                            <button
                              onClick={async () => {
                                const result = await (window.electronAPI as any).unreal.selectProjectFolder();
                                if (result?.projectPath) {
                                  const updated = await window.electronAPI.settings.get();
                                  if (updated) useAppStore.getState().setSettings(updated);
                                }
                              }}
                              className="ml-1 px-2 py-0.5 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-white/40 hover:text-white/70 text-xs transition-all"
                              title={settings?.ueProjectPath || 'Select UE project folder'}
                            >
                              📁 {settings?.ueProjectPath
                                ? settings.ueProjectPath.split('/').pop() || 'Project'
                                : 'Add project'}
                            </button>
                          )}
                          <button
                            onClick={startMCP}
                            className="ml-1 px-2 py-0.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 text-blue-300 text-xs transition-all"
                          >
                            Connect
                          </button>
                        </>
                      )}
                    </div>
                  ) : <div />}

                  {/* Right: Do it for me */}
                  {enableDoItForMe && messages.length > 0 && (
                    <button
                      onClick={handleDoItForMe}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 border border-purple-400/30 text-purple-300 text-xs font-medium transition-all disabled:opacity-50 whitespace-nowrap"
                      title="Fill in a prompt to execute the last request"
                    >
                      <span>🪄</span>
                      <span>Do it for me</span>
                    </button>
                  )}
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about your screen, or ⌘↵ to Assist"
                    disabled={isBusy}
                    rows={1}
                    className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.1] rounded-xl text-sm text-white/95 placeholder-white/40 resize-none focus:outline-none focus:border-white/20 disabled:opacity-50 transition-all hide-scrollbar"
                  />
                </div>

                {/* Send button */}
                <button
                  onClick={() => handleSend(input)}
                  disabled={!input.trim() || isBusy}
                  className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-400 disabled:bg-white/[0.08] flex items-center justify-center transition-all disabled:opacity-50"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>

    </>
  );
}
