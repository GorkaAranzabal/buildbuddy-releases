// ===== Connector Event Types =====

export type EngineType = 'unreal' | 'unity' | 'godot';

// ===== Engine Selection (UI-level, separate from EngineType connector type) =====

export type SelectedEngine = 'unreal' | 'uefn' | 'godot' | 'unity' | 'blender' | 'roblox' | null;

export type EngineMCPStatus = 'disconnected' | 'starting' | 'connected' | 'error';

export interface EngineSetupStep {
  n: number;
  title: string;
  desc: string;
  isAutomatic: boolean;
  warn?: string;
}

export interface EngineSetupStatus {
  engine: SelectedEngine;
  stepsComplete: boolean;
  pendingSteps: EngineSetupStep[];
  error?: string;
}

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

// ===== Unreal Engine Commands =====

export interface UECommand {
  type: 'command';
  id: string;
  command: string;
  params: Record<string, unknown>;
}

export interface UECommandResult {
  type: 'command_result';
  command_id: string;
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
}

// Available UE commands
export type UECommandType =
  // Blueprint
  | 'create_blueprint'
  | 'open_blueprint'
  | 'add_component_to_blueprint'
  | 'add_variable_to_blueprint'
  | 'compile_blueprint'
  // C++
  | 'create_cpp_class'
  | 'open_source_file'
  // Level
  | 'spawn_actor'
  | 'delete_actor'
  | 'get_level_actors'
  | 'select_actor'
  // Assets
  | 'get_assets'
  | 'browse_to_asset'
  | 'import_asset'
  | 'delete_asset'
  // Editor
  | 'play_in_editor'
  | 'stop_play_in_editor'
  | 'save_all'
  | 'compile_project'
  | 'get_project_info'
  | 'execute_console_command';

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

export interface ClickTarget {
  xRatio: number;      // normalized x position: 0.0 (left edge) to 1.0 (right edge)
  yRatio: number;      // normalized y position: 0.0 (top edge) to 1.0 (bottom edge)
  confidence: number;  // 0.0 – 1.0
  description?: string;
}

// ===== Doc Image Types =====

export interface DocImage {
  imageUrl: string;
  pageUrl: string;
  pageTitle: string;
  altText: string;
}

// ===== AI Types =====

export type AIProvider = 'openai' | 'anthropic';
export type AssistantMode = 'packaging' | 'blueprint' | 'performance' | 'general';

export interface AIRequest {
  prompt: string;
  context: UnrealContext | null;
  screenshot: CaptureResult | null;
  mode: AssistantMode;
  agentMode?: 'guide' | 'action';
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  memorySummary?: string;
  projectContext?: string;
  editorSnapshot?: string;
  mcpConnected?: boolean;
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
  docImages?: Record<string, DocImage[]>;
  isOrder?: boolean;
}

// ===== Conversation Thread Types =====

export interface ConversationThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  memorySummary: string | null;
  summarizedUpTo: number;
  createdAt: number;
  updatedAt: number;
  projectName?: string;
}

export interface ThreadListItem {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
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
  quickVoice: string;
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

  // UE Project
  ueProjectPath?: string;

  // Unreal MCP
  unrealMCPEnabled: boolean;
  unrealEnginePath: string;

  // Developer
  devMode?: boolean;

  // Engine Selection
  selectedEngine?: SelectedEngine;
  godotProjectPath?: string;
  unityProjectPath?: string;
  uefnEnginePath?: string;
  uefnProjectPath?: string;
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
  threads: ConversationThread[];
  activeThreadId: string | null;
  settings: UserSettings;
  hotkeyConfig: HotkeyConfig;
  windowState: WindowState;
  authEmail: string | null;
  dailyUsage: DailyUsage;
  projectAnalysis?: UEProjectAnalysis;
  fairUseState?: FairUseState;
  proxySessionToken?: string;
  proxyTokenExpiresAt?: number;
}

// ===== UE Project Analysis =====

export interface UEProjectAnalysis {
  projectName: string;
  engineVersion: string;
  uprojectPath: string;
  plugins: Array<{ name: string; enabled: boolean }>;
  modules: Array<{ name: string; type: string }>;
  contentStats: {
    totalAssets: number;
    totalMaps: number;
    byCategory: Record<string, number>;
  };
  sourceModules: string[];
  configSummary: {
    defaultMap?: string;
    projectVersion?: string;
    gameMode?: string;
  };
  analyzedAt: number;
}

// ===== Connection Status =====

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';

// ===== Unreal MCP Types =====

export type UnrealMCPStatus = 'disconnected' | 'starting' | 'connected' | 'error';

export interface MCPProjectInfo {
  projectName: string;
  engineVersion: string;
  projectPath: string;
  platform?: string;
}

export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
}

// ===== Agent Action Types =====

export type AgentAction =
  | { type: 'focus_window'; titleIncludes: string }
  | { type: 'click'; x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'right_click'; x: number; y: number }
  | { type: 'click_element'; description: string; elementType?: string }
  | { type: 'type_text'; text: string }
  | { type: 'key_press'; keys: string }
  | { type: 'wait'; ms: number }
  | { type: 'done'; reason: string }
  // Unreal Engine specific actions
  | { type: 'ue_command'; command: UECommandType; params: Record<string, unknown> };

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

// ===== Entitlement Types =====

export interface EntitlementFeatures {
  unlimited_asks: boolean;
  faster_responses: boolean;
  best_model: boolean;
  daily_limit?: number;
}

export interface EntitlementData {
  active: boolean;
  plan: 'free' | 'pro';
  status?: string;
  email: string;
  features: EntitlementFeatures;
}

export interface AuthState {
  email: string | null;
  entitlement: EntitlementData | null;
  isLoggedIn: boolean;
}

export interface DailyUsage {
  date: string;    // "YYYY-MM-DD"
  askCount: number;
}

export interface FairUseState {
  chatTimestamps: number[];    // Unix ms — sliding window for chat requests
  rcTimestamps: number[];      // Unix ms — sliding window for remote-control requests
  timeoutUntil: number | null; // Unix ms when current timeout expires; null = not timed out
  violations: number[];        // Unix ms of each violation (for escalation)
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
  'ai:error': { message: string; type?: string; unlockedAt?: number };

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

  // Auth / Entitlements
  'auth:login': string;
  'auth:logout': void;
  'auth:get-state': void;
  'auth:check-can-ask': void;
  'auth:record-ask': void;
  'auth:get-usage': void;

  // Threads
  'threads:save': ConversationThread;
  'threads:get': string;
  'threads:list': number | undefined;
  'threads:delete': string;
  'threads:set-active': string | null;
  'threads:get-active': void;

  // AI Summarize
  'ai:summarize': { messages: Array<{ role: string; content: string }>; existingSummary?: string };

  // Agent Actions
  'agent:request-plan': ActionPlanRequest;
  'agent:plan-result': ActionPlan | { error: string };
  'agent:execute': AgentAction[];
  'agent:stop': void;
  'agent:progress': ExecutionProgress;
  'agent:check-permissions': void;
  'agent:permissions-result': { hasPermission: boolean; platform: string };
}
