import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  AuthState,
  CaptureResult,
  ChatMessage,
  ConnectionStatus,
  ConnectorClient,
  ConversationThread,
  DailyUsage,
  EngineMCPStatus,
  EngineSetupStatus,
  HotkeyConfig,
  MCPProjectInfo,
  ProjectInfoEvent,
  SelectedEngine,
  Session,
  ThreadListItem,
  UnrealContext,
  UnrealMCPStatus,
  UserSettings,
} from '../../shared/types';

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 2000;

function debounceSaveThread(getState: () => AppState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const state = getState();
    if (state.currentThreadId && state.messages.length > 0) {
      const thread: ConversationThread = {
        id: state.currentThreadId,
        title: state.currentThreadTitle,
        messages: state.messages,
        memorySummary: state.memorySummary,
        summarizedUpTo: state.summarizedUpTo,
        createdAt: state.currentThreadCreatedAt,
        updatedAt: Date.now(),
        projectName: state.projectInfo?.project_name,
      };
      window.electronAPI?.threads?.save(thread);
      window.electronAPI?.threads?.setActive(thread.id);
    }
  }, SAVE_DEBOUNCE_MS);
}

function generateThreadTitle(content: string): string {
  const cleaned = content.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + '...';
}

interface AppState {
  // UI State
  isCollapsed: boolean;
  isPinned: boolean;
  activeView: 'chat' | 'history' | 'settings';

  // Connection State
  connectorStatus: ConnectionStatus;
  connectorClient: ConnectorClient | null;
  projectInfo: ProjectInfoEvent | null;
  lastContextUpdate: number | null;
  currentContext: UnrealContext | null;

  // Chat State
  messages: ChatMessage[];
  isLoading: boolean;
  streamingResponse: string;
  attachedScreenshot: CaptureResult | null;

  // Thread State
  currentThreadId: string | null;
  currentThreadTitle: string;
  currentThreadCreatedAt: number;
  memorySummary: string | null;
  summarizedUpTo: number;
  threadList: ThreadListItem[];

  // Settings
  settings: UserSettings | null;
  hotkeyConfig: HotkeyConfig | null;

  // Auth
  authState: AuthState | null;
  dailyUsage: DailyUsage | null;

  // History
  sessions: Session[];

  // Unreal MCP
  unrealMCPStatus: UnrealMCPStatus;
  unrealMCPProjectInfo: MCPProjectInfo | null;

  // Engine Selection
  selectedEngine: SelectedEngine;
  engineMCPStatus: EngineMCPStatus;
  engineSetupStatus: EngineSetupStatus | null;
  isEngineSetupOpen: boolean;

  // Guided Step Mode
  guidedSteps: string[] | null;
  guidedCurrentStep: number;
  guidedVerification: string | null;
  guidedSourceMessageId: string | null;
  guidedModePending: boolean;
  guidedGoal: string | null;
  guidedIsComplete: boolean;

  // Actions - UI
  setCollapsed: (collapsed: boolean) => void;
  setPinned: (pinned: boolean) => void;
  setActiveView: (view: 'chat' | 'history' | 'settings') => void;

  // Actions - Connection
  setConnectorStatus: (status: ConnectionStatus, client: ConnectorClient | null) => void;
  setCurrentContext: (context: UnrealContext) => void;

  // Actions - Chat
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setLoading: (loading: boolean) => void;
  setStreamingResponse: (text: string) => void;
  appendStreamingResponse: (chunk: string) => void;
  setAttachedScreenshot: (screenshot: CaptureResult | null) => void;
  clearChat: () => void;

  // Actions - Thread
  startNewThread: () => void;
  loadThread: (thread: ConversationThread) => void;
  setCurrentThreadId: (id: string | null) => void;
  setMemorySummary: (summary: string | null) => void;
  setSummarizedUpTo: (index: number) => void;
  setThreadList: (list: ThreadListItem[]) => void;

  // Actions - Settings
  setSettings: (settings: UserSettings) => void;
  setHotkeyConfig: (config: HotkeyConfig) => void;

  // Actions - Auth
  setAuthState: (authState: AuthState) => void;
  setDailyUsage: (usage: DailyUsage) => void;
  clearAuth: () => void;

  // Actions - History
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;

  // Actions - Unreal MCP
  setUnrealMCPStatus: (status: UnrealMCPStatus) => void;
  setUnrealMCPProjectInfo: (info: MCPProjectInfo | null) => void;

  // Actions - Engine Selection
  setSelectedEngine: (engine: SelectedEngine) => void;
  setEngineMCPStatus: (status: EngineMCPStatus) => void;
  setEngineSetupStatus: (status: EngineSetupStatus | null) => void;
  setEngineSetupOpen: (open: boolean) => void;

  // Agent Mode (guide vs action)
  agentMode: 'guide' | 'action';
  setAgentMode: (mode: 'guide' | 'action') => void;

  // Actions - Guided Step Mode
  enterGuidedMode: (steps: string[], sourceMessageId: string, goal?: string) => void;
  exitGuidedMode: () => void;
  setGuidedStep: (step: number) => void;
  setGuidedVerification: (text: string | null) => void;
  setGuidedModePending: (pending: boolean) => void;
  appendGuidedStep: (step: string) => void;
  markGuidedComplete: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial UI State
  isCollapsed: false,
  isPinned: true,
  activeView: 'chat',

  // Initial Connection State
  connectorStatus: 'disconnected',
  connectorClient: null,
  projectInfo: null,
  lastContextUpdate: null,
  currentContext: null,

  // Initial Chat State
  messages: [],
  isLoading: false,
  streamingResponse: '',
  attachedScreenshot: null,

  // Initial Thread State
  currentThreadId: null,
  currentThreadTitle: 'New Chat',
  currentThreadCreatedAt: Date.now(),
  memorySummary: null,
  summarizedUpTo: 0,
  threadList: [],

  // Initial Settings
  settings: null,
  hotkeyConfig: null,

  // Initial Auth
  authState: null,
  dailyUsage: null,

  // Initial History
  sessions: [],

  // Initial Unreal MCP
  unrealMCPStatus: 'disconnected',
  unrealMCPProjectInfo: null,

  // Initial Engine Selection
  selectedEngine: null,
  engineMCPStatus: 'disconnected',
  engineSetupStatus: null,
  isEngineSetupOpen: false,

  // Agent Mode
  agentMode: 'action',

  // Initial Guided Step Mode
  guidedSteps: null,
  guidedCurrentStep: 0,
  guidedVerification: null,
  guidedSourceMessageId: null,
  guidedModePending: false,
  guidedGoal: null,
  guidedIsComplete: false,

  // UI Actions
  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
  setPinned: (pinned) => set({ isPinned: pinned }),
  setActiveView: (view) => set({ activeView: view }),

  // Connection Actions
  setConnectorStatus: (status, client) =>
    set({
      connectorStatus: status,
      connectorClient: client,
      projectInfo: client?.projectInfo || null,
    }),

  setCurrentContext: (context) =>
    set({
      currentContext: context,
      lastContextUpdate: context.lastUpdate,
      projectInfo: context.projectInfo,
    }),

  // Chat Actions
  addMessage: (message) => {
    set((state) => {
      const isFirstUserMessage =
        message.role === 'user' && !state.messages.some((m) => m.role === 'user');
      const newTitle = isFirstUserMessage
        ? generateThreadTitle(message.content)
        : state.currentThreadTitle;

      let threadId = state.currentThreadId;
      if (!threadId) {
        threadId = uuidv4();
      }

      return {
        messages: [...state.messages, message],
        currentThreadId: threadId,
        currentThreadTitle: newTitle,
      };
    });
    debounceSaveThread(get);
  },

  updateLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      if (messages.length > 0) {
        messages[messages.length - 1] = {
          ...messages[messages.length - 1],
          content,
        };
      }
      return { messages };
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setStreamingResponse: (text) => set({ streamingResponse: text }),

  appendStreamingResponse: (chunk) =>
    set((state) => ({
      streamingResponse: state.streamingResponse + chunk,
    })),

  setAttachedScreenshot: (screenshot) => set({ attachedScreenshot: screenshot }),

  clearChat: () => {
    const state = get();
    // Persist current thread before clearing (if it has messages)
    if (state.currentThreadId && state.messages.length > 0) {
      const thread: ConversationThread = {
        id: state.currentThreadId,
        title: state.currentThreadTitle,
        messages: state.messages,
        memorySummary: state.memorySummary,
        summarizedUpTo: state.summarizedUpTo,
        createdAt: state.currentThreadCreatedAt,
        updatedAt: Date.now(),
        projectName: state.projectInfo?.project_name,
      };
      window.electronAPI?.threads?.save(thread);
    }

    const newId = uuidv4();
    set({
      messages: [],
      streamingResponse: '',
      attachedScreenshot: null,
      currentThreadId: newId,
      currentThreadTitle: 'New Chat',
      currentThreadCreatedAt: Date.now(),
      memorySummary: null,
      summarizedUpTo: 0,
      guidedSteps: null,
      guidedCurrentStep: 0,
      guidedVerification: null,
      guidedSourceMessageId: null,
      guidedModePending: false,
      guidedGoal: null,
      guidedIsComplete: false,
    });
    window.electronAPI?.threads?.setActive(newId);
  },

  // Thread Actions
  startNewThread: () => {
    const state = get();
    if (state.currentThreadId && state.messages.length > 0) {
      const thread: ConversationThread = {
        id: state.currentThreadId,
        title: state.currentThreadTitle,
        messages: state.messages,
        memorySummary: state.memorySummary,
        summarizedUpTo: state.summarizedUpTo,
        createdAt: state.currentThreadCreatedAt,
        updatedAt: Date.now(),
        projectName: state.projectInfo?.project_name,
      };
      window.electronAPI?.threads?.save(thread);
    }

    const newId = uuidv4();
    set({
      messages: [],
      streamingResponse: '',
      attachedScreenshot: null,
      currentThreadId: newId,
      currentThreadTitle: 'New Chat',
      currentThreadCreatedAt: Date.now(),
      memorySummary: null,
      summarizedUpTo: 0,
      guidedSteps: null,
      guidedCurrentStep: 0,
      guidedVerification: null,
      guidedSourceMessageId: null,
      guidedModePending: false,
      guidedGoal: null,
      guidedIsComplete: false,
    });
    window.electronAPI?.threads?.setActive(newId);
  },

  loadThread: (thread) => {
    set({
      messages: thread.messages,
      currentThreadId: thread.id,
      currentThreadTitle: thread.title,
      currentThreadCreatedAt: thread.createdAt,
      memorySummary: thread.memorySummary,
      summarizedUpTo: thread.summarizedUpTo,
      streamingResponse: '',
      attachedScreenshot: null,
    });
    window.electronAPI?.threads?.setActive(thread.id);
  },

  setCurrentThreadId: (id) => set({ currentThreadId: id }),
  setMemorySummary: (summary) => {
    set({ memorySummary: summary });
    debounceSaveThread(get);
  },
  setSummarizedUpTo: (index) => {
    set({ summarizedUpTo: index });
    debounceSaveThread(get);
  },
  setThreadList: (list) => set({ threadList: list }),

  // Settings Actions
  setSettings: (settings) => set({ settings }),
  setHotkeyConfig: (config) => set({ hotkeyConfig: config }),

  // Auth Actions
  setAuthState: (authState) => set({ authState }),
  setDailyUsage: (dailyUsage) => set({ dailyUsage }),
  clearAuth: () => set({ authState: null, dailyUsage: null }),

  // History Actions
  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions].slice(0, 100),
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),

  clearSessions: () => set({ sessions: [] }),

  // Unreal MCP Actions
  setUnrealMCPStatus: (status) => set({ unrealMCPStatus: status }),
  setUnrealMCPProjectInfo: (info) => set({ unrealMCPProjectInfo: info }),

  // Agent Mode Actions
  setAgentMode: (mode) => set({ agentMode: mode }),

  // Engine Selection Actions
  setSelectedEngine: (engine) => set({ selectedEngine: engine }),
  setEngineMCPStatus: (status) => set({ engineMCPStatus: status }),
  setEngineSetupStatus: (status) => set({ engineSetupStatus: status }),
  setEngineSetupOpen: (open) => set({ isEngineSetupOpen: open }),

  // Guided Step Mode Actions
  enterGuidedMode: (steps, sourceMessageId, goal) =>
    set({
      guidedSteps: [steps[0]],
      guidedCurrentStep: 0,
      guidedVerification: null,
      guidedSourceMessageId: sourceMessageId,
      guidedModePending: false,
      guidedGoal: goal ?? null,
      guidedIsComplete: false,
    }),

  exitGuidedMode: () =>
    set({
      guidedSteps: null,
      guidedCurrentStep: 0,
      guidedVerification: null,
      guidedSourceMessageId: null,
      guidedModePending: false,
      guidedGoal: null,
      guidedIsComplete: false,
    }),

  setGuidedStep: (step) => set({ guidedCurrentStep: step, guidedVerification: null }),

  setGuidedVerification: (text) => set({ guidedVerification: text }),

  setGuidedModePending: (pending) => set({ guidedModePending: pending }),

  appendGuidedStep: (step) =>
    set((state) => ({
      guidedSteps: [...(state.guidedSteps ?? []), step],
      guidedCurrentStep: (state.guidedSteps?.length ?? 0),
      guidedVerification: null,
    })),

  markGuidedComplete: () => set({ guidedIsComplete: true }),
}));

// Selectors
export const selectIsConnected = (state: AppState) => state.connectorStatus === 'connected';
export const selectHasContext = (state: AppState) => state.currentContext !== null;
export const selectProjectName = (state: AppState) => state.projectInfo?.project_name || null;
export const selectEngineVersion = (state: AppState) => state.projectInfo?.engine_version || null;
export const selectIsLoggedIn = (state: AppState) => state.authState?.isLoggedIn === true;
export const selectIsPro = (state: AppState) => state.authState?.entitlement?.active === true;
export const selectRemainingAsks = (state: AppState) => {
  if (!state.authState?.entitlement || state.authState.entitlement.features?.unlimited_asks) {
    return null; // unlimited
  }
  const limit = state.authState.entitlement.features?.daily_limit ?? 10;
  const used = state.dailyUsage?.askCount ?? 0;
  return Math.max(0, limit - used);
};
