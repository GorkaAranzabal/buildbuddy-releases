import { create } from 'zustand';
import type {
  AuthState,
  CaptureResult,
  ChatMessage,
  ConnectionStatus,
  ConnectorClient,
  DailyUsage,
  HotkeyConfig,
  MCPProjectInfo,
  ProjectInfoEvent,
  Session,
  UnrealContext,
  UnrealMCPStatus,
  UserSettings,
} from '../../shared/types';

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
}

export const useAppStore = create<AppState>((set) => ({
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
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

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

  clearChat: () =>
    set({
      messages: [],
      streamingResponse: '',
      attachedScreenshot: null,
    }),

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
      sessions: [session, ...state.sessions].slice(0, 100), // Keep max 100
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),

  clearSessions: () => set({ sessions: [] }),

  // Unreal MCP Actions
  setUnrealMCPStatus: (status) => set({ unrealMCPStatus: status }),
  setUnrealMCPProjectInfo: (info) => set({ unrealMCPProjectInfo: info }),
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
