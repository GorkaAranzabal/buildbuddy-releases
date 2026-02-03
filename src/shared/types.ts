// ===== Connector Event Types =====

export type EngineType = 'unreal' | 'unity' | 'godot';

export interface BaseEvent {
  type: string;
  engine: EngineType;
  timestamp: number;
}

export interface ProjectInfoEvent extends BaseEvent {
  type: 'project_info';
  project_name: string;
  engine_version: string;
  platform: 'Windows' | 'macOS' | 'Linux';
  target_platforms?: string[];
}

export type LogVerbosity = 'Fatal' | 'Error' | 'Warning' | 'Display' | 'Log' | 'Verbose';

export interface LogEntryEvent extends BaseEvent {
  type: 'log_entry';
  category: string;
  verbosity: LogVerbosity;
  message: string;
}

export type ErrorType = 'packaging' | 'compile' | 'runtime' | 'blueprint' | 'unknown';

export interface ErrorBlockEvent extends BaseEvent {
  type: 'error_block';
  error_type: ErrorType;
  raw_block: string;
  file_paths: string[];
  asset_paths: string[];
  line_numbers?: number[];
}

export interface ContextSnapshotEvent extends BaseEvent {
  type: 'context_snapshot';
  project_info: ProjectInfoEvent;
  recent_logs: LogEntryEvent[];
  last_error: ErrorBlockEvent | null;
}

export interface HeartbeatEvent extends BaseEvent {
  type: 'heartbeat';
  uptime_seconds: number;
}

export type ConnectorEvent =
  | ProjectInfoEvent
  | LogEntryEvent
  | ErrorBlockEvent
  | ContextSnapshotEvent
  | HeartbeatEvent;

// ===== Server -> Client Messages =====

export interface RequestSnapshotMessage {
  type: 'request_snapshot';
}

export interface ConnectionAckMessage {
  type: 'connection_ack';
  server_version: string;
}

export type ServerMessage = RequestSnapshotMessage | ConnectionAckMessage;

// ===== Connector Client =====

export interface ConnectorClient {
  id: string;
  engine: EngineType;
  connected: boolean;
  lastHeartbeat: number;
  projectInfo: ProjectInfoEvent | null;
}

// ===== Unreal Context =====

export interface UnrealContext {
  projectInfo: ProjectInfoEvent | null;
  recentLogs: LogEntryEvent[];
  lastError: ErrorBlockEvent | null;
  lastUpdate: number;
}

// ===== Screenshot Types =====

export type CaptureMode = 'fullscreen' | 'window' | 'region';

export interface CaptureResult {
  id: string;
  mode: CaptureMode;
  timestamp: number;
  imagePath: string;
  imageBase64: string;
  dimensions: { width: number; height: number };
  windowTitle?: string;
  // Display bounds for multi-monitor support
  displayBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // macOS display scale factor (e.g., 2 for Retina)
  scaleFactor?: number;
}

export interface RegionSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ===== AI Types =====

export type AIProvider = 'openai' | 'anthropic';
export type AssistantMode = 'packaging' | 'blueprint' | 'performance' | 'general';

export interface AIRequest {
  prompt: string;
  context: UnrealContext | null;
  screenshot: CaptureResult | null;
  mode: AssistantMode;
}

export interface CodeSnippet {
  language: 'cpp' | 'blueprint' | 'ini' | 'json';
  code: string;
  description: string;
}

export interface AIResponse {
  id: string;
  diagnosis: string[];
  fixSteps: string[];
  nextDebugSteps: string[];
  codeSnippets?: CodeSnippet[];
  raw: string;
}

// ===== Chat Types =====

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachedContext?: UnrealContext;
  attachedScreenshot?: {
    id: string;
    thumbnailPath: string;
  };
  parsed?: {
    diagnosis: string[];
    fixSteps: string[];
    nextDebugSteps: string[];
    codeSnippets: CodeSnippet[];
  };
}

// ===== Session Types =====

export interface Session {
  id: string;
  timestamp: number;
  prompt: string;
  response: AIResponse;
  context: UnrealContext | null;
  screenshotPath: string | null;
}

// ===== Settings Types =====

export interface HotkeyConfig {
  toggleOverlay: string;
  captureFullScreen: string;
  captureWindow: string;
  captureRegion: string;
  quickAsk: string;
}

export interface UserSettings {
  // AI Configuration
  aiProvider: AIProvider;
  apiKey: string;
  preferredModel: string;

  // Privacy
  screenshotCaptureEnabled: boolean;
  sendLogsEnabled: boolean;
  localOnlyMode: boolean;

  // UI
  theme: 'system' | 'light' | 'dark';
  defaultPinned: boolean;
  startMinimized: boolean;

  // Behavior
  autoConnectUnreal: boolean;
  maxContextLines: number;
  maxContextSize: number;
}

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isCollapsed: boolean;
  isPinned: boolean;
}

// ===== Storage Schema =====

export interface StorageSchema {
  sessions: Session[];
  settings: UserSettings;
  hotkeyConfig: HotkeyConfig;
  windowState: WindowState;
}

// ===== Connection Status =====

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

// ===== Agent Action Types =====

export type AgentAction =
  | { type: 'focus_window'; titleIncludes: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click'; x: number; y: number }
  | { type: 'click_element'; description: string; elementType?: string } // NEW: Click UI element by description
  | { type: 'type_text'; text: string }
  | { type: 'key_press'; keys: string }
  | { type: 'wait'; ms: number }
  | { type: 'done'; reason: string };

export interface ActionPlan {
  goal: string;
  assumptions: string[];
  actions: AgentAction[];
  safety_notes: string[];
  requires_user_confirmation: boolean;
}

export interface ActionPlanRequest {
  conversationContext: string;
  lastUserRequest: string;
  screenshot: CaptureResult | null;
}

export type ExecutionStatus = 'idle' | 'planning' | 'previewing' | 'running' | 'stopped' | 'completed' | 'error';

export interface ExecutionProgress {
  status: ExecutionStatus;
  currentStep: number;
  totalSteps: number;
  currentAction: AgentAction | null;
  error?: string;
  completedActions: string[];
}

// ===== IPC Types =====

export interface IPCChannels {
  // Window
  'window:toggle': void;
  'window:collapse': boolean;
  'window:pin': boolean;
  'window:get-state': void;
  'window:state': WindowState;

  // Capture
  'capture:fullscreen': void;
  'capture:window': string;
  'capture:region': void;
  'capture:result': CaptureResult;
  'capture:get-windows': void;
  'capture:windows-list': Array<{ id: string; name: string; thumbnail: string }>;

  // Connector
  'connector:status': { status: ConnectionStatus; client: ConnectorClient | null };
  'connector:context': UnrealContext;

  // AI
  'ai:ask': AIRequest;
  'ai:stream': string;
  'ai:complete': AIResponse;
  'ai:error': { message: string };

  // Storage
  'storage:save-session': Session;
  'storage:get-sessions': number;
  'storage:sessions': Session[];
  'storage:delete-session': string;
  'storage:clear-sessions': void;

  // Settings
  'settings:get': void;
  'settings:update': Partial<UserSettings>;
  'settings:data': UserSettings;
  'settings:get-hotkeys': void;
  'settings:update-hotkeys': Partial<HotkeyConfig>;
  'settings:hotkeys': HotkeyConfig;

  // Agent Actions
  'agent:request-plan': ActionPlanRequest;
  'agent:plan-result': ActionPlan | { error: string };
  'agent:execute': AgentAction[];
  'agent:stop': void;
  'agent:progress': ExecutionProgress;
  'agent:check-permissions': void;
  'agent:permissions-result': { hasPermission: boolean; platform: string };
}
