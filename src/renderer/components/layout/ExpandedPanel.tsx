import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../store';
import { MessageBubble } from '../chat/MessageBubble';
import { StreamingMessage } from '../chat/StreamingMessage';
import { ActionPlanModal } from '../agent/ActionPlanModal';
import { ExecutionOverlay } from '../agent/ExecutionOverlay';
import { PermissionModal } from '../agent/PermissionModal';
import { UpgradePrompt } from '../auth/UpgradePrompt';
import type { ChatMessage, ActionPlan, ExecutionProgress, CaptureResult } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

interface ExpandedPanelProps {
  onClose: () => void;
}

const QUICK_ACTIONS = [
  { id: 'assist', label: 'Assist', icon: '✦' },
  { id: 'followup', label: 'Follow-up questions', icon: '💬' },
  { id: 'recap', label: 'Recap', icon: '↻' },
];

// Config flags - set to false to disable features
const enableDoItForMe = false;
const enableQuickActions = false;

export function ExpandedPanel({ onClose }: ExpandedPanelProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingResponseRef = useRef<string>('');
  
  // Agent state
  const [isPlanning, setIsPlanning] = useState(false);
  const [actionPlan, setActionPlan] = useState<ActionPlan | null>(null);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [permissionPlatform, setPermissionPlatform] = useState('');
  const [lastScreenshot, setLastScreenshot] = useState<CaptureResult | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const escPressCount = useRef(0);
  const escResetTimer = useRef<NodeJS.Timeout | null>(null);
  
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
    unrealMCPStatus,
    settings,
  } = useAppStore();

  // Keep ref in sync with state
  useEffect(() => {
    streamingResponseRef.current = streamingResponse;
  }, [streamingResponse]);

  const hasMessages = messages.length > 0 || streamingResponse;

  // Auto-expand window to conversation size when first message arrives
  useEffect(() => {
    if (hasMessages) {
      window.electronAPI?.window.growForConversation();
    }
  }, [!!hasMessages]);

  // Auto-focus textarea on mount
  useEffect(() => {
    // Small delay to ensure the component is fully rendered
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Listen for auto-update ready
  useEffect(() => {
    const unsubscribe = window.electronAPI.updater.onUpdateReady(() => {
      setUpdateReady(true);
    });
    return unsubscribe;
  }, []);

  // Auto-resize textarea — only measure scrollHeight when there's actual content,
  // otherwise the placeholder text causes Chromium to report a 2-row scrollHeight.
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

  // Set up AI response listeners
  useEffect(() => {
    const unsubscribeStream = window.electronAPI.ai.onStream((chunk) => {
      appendStreamingResponse(chunk);
    });

    const unsubscribeComplete = window.electronAPI.ai.onComplete(() => {
      const currentResponse = streamingResponseRef.current;
      if (currentResponse) {
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: currentResponse,
          timestamp: Date.now(),
        };
        addMessage(assistantMessage);
        setStreamingResponse('');
      }
      setLoading(false);
    });

    const unsubscribeError = window.electronAPI.ai.onError((error) => {
      console.error('AI error:', error.message);
      setLoading(false);
      setStreamingResponse('');

      // Check if this is an entitlement limit error
      if (error.type === 'entitlement_limit') {
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
  }, [addMessage, appendStreamingResponse, setLoading, setStreamingResponse]);

  // Set up agent progress listener
  useEffect(() => {
    const unsubscribe = window.electronAPI.agent.onProgress((progress) => {
      setExecutionProgress(progress);
      
      // Clear progress after completion/error/stop
      if (['completed', 'error', 'stopped'].includes(progress.status)) {
        setTimeout(() => {
          setExecutionProgress(null);
          
          // Add summary message to chat
          if (progress.status === 'completed' && progress.completedActions.length > 0) {
            const summaryMessage: ChatMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: `✅ **Done!** Here's what I did:\n\n${progress.completedActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}`,
              timestamp: Date.now(),
            };
            addMessage(summaryMessage);
          } else if (progress.status === 'error') {
            const errorMessage: ChatMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: `❌ **Execution failed:** ${progress.error}`,
              timestamp: Date.now(),
            };
            addMessage(errorMessage);
          } else if (progress.status === 'stopped') {
            const stoppedMessage: ChatMessage = {
              id: uuidv4(),
              role: 'assistant',
              content: `⏹ **Stopped.** Completed ${progress.completedActions.length} actions before stopping.`,
              timestamp: Date.now(),
            };
            addMessage(stoppedMessage);
          }
        }, 2000);
      }
    });

    return () => unsubscribe();
  }, [addMessage]);

  // ESC key handler for stopping execution
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // For modals
        if (actionPlan) {
          setActionPlan(null);
          return;
        }
        if (showPermissionModal) {
          setShowPermissionModal(false);
          return;
        }
        
        // Double ESC to stop execution
        if (executionProgress?.status === 'running') {
          escPressCount.current++;
          
          if (escResetTimer.current) {
            clearTimeout(escResetTimer.current);
          }
          
          if (escPressCount.current >= 2) {
            window.electronAPI.agent.stop();
            escPressCount.current = 0;
          } else {
            escResetTimer.current = setTimeout(() => {
              escPressCount.current = 0;
            }, 500);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actionPlan, showPermissionModal, executionProgress]);

  // Detect when user is asking us to DO something in UE (imperative) vs asking a question
  const isImperativeMCPRequest = (text: string): boolean => {
    const lower = text.toLowerCase().trim();
    // Skip obvious questions
    if (/^(how|what|why|when|where|which|who|is |are |does |did |can you explain|tell me|explain|show me how)/.test(lower)) return false;
    // Match action imperatives
    return (
      /\bdo it\b/.test(lower) ||
      /\bdo this\b/.test(lower) ||
      /\bfor me\b/.test(lower) && /\b(make|create|build|add|implement|execute|run|place|delete|remove|spawn|do|set up|modify|change|update|generate)\b/.test(lower) ||
      /^(make|create|build|add|implement|execute|run|place|delete|remove|spawn|modify|change|update|generate|set up)\s+(it|this|that|a |an |the |me )\b/.test(lower) ||
      /\b(make|create|build|add|implement|place|delete|remove|spawn)\s+(it|this|that)\b/.test(lower) ||
      /\bgo ahead\b/.test(lower) ||
      /\bjust do( it)?\b/.test(lower)
    );
  };

  const handleSend = async (prompt: string) => {
    if (!prompt.trim() || isLoading) return;

    // Check entitlement before sending
    try {
      const canAskResult = await window.electronAPI.auth.checkCanAsk();
      if (!canAskResult.allowed) {
        setUpgradeMessage(canAskResult.reason || '');
        setShowUpgradePrompt(true);
        return;
      }
    } catch (err) {
      console.error('Entitlement check failed:', err);
      // Allow ask to proceed on error (graceful degradation)
    }

    // Auto-capture screenshot before sending
    let screenshot = null;
    try {
      console.log('Capturing screenshot...');
      screenshot = await window.electronAPI.capture.fullscreenSync();
      setLastScreenshot(screenshot);
      console.log('Screenshot captured:', screenshot ? {
        id: screenshot.id,
        hasBase64: !!screenshot.imageBase64,
        base64Length: screenshot.imageBase64?.length,
        dimensions: screenshot.dimensions
      } : 'null');
    } catch (err) {
      console.error('Auto-screenshot failed:', err);
    }

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachedContext: currentContext || undefined,
      attachedScreenshot: screenshot
        ? { id: screenshot.id, thumbnailPath: screenshot.imagePath }
        : undefined,
    };
    addMessage(userMessage);

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // ── MCP Execute path ────────────────────────────────────────────────────
    // If the user typed an action command AND MCP is connected, execute it
    // directly in Unreal Engine via Python instead of the normal chat flow.
    if (unrealMCPStatus === 'connected' && isImperativeMCPRequest(prompt)) {
      console.log('[MCP] Imperative detected, routing to MCP execution');
      setLoading(true);
      setStreamingResponse('⚡ Making it happen in Unreal Engine...');

      // Build conversation history from previous messages
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      try {
        const result = await (window.electronAPI.unrealMcp as any).executeIntent({
          conversationHistory,
          intent: prompt,
        });

        setStreamingResponse('');

        const responseContent = result.success
          ? 'Done! I executed that in Unreal Engine.'
          : `**Execution failed:** ${result.error || 'Unknown error'}`;

        addMessage({
          id: uuidv4(),
          role: 'assistant',
          content: responseContent,
          timestamp: Date.now(),
        });
      } catch (err) {
        setStreamingResponse('');
        addMessage({
          id: uuidv4(),
          role: 'assistant',
          content: `**Error:** ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        });
      } finally {
        setLoading(false);
        try {
          await window.electronAPI.auth.recordAsk();
          const usage = await window.electronAPI.auth.getUsage();
          setDailyUsage(usage);
        } catch { /* ignore */ }
      }
      return;
    }
    // ── Normal chat path ────────────────────────────────────────────────────

    setStreamingResponse('');
    setLoading(true);

    // Build conversation history from previous messages
    const conversationHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    console.log('Sending to AI with screenshot:', !!screenshot, 'history length:', conversationHistory.length);
    window.electronAPI.ai.ask({
      prompt,
      context: currentContext,
      screenshot,
      mode: 'general',
      conversationHistory,
    });

    // Update usage count after sending
    try {
      const usage = await window.electronAPI.auth.getUsage();
      setDailyUsage(usage);
    } catch (err) {
      console.error('Failed to update usage:', err);
    }
  };

  const handleDoItForMe = async () => {
    console.log('[DoItForMe] 🚀 Starting...');
    console.log('[DoItForMe] Messages count:', messages.length);
    
    // Check if we have context
    if (messages.length === 0) {
      console.log('[DoItForMe] ❌ No messages, showing error');
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: '❓ Please ask me something first, then I can help execute the actions!',
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
      return;
    }

    // Check permissions first
    console.log('[DoItForMe] 🔐 Checking permissions...');
    try {
      const permResult = await window.electronAPI.agent.checkPermissions();
      console.log('[DoItForMe] Permission result:', permResult);
      if (!permResult.hasPermission) {
        console.log('[DoItForMe] ❌ No permission, showing modal');
        setPermissionPlatform(permResult.platform);
        setShowPermissionModal(true);
        return;
      }
    } catch (permErr) {
      console.error('[DoItForMe] ❌ Permission check failed:', permErr);
    }

    // Capture fresh screenshot
    console.log('[DoItForMe] 📷 Capturing screenshot...');
    let screenshot: CaptureResult | null = null;
    try {
      screenshot = await window.electronAPI.capture.fullscreenSync();
      setLastScreenshot(screenshot);
      console.log('[DoItForMe] ✅ Screenshot captured:', screenshot ? `${screenshot.dimensions.width}x${screenshot.dimensions.height}` : 'null');
    } catch (err) {
      console.error('[DoItForMe] ❌ Screenshot capture failed:', err);
    }

    if (!screenshot) {
      console.log('[DoItForMe] ❌ No screenshot, showing error');
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: '📷 Please capture your screen first so I can see what to do. Try asking a question first!',
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
      return;
    }

    // Build conversation context
    console.log('[DoItForMe] 📝 Building conversation context...');
    const conversationContext = messages
      .slice(-6) // Last 6 messages for context
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    console.log('[DoItForMe] Last user message:', lastUserMessage?.content?.substring(0, 100));

    setIsPlanning(true);
    console.log('[DoItForMe] 🤖 Requesting action plan from AI...');

    try {
      const planResult = await window.electronAPI.agent.requestPlan({
        conversationContext,
        lastUserRequest: lastUserMessage?.content || 'Help me with what I\'m looking at',
        screenshot,
      });

      console.log('[DoItForMe] 📋 Plan result received:', planResult);

      if ('error' in planResult) {
        console.log('[DoItForMe] ❌ Plan has error:', planResult.error);
        throw new Error(planResult.error);
      }

      console.log('[DoItForMe] ✅ Action plan created with', planResult.actions?.length, 'actions');
      setActionPlan(planResult);
    } catch (err) {
      console.error('[DoItForMe] ❌ Failed to create action plan:', err);
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `❌ Failed to create action plan: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
    } finally {
      setIsPlanning(false);
      console.log('[DoItForMe] 🏁 Done');
    }
  };

  const handleApprovePlan = async () => {
    if (!actionPlan) return;

    setActionPlan(null);

    // Add message showing we're starting
    const startMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: `🤖 **Executing action plan:** ${actionPlan.goal}\n\n*${actionPlan.actions.length} actions to perform...*`,
      timestamp: Date.now(),
    };
    addMessage(startMessage);

    // Execute the plan with display bounds, screenshot dimensions, and scale factor for coordinate scaling
    console.log('[DoItForMe] Executing with displayBounds:', lastScreenshot?.displayBounds);
    console.log('[DoItForMe] Screenshot dimensions:', lastScreenshot?.dimensions);
    console.log('[DoItForMe] Scale factor:', lastScreenshot?.scaleFactor);
    await window.electronAPI.agent.execute(
      actionPlan.actions, 
      lastScreenshot?.displayBounds,
      lastScreenshot?.dimensions,
      lastScreenshot?.scaleFactor
    );
  };

  const handleStopExecution = () => {
    window.electronAPI.agent.stop();
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

  const isExecuting = executionProgress?.status === 'running';
  const isBusy = isLoading || isPlanning || isExecuting;

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
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/[0.1] hover:bg-white/[0.15] flex items-center justify-center transition-all z-10"
        >
          <svg className="w-3.5 h-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Update banner */}
        {updateReady && (
          <div className="flex items-center justify-between px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
            <span className="text-blue-300 text-xs">A new version is available</span>
            <button
              onClick={() => window.electronAPI.updater.install()}
              className="px-2.5 py-1 bg-blue-500 hover:bg-blue-400 rounded-md text-white text-[11px] font-medium transition-all"
            >
              Restart to Update
            </button>
          </div>
        )}

        {/* Messages area (only if there are messages) */}
        {hasMessages && (
          <div className="overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: 'calc(100vh - 210px)' }}>
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {streamingResponse && <StreamingMessage content={streamingResponse} />}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Quick actions */}
        {(enableQuickActions || enableDoItForMe) && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.08]">
            {enableQuickActions && QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action.id)}
                disabled={isBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/80 text-xs font-medium transition-all disabled:opacity-50 whitespace-nowrap"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}

            {/* Do it for me button */}
            {enableDoItForMe && messages.length > 0 && (
              <button
                onClick={handleDoItForMe}
                disabled={isBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 border border-purple-400/30 text-purple-300 text-xs font-medium transition-all disabled:opacity-50 whitespace-nowrap ml-auto"
                title="Let BuildBuddy execute actions for you"
              >
                {isPlanning ? (
                  <>
                    <div className="w-3 h-3 border border-purple-300 border-t-transparent rounded-full animate-spin" />
                    <span>Planning...</span>
                  </>
                ) : (
                  <>
                    <span>🪄</span>
                    <span>Do it for me</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Upgrade Prompt */}
        {showUpgradePrompt && (
          <UpgradePrompt
            message={upgradeMessage}
            onDismiss={() => setShowUpgradePrompt(false)}
          />
        )}

        {/* Remaining asks counter for free users — hidden in dev mode */}
        {authState?.entitlement && !authState.entitlement.features?.unlimited_asks && !showUpgradePrompt && !settings?.devMode && (
          <div className="px-4 py-1">
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
      </div>

      {/* Action Plan Modal */}
      {actionPlan && (
        <ActionPlanModal
          plan={actionPlan}
          onApprove={handleApprovePlan}
          onCancel={() => setActionPlan(null)}
        />
      )}

      {/* Execution Overlay */}
      {executionProgress && (
        <ExecutionOverlay
          progress={executionProgress}
          onStop={handleStopExecution}
        />
      )}

      {/* Permission Modal */}
      {showPermissionModal && (
        <PermissionModal
          platform={permissionPlatform}
          onClose={() => setShowPermissionModal(false)}
        />
      )}
    </>
  );
}
