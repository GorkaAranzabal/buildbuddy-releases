# Technical Design Document — Gorka Copilot Overlay

**Version:** 1.0  
**Last Updated:** January 28, 2026  
**Status:** Draft  
**Related Documents:** [PRD](./prd.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Component Design](#4-component-design)
5. [Data Models & Schemas](#5-data-models--schemas)
6. [API Specifications](#6-api-specifications)
7. [UI/UX Technical Design](#7-uiux-technical-design)
8. [Security & Privacy](#8-security--privacy)
9. [Performance Considerations](#9-performance-considerations)
10. [Testing Strategy](#10-testing-strategy)
11. [Deployment & Distribution](#11-deployment--distribution)
12. [Risk Assessment](#12-risk-assessment)

---

## 1. Overview

### 1.1 Purpose

This Technical Design Document outlines the architecture, components, and implementation details for the Gorka Copilot Overlay—a desktop overlay assistant for Unreal Engine developers that provides contextual AI-powered help.

### 1.2 Scope

The MVP includes:
- Desktop overlay application (Electron)
- Unreal Engine connector plugin (C++)
- AI assistant integration layer
- On-demand screenshot capture system
- Local session storage

### 1.3 System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Desktop                               │
│  ┌──────────────────┐        ┌──────────────────────────────────┐  │
│  │  Unreal Engine   │        │    Gorka Copilot Overlay         │  │
│  │  ┌────────────┐  │        │  ┌────────────────────────────┐  │  │
│  │  │ Connector  │◄─┼──WS───►│  │   WebSocket Server        │  │  │
│  │  │  Plugin    │  │        │  └────────────────────────────┘  │  │
│  │  └────────────┘  │        │  ┌────────────────────────────┐  │  │
│  │                  │        │  │   Overlay UI (React)       │  │  │
│  └──────────────────┘        │  └────────────────────────────┘  │  │
│                              │  ┌────────────────────────────┐  │  │
│                              │  │   AI Service Client        │──┼──┼──► AI API
│                              │  └────────────────────────────┘  │  │
│                              └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

The system follows a modular, event-driven architecture with three main components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GORKA COPILOT OVERLAY                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ELECTRON MAIN PROCESS                             │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │   │
│  │  │  Window     │ │  WebSocket  │ │  Screenshot │ │   Storage    │  │   │
│  │  │  Manager    │ │  Server     │ │  Service    │ │   Service    │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └──────────────┘  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                   │   │
│  │  │  Hotkey     │ │  AI Client  │ │   IPC       │                   │   │
│  │  │  Manager    │ │  Service    │ │   Bridge    │                   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │ IPC                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    ELECTRON RENDERER PROCESS                         │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │                    REACT APPLICATION                         │   │   │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │   │   │
│  │  │  │  Chat View  │ │  Context    │ │  Settings Panel     │   │   │   │
│  │  │  │  Component  │ │  Chips      │ │                     │   │   │   │
│  │  │  └─────────────┘ └─────────────┘ └─────────────────────┘   │   │   │
│  │  │  ┌─────────────────────────────────────────────────────┐   │   │   │
│  │  │  │              State Management (Zustand)              │   │   │   │
│  │  │  └─────────────────────────────────────────────────────┘   │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    UNREAL ENGINE CONNECTOR PLUGIN                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────────┐          │
│  │  Log        │ │  Error      │ │  WebSocket  │ │   Config     │          │
│  │  Listener   │ │  Parser     │ │  Client     │ │   Manager    │          │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Separation of Concerns** | Main process handles system interactions; renderer handles UI |
| **Event-Driven** | WebSocket events trigger state updates via IPC |
| **Privacy-First** | All data stays local unless explicitly sent to AI |
| **Graceful Degradation** | Works without Unreal connection (manual mode) |
| **Extensibility** | Connector protocol designed for multi-engine support |

---

## 3. Technology Stack

### 3.1 Desktop Application

| Layer | Technology | Version | Justification |
|-------|------------|---------|---------------|
| Runtime | Electron | 28.x | Cross-platform desktop, native APIs |
| Language | TypeScript | 5.x | Type safety, better DX |
| UI Framework | React | 18.x | Component-based, ecosystem |
| Styling | Tailwind CSS | 3.x | Rapid prototyping, utility-first |
| State Management | Zustand | 4.x | Lightweight, simple API |
| WebSocket | ws | 8.x | Native WebSocket server |
| Storage | lowdb / JSON | 6.x | Simple file-based persistence |
| Build Tool | Vite | 5.x | Fast HMR, modern bundling |
| Packaging | electron-builder | 24.x | Cross-platform installers |

### 3.2 Unreal Engine Plugin

| Component | Technology | Version |
|-----------|------------|---------|
| Language | C++ | C++17 |
| Engine | Unreal Engine | 5.3+ |
| WebSocket | libwebsockets / IWebSocket | Built-in |
| JSON | FJsonObject | Built-in |

### 3.3 AI Integration

| Component | Technology | Notes |
|-----------|------------|-------|
| Provider | OpenAI / Anthropic | Configurable |
| Text Model | GPT-4 / Claude 3 | Primary reasoning |
| Vision Model | GPT-4V / Claude 3 | Screenshot analysis |
| SDK | Official SDKs | TypeScript clients |

---

## 4. Component Design

### 4.1 Desktop Application — Main Process

#### 4.1.1 Window Manager (`src/main/windowManager.ts`)

Responsible for overlay window lifecycle and behavior.

```typescript
interface WindowConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  x?: number;
  y?: number;
  alwaysOnTop: boolean;
  transparent: boolean;
  frame: boolean;
  resizable: boolean;
  skipTaskbar: boolean;
}

class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private isCollapsed: boolean = false;
  
  // Window dimensions
  private readonly COLLAPSED_SIZE = { width: 60, height: 60 };
  private readonly EXPANDED_SIZE = { width: 400, height: 600 };
  
  createMainWindow(): BrowserWindow;
  toggleVisibility(): void;
  toggleCollapsed(): void;
  setAlwaysOnTop(value: boolean): void;
  savePosition(): void;
  restorePosition(): void;
}
```

**Key Behaviors:**
- Overlay renders as frameless, transparent window
- Always-on-top by default (toggleable)
- Position persisted between sessions
- Collapsed mode shows only handle/icon
- Click-through for transparent areas

#### 4.1.2 WebSocket Server (`src/main/services/websocketServer.ts`)

Manages connections from engine connectors.

```typescript
interface ConnectorClient {
  id: string;
  engine: 'unreal' | 'unity' | 'godot';
  connected: boolean;
  lastHeartbeat: number;
  projectInfo: ProjectInfo | null;
}

class WebSocketServer {
  private server: WebSocket.Server;
  private clients: Map<string, ConnectorClient> = new Map();
  private port: number = 9876; // Configurable
  
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: ConnectorEvent): void;
  getConnectedClients(): ConnectorClient[];
  
  // Event handlers
  onConnection(ws: WebSocket): void;
  onMessage(clientId: string, data: string): void;
  onClose(clientId: string): void;
}
```

**Protocol:**
- Server listens on `ws://127.0.0.1:9876`
- Supports multiple simultaneous connectors
- Heartbeat every 5 seconds
- Auto-reconnection handled by clients

#### 4.1.3 Screenshot Service (`src/main/services/screenshotService.ts`)

Handles screen capture functionality.

```typescript
type CaptureMode = 'fullscreen' | 'window' | 'region';

interface CaptureResult {
  id: string;
  mode: CaptureMode;
  timestamp: number;
  imagePath: string;
  imageBase64: string;
  dimensions: { width: number; height: number };
  windowTitle?: string;
}

interface RegionSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

class ScreenshotService {
  private tempDir: string;
  
  captureFullScreen(): Promise<CaptureResult>;
  captureWindow(windowId: string): Promise<CaptureResult>;
  captureRegion(): Promise<CaptureResult>;
  
  // Region capture flow
  showRegionSelector(): Promise<RegionSelection>;
  cropImage(image: NativeImage, region: RegionSelection): NativeImage;
  
  // Window enumeration
  getAvailableWindows(): Promise<DesktopCapturerSource[]>;
  
  // Cleanup
  clearTempFiles(): void;
}
```

**Implementation Notes:**
- Uses Electron's `desktopCapturer` API
- Region capture shows fullscreen transparent overlay
- macOS requires Screen Recording permission
- Images stored temporarily, cleared on app close

#### 4.1.4 Hotkey Manager (`src/main/services/hotkeyManager.ts`)

Global hotkey registration and handling.

```typescript
interface HotkeyConfig {
  toggleOverlay: string;      // Default: 'CommandOrControl+Shift+G'
  captureFullScreen: string;  // Default: 'CommandOrControl+Shift+1'
  captureWindow: string;      // Default: 'CommandOrControl+Shift+2'
  captureRegion: string;      // Default: 'CommandOrControl+Shift+3'
  quickAsk: string;           // Default: 'CommandOrControl+Shift+A'
}

class HotkeyManager {
  private config: HotkeyConfig;
  private registeredHotkeys: string[] = [];
  
  registerAll(): void;
  unregisterAll(): void;
  updateHotkey(action: keyof HotkeyConfig, accelerator: string): boolean;
  getConfig(): HotkeyConfig;
}
```

#### 4.1.5 AI Client Service (`src/main/services/aiClient.ts`)

Manages AI model interactions.

```typescript
interface AIRequest {
  prompt: string;
  context: UnrealContext | null;
  screenshot: CaptureResult | null;
  mode: 'packaging' | 'blueprint' | 'performance' | 'general';
}

interface AIResponse {
  id: string;
  diagnosis: string[];
  fixSteps: string[];
  nextDebugSteps: string[];
  codeSnippets?: CodeSnippet[];
  raw: string;
}

interface CodeSnippet {
  language: 'cpp' | 'blueprint' | 'ini' | 'json';
  code: string;
  description: string;
}

class AIClientService {
  private apiKey: string;
  private provider: 'openai' | 'anthropic';
  
  async ask(request: AIRequest): AsyncGenerator<string, AIResponse>;
  
  // Context preparation
  private buildSystemPrompt(): string;
  private prepareContext(context: UnrealContext): string;
  private truncateLogs(logs: LogEntry[], maxSize: number): LogEntry[];
  
  // Cost control
  private estimateTokens(text: string): number;
  private shouldUseVision(screenshot: CaptureResult | null): boolean;
}
```

**System Prompt Structure:**
```typescript
const SYSTEM_PROMPT = `You are an expert Unreal Engine technical assistant.

You receive:
- User's question or problem description
- Unreal Engine log excerpts (when available)
- Error blocks from compile/packaging/runtime
- Optional screenshot of the editor

Your response MUST include these sections:

## Diagnosis
- [1-3 bullet points identifying the root cause]

## Fix Steps
1. [Numbered, specific steps to resolve]
2. [Include exact click paths in Unreal Editor when relevant]
3. [Reference specific menu items, settings, or files]

## If Still Broken
- [Next debugging steps if the fix doesn't work]
- [Additional logs or info to gather]

## Code (only if needed)
\`\`\`cpp
// Minimal, targeted code snippets
\`\`\`

Rules:
- Never suggest destructive actions without warning
- Prefer Unreal best practices (interfaces > casts, avoid tick abuse)
- Be specific to the user's UE version when known
- Reference official documentation when helpful`;
```

#### 4.1.6 Storage Service (`src/main/services/storageService.ts`)

Local data persistence.

```typescript
interface Session {
  id: string;
  timestamp: number;
  prompt: string;
  response: AIResponse;
  context: UnrealContext | null;
  screenshotPath: string | null;
}

interface StorageSchema {
  sessions: Session[];
  settings: UserSettings;
  hotkeyConfig: HotkeyConfig;
  windowState: WindowState;
}

class StorageService {
  private db: Low<StorageSchema>;
  private dataPath: string;
  private maxSessions: number = 100;
  
  async initialize(): Promise<void>;
  
  // Sessions
  async saveSession(session: Session): Promise<void>;
  async getSessions(limit?: number): Promise<Session[]>;
  async getSession(id: string): Promise<Session | null>;
  async deleteSession(id: string): Promise<void>;
  async clearAllSessions(): Promise<void>;
  
  // Settings
  async getSettings(): Promise<UserSettings>;
  async updateSettings(settings: Partial<UserSettings>): Promise<void>;
  
  // Export
  async exportSession(id: string, format: 'json' | 'markdown'): Promise<string>;
}
```

**Storage Location:**
- macOS: `~/Library/Application Support/GorkaCopilot/`
- Windows: `%APPDATA%/GorkaCopilot/`

### 4.2 Desktop Application — Renderer Process

#### 4.2.1 Application State (`src/renderer/store/index.ts`)

```typescript
interface AppState {
  // UI State
  isCollapsed: boolean;
  isPinned: boolean;
  activeView: 'chat' | 'history' | 'settings';
  
  // Connection State
  connectorStatus: 'connected' | 'disconnected' | 'connecting';
  projectInfo: ProjectInfo | null;
  lastContextUpdate: number | null;
  
  // Chat State
  messages: ChatMessage[];
  isLoading: boolean;
  streamingResponse: string;
  currentContext: UnrealContext | null;
  attachedScreenshot: CaptureResult | null;
  
  // Actions
  setCollapsed: (collapsed: boolean) => void;
  setPinned: (pinned: boolean) => void;
  setActiveView: (view: 'chat' | 'history' | 'settings') => void;
  addMessage: (message: ChatMessage) => void;
  setStreamingResponse: (text: string) => void;
  setAttachedScreenshot: (screenshot: CaptureResult | null) => void;
  clearChat: () => void;
}
```

#### 4.2.2 Component Structure

```
src/renderer/
├── App.tsx
├── components/
│   ├── layout/
│   │   ├── Overlay.tsx           # Main container, drag handle
│   │   ├── CollapsedView.tsx     # Minimized state (icon only)
│   │   ├── ExpandedView.tsx      # Full chat interface
│   │   └── TitleBar.tsx          # Custom title bar with controls
│   ├── chat/
│   │   ├── ChatView.tsx          # Message list + input
│   │   ├── MessageBubble.tsx     # Individual message
│   │   ├── StreamingMessage.tsx  # Live response rendering
│   │   ├── InputArea.tsx         # Text input + action buttons
│   │   └── ContextChips.tsx      # Engine status indicators
│   ├── capture/
│   │   ├── CaptureButton.tsx     # Dropdown for capture modes
│   │   ├── ScreenshotPreview.tsx # Thumbnail preview
│   │   └── RegionSelector.tsx    # Snipping overlay
│   ├── history/
│   │   ├── HistoryView.tsx       # Session list
│   │   ├── SessionCard.tsx       # Session preview
│   │   └── SessionDetail.tsx     # Full session view
│   ├── settings/
│   │   ├── SettingsView.tsx      # Settings container
│   │   ├── HotkeySettings.tsx    # Hotkey configuration
│   │   ├── PrivacySettings.tsx   # Privacy toggles
│   │   └── AISettings.tsx        # API key, model selection
│   └── common/
│       ├── Button.tsx
│       ├── IconButton.tsx
│       ├── Tooltip.tsx
│       └── StatusIndicator.tsx
├── hooks/
│   ├── useIPC.ts                 # IPC communication
│   ├── useHotkeys.ts             # In-app hotkey handling
│   └── useTheme.ts               # Dark/light mode
├── store/
│   └── index.ts                  # Zustand store
└── utils/
    ├── markdown.ts               # Response formatting
    └── export.ts                 # Copy/export helpers
```

#### 4.2.3 Key Component Designs

**Overlay Container (`Overlay.tsx`)**
```typescript
interface OverlayProps {
  children: React.ReactNode;
}

// Features:
// - Frameless window with custom drag region
// - Resize handles on edges
// - Smooth collapse/expand animation
// - Click-through for transparent areas
```

**Chat Input Area (`InputArea.tsx`)**
```typescript
interface InputAreaProps {
  onSend: (prompt: string) => void;
  onCapture: (mode: CaptureMode) => void;
  isLoading: boolean;
  attachedScreenshot: CaptureResult | null;
}

// Features:
// - Auto-expanding textarea
// - Send button (disabled while loading)
// - Capture dropdown (Full/Window/Region)
// - Screenshot preview with remove button
// - Keyboard shortcuts (Enter to send, Shift+Enter for newline)
```

**Context Chips (`ContextChips.tsx`)**
```typescript
interface ContextChipsProps {
  status: 'connected' | 'disconnected' | 'connecting';
  projectInfo: ProjectInfo | null;
  lastUpdate: number | null;
}

// Displays:
// - Engine icon + name (Unreal)
// - Connection status (green/red dot)
// - Project name (if connected)
// - Engine version (if connected)
// - "Updated Xs ago" timestamp
```

### 4.3 Unreal Engine Connector Plugin

#### 4.3.1 Module Structure

```
GorkaCopilotConnector/
├── GorkaCopilotConnector.uplugin
├── Source/
│   └── GorkaCopilotConnector/
│       ├── GorkaCopilotConnector.Build.cs
│       ├── Public/
│       │   ├── GorkaCopilotConnector.h
│       │   ├── GorkaCopilotSettings.h
│       │   ├── LogCapture.h
│       │   ├── ErrorParser.h
│       │   └── WebSocketClient.h
│       └── Private/
│           ├── GorkaCopilotConnector.cpp
│           ├── GorkaCopilotSettings.cpp
│           ├── LogCapture.cpp
│           ├── ErrorParser.cpp
│           └── WebSocketClient.cpp
└── Config/
    └── DefaultGorkaCopilot.ini
```

#### 4.3.2 Core Classes

**Log Capture (`LogCapture.h`)**
```cpp
UCLASS()
class GORKACOPILOTCONNECTOR_API ULogCapture : public UObject
{
    GENERATED_BODY()
    
public:
    void Initialize();
    void Shutdown();
    
    // Get recent log buffer
    TArray<FLogEntry> GetRecentLogs(int32 Count = 200) const;
    
    // Get last error block
    FErrorBlock GetLastError() const;
    
private:
    // Custom output device to intercept logs
    class FGorkaOutputDevice : public FOutputDevice
    {
        virtual void Serialize(const TCHAR* Message, ELogVerbosity::Type Verbosity, 
                              const FName& Category) override;
    };
    
    TSharedPtr<FGorkaOutputDevice> OutputDevice;
    TCircularBuffer<FLogEntry> LogBuffer;
    FCriticalSection BufferLock;
    
    static const int32 MAX_BUFFER_SIZE = 1000;
};
```

**Error Parser (`ErrorParser.h`)**
```cpp
UENUM(BlueprintType)
enum class EErrorType : uint8
{
    Packaging,
    Compile,
    Runtime,
    Blueprint,
    Unknown
};

USTRUCT(BlueprintType)
struct FErrorBlock
{
    GENERATED_BODY()
    
    UPROPERTY()
    EErrorType Type;
    
    UPROPERTY()
    FString RawBlock;
    
    UPROPERTY()
    TArray<FString> FilePaths;
    
    UPROPERTY()
    TArray<FString> AssetPaths;
    
    UPROPERTY()
    FDateTime Timestamp;
};

UCLASS()
class GORKACOPILOTCONNECTOR_API UErrorParser : public UObject
{
    GENERATED_BODY()
    
public:
    // Parse log line and detect error blocks
    bool ProcessLogLine(const FLogEntry& Entry);
    
    // Get parsed error blocks
    TArray<FErrorBlock> GetErrorBlocks() const;
    FErrorBlock GetLastErrorBlock() const;
    
private:
    EErrorType ClassifyError(const FString& Message);
    void ExtractFilePaths(const FString& Block, TArray<FString>& OutPaths);
    void ExtractAssetPaths(const FString& Block, TArray<FString>& OutPaths);
    
    TArray<FErrorBlock> ErrorBlocks;
    bool bInErrorBlock = false;
    FString CurrentBlockAccumulator;
};
```

**WebSocket Client (`WebSocketClient.h`)**
```cpp
DECLARE_MULTICAST_DELEGATE_OneParam(FOnConnected, bool);
DECLARE_MULTICAST_DELEGATE_OneParam(FOnMessageReceived, const FString&);

UCLASS()
class GORKACOPILOTCONNECTOR_API UWebSocketClient : public UObject
{
    GENERATED_BODY()
    
public:
    void Initialize(const FString& ServerUrl);
    void Shutdown();
    
    void Connect();
    void Disconnect();
    bool IsConnected() const;
    
    void SendEvent(const FString& EventJson);
    
    // Events
    FOnConnected OnConnected;
    FOnMessageReceived OnMessageReceived;
    
private:
    TSharedPtr<IWebSocket> WebSocket;
    FString ServerUrl;
    FTimerHandle ReconnectTimer;
    FTimerHandle HeartbeatTimer;
    
    int32 ReconnectAttempts = 0;
    static const int32 MAX_RECONNECT_ATTEMPTS = 10;
    static const float HEARTBEAT_INTERVAL = 5.0f;
    
    void OnWebSocketConnected();
    void OnWebSocketConnectionError(const FString& Error);
    void OnWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
    void OnWebSocketMessage(const FString& Message);
    
    void ScheduleReconnect();
    void SendHeartbeat();
};
```

#### 4.3.3 Plugin Settings

```cpp
UCLASS(Config=GorkaCopilot, DefaultConfig)
class GORKACOPILOTCONNECTOR_API UGorkaCopilotSettings : public UDeveloperSettings
{
    GENERATED_BODY()
    
public:
    UGorkaCopilotSettings();
    
    // Server configuration
    UPROPERTY(Config, EditAnywhere, Category="Connection")
    FString ServerHost = TEXT("127.0.0.1");
    
    UPROPERTY(Config, EditAnywhere, Category="Connection")
    int32 ServerPort = 9876;
    
    UPROPERTY(Config, EditAnywhere, Category="Connection")
    bool bAutoConnect = true;
    
    // Log capture settings
    UPROPERTY(Config, EditAnywhere, Category="Logging")
    int32 LogBufferSize = 200;
    
    UPROPERTY(Config, EditAnywhere, Category="Logging")
    bool bCaptureWarnings = true;
    
    UPROPERTY(Config, EditAnywhere, Category="Logging")
    bool bCaptureVerbose = false;
    
    // Category name for settings UI
    virtual FName GetCategoryName() const override { return TEXT("Plugins"); }
};
```

---

## 5. Data Models & Schemas

### 5.1 Connector Event Schema (JSON)

All events follow this base structure:

```typescript
interface BaseEvent {
  type: string;
  engine: 'unreal' | 'unity' | 'godot';
  timestamp: number; // Unix timestamp ms
}
```

#### 5.1.1 Project Info Event

```typescript
interface ProjectInfoEvent extends BaseEvent {
  type: 'project_info';
  project_name: string;
  engine_version: string;
  platform: 'Windows' | 'macOS' | 'Linux';
  target_platforms: string[];
}

// Example:
{
  "type": "project_info",
  "engine": "unreal",
  "project_name": "MyAwesomeGame",
  "engine_version": "5.4.1",
  "platform": "macOS",
  "target_platforms": ["Windows", "macOS"],
  "timestamp": 1738108800000
}
```

#### 5.1.2 Log Entry Event

```typescript
interface LogEntryEvent extends BaseEvent {
  type: 'log_entry';
  category: string;
  verbosity: 'Fatal' | 'Error' | 'Warning' | 'Display' | 'Log' | 'Verbose';
  message: string;
}

// Example:
{
  "type": "log_entry",
  "engine": "unreal",
  "category": "LogTemp",
  "verbosity": "Error",
  "message": "Error: Cannot find file 'MyBlueprint.uasset'",
  "timestamp": 1738108800000
}
```

#### 5.1.3 Error Block Event

```typescript
interface ErrorBlockEvent extends BaseEvent {
  type: 'error_block';
  error_type: 'packaging' | 'compile' | 'runtime' | 'blueprint' | 'unknown';
  raw_block: string;
  file_paths: string[];
  asset_paths: string[];
  line_numbers?: number[];
}

// Example:
{
  "type": "error_block",
  "engine": "unreal",
  "error_type": "compile",
  "raw_block": "MyActor.cpp(42): error C2065: 'UndeclaredVariable': undeclared identifier\n...",
  "file_paths": ["/Source/MyProject/MyActor.cpp"],
  "asset_paths": [],
  "line_numbers": [42],
  "timestamp": 1738108800000
}
```

#### 5.1.4 Context Snapshot Event

```typescript
interface ContextSnapshotEvent extends BaseEvent {
  type: 'context_snapshot';
  project_info: ProjectInfoEvent;
  recent_logs: LogEntryEvent[];
  last_error: ErrorBlockEvent | null;
}
```

#### 5.1.5 Heartbeat Event

```typescript
interface HeartbeatEvent extends BaseEvent {
  type: 'heartbeat';
  uptime_seconds: number;
}
```

### 5.2 Internal Data Models

#### 5.2.1 Chat Message

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  
  // User message specific
  attachedContext?: UnrealContext;
  attachedScreenshot?: {
    id: string;
    thumbnailPath: string;
  };
  
  // Assistant message specific
  parsed?: {
    diagnosis: string[];
    fixSteps: string[];
    nextDebugSteps: string[];
    codeSnippets: CodeSnippet[];
  };
}
```

#### 5.2.2 User Settings

```typescript
interface UserSettings {
  // AI Configuration
  aiProvider: 'openai' | 'anthropic';
  apiKey: string; // Encrypted
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
  maxContextSize: number; // bytes
}
```

---

## 6. API Specifications

### 6.1 IPC Channels (Main ↔ Renderer)

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `window:toggle` | Renderer → Main | `void` | Toggle visibility |
| `window:collapse` | Renderer → Main | `boolean` | Set collapsed state |
| `window:pin` | Renderer → Main | `boolean` | Set always-on-top |
| `capture:fullscreen` | Renderer → Main | `void` | Trigger full capture |
| `capture:window` | Renderer → Main | `string` | Capture specific window |
| `capture:region` | Renderer → Main | `void` | Start region selection |
| `capture:result` | Main → Renderer | `CaptureResult` | Capture completed |
| `connector:status` | Main → Renderer | `ConnectionStatus` | Status update |
| `connector:context` | Main → Renderer | `UnrealContext` | New context received |
| `ai:ask` | Renderer → Main | `AIRequest` | Send AI request |
| `ai:stream` | Main → Renderer | `string` | Streaming chunk |
| `ai:complete` | Main → Renderer | `AIResponse` | Response complete |
| `ai:error` | Main → Renderer | `Error` | Request failed |
| `storage:save-session` | Renderer → Main | `Session` | Save session |
| `storage:get-sessions` | Renderer → Main | `number` | Get sessions list |
| `storage:sessions` | Main → Renderer | `Session[]` | Sessions list |
| `settings:get` | Renderer → Main | `void` | Get settings |
| `settings:update` | Renderer → Main | `Partial<Settings>` | Update settings |
| `settings:data` | Main → Renderer | `Settings` | Settings data |

### 6.2 WebSocket Protocol (Connector ↔ App)

#### Connection Flow

```
Client                                Server
  |                                     |
  |-------- WebSocket Connect --------->|
  |                                     |
  |<-------- Connection ACK ------------|
  |                                     |
  |-------- project_info event -------->|
  |                                     |
  |-------- heartbeat (every 5s) ------>|
  |                                     |
  |-------- log_entry events ---------->|
  |-------- error_block events -------->|
  |                                     |
  |<-------- request_snapshot ----------|
  |                                     |
  |-------- context_snapshot ---------->|
  |                                     |
```

#### Server → Client Messages

```typescript
// Request full context snapshot
interface RequestSnapshotMessage {
  type: 'request_snapshot';
}

// Acknowledge connection
interface ConnectionAckMessage {
  type: 'connection_ack';
  server_version: string;
}
```

---

## 7. UI/UX Technical Design

### 7.1 Overlay Visual Design

```
┌────────────────────────────────────────────┐
│ ┌──────────────────────────────────────┐   │
│ │ ⊡ Gorka Copilot    ─ □ ✕             │   │  ← Custom title bar (draggable)
│ └──────────────────────────────────────┘   │
│ ┌──────────────────────────────────────┐   │
│ │ 🔵 Unreal | MyProject | UE 5.4.1     │   │  ← Context chips
│ │ Updated 5s ago                        │   │
│ └──────────────────────────────────────┘   │
│ ┌──────────────────────────────────────┐   │
│ │                                      │   │
│ │  [Chat messages area]                │   │  ← Scrollable message list
│ │                                      │   │
│ │  User: My packaging is failing...    │   │
│ │                                      │   │
│ │  Assistant:                          │   │
│ │  ## Diagnosis                        │   │
│ │  - Missing plugin dependency...      │   │
│ │                                      │   │
│ │  ## Fix Steps                        │   │
│ │  1. Open Project Settings...         │   │
│ │                                      │   │
│ └──────────────────────────────────────┘   │
│ ┌──────────────────────────────────────┐   │
│ │ ┌────────────────────────────────┐   │   │
│ │ │ What are you trying to do?     │   │   │  ← Input textarea
│ │ └────────────────────────────────┘   │   │
│ │ [📷 ▼] [📋] [       Ask       ]      │   │  ← Action buttons
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

### 7.2 Collapsed State

```
┌──────┐
│  🤖  │  ← Click to expand, drag to move
└──────┘
```

### 7.3 Region Capture Overlay

```
┌────────────────────────────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░┌─────────────────────────────┐░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░│                             │░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░│     Selected Region         │░░░░░░░░░░░░░░░░░░░░░░░░░│  ← Clear area
│░░░░░░░░░░░░│     (clear, unshaded)       │░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░│                             │░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░└─────────────────────────────┘░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← Darkened overlay
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└────────────────────────────────────────────────────────────────────┘
   Instructions: "Drag to select region. Press ESC to cancel."
```

### 7.4 Theme & Styling

```typescript
// Tailwind theme extension
const theme = {
  colors: {
    overlay: {
      bg: 'rgba(24, 24, 27, 0.95)',     // Dark semi-transparent
      border: 'rgba(63, 63, 70, 0.8)',
      accent: '#3b82f6',                 // Blue
      success: '#22c55e',                // Green (connected)
      warning: '#f59e0b',                // Yellow (connecting)
      error: '#ef4444',                  // Red (disconnected)
    }
  },
  backdropFilter: {
    blur: 'blur(12px)',
  }
};
```

### 7.5 Responsive Sizes

| Mode | Width | Height | Use Case |
|------|-------|--------|----------|
| Collapsed | 60px | 60px | Minimal footprint |
| Compact | 320px | 400px | Quick questions |
| Default | 400px | 600px | Normal usage |
| Expanded | 500px | 700px | Long responses |

---

## 8. Security & Privacy

### 8.1 Data Flow Security

```
┌─────────────────────────────────────────────────────────────────────┐
│                           LOCAL MACHINE                              │
│                                                                      │
│  ┌──────────────┐     localhost only      ┌──────────────────────┐ │
│  │   Unreal     │◄──────────────────────►│    Overlay App       │ │
│  │   Plugin     │    WebSocket :9876      │                      │ │
│  └──────────────┘                         └──────────┬───────────┘ │
│                                                      │              │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │
                                            HTTPS only │ (on user action)
                                                       │
                                            ┌──────────▼───────────┐
                                            │     AI API           │
                                            │  (OpenAI/Anthropic)  │
                                            └──────────────────────┘
```

### 8.2 Security Measures

| Area | Measure | Implementation |
|------|---------|----------------|
| Connector Traffic | Localhost only | WebSocket bound to 127.0.0.1 |
| API Keys | Encrypted storage | electron-store with encryption |
| Screenshots | Local temp files | Auto-cleared on close |
| History | Local storage only | No cloud sync |
| AI Requests | User-initiated only | No automatic uploads |
| Permissions | Explicit prompts | macOS Screen Recording dialog |

### 8.3 Privacy Settings

```typescript
interface PrivacyConfig {
  // Screenshot capture toggle
  screenshotCaptureEnabled: boolean; // Default: true
  
  // Auto-send logs to AI
  autoSendLogs: boolean; // Default: true
  
  // Clear screenshots after session
  autoClearScreenshots: boolean; // Default: true
  
  // Local-only mode (no AI calls)
  localOnlyMode: boolean; // Default: false
  
  // History retention
  maxHistoryDays: number; // Default: 30
  maxHistorySessions: number; // Default: 100
}
```

### 8.4 Sensitive Data Handling

- **API Keys**: Encrypted using `safeStorage` API
- **Screenshots**: Stored in temp directory, cleared on app close
- **Logs**: Never persisted to disk beyond current session buffer
- **History**: Stored locally, exportable, deletable

---

## 9. Performance Considerations

### 9.1 Desktop App Performance

| Metric | Target | Strategy |
|--------|--------|----------|
| Memory (idle) | < 150MB | Lazy loading, virtualized lists |
| Memory (active) | < 300MB | Image compression, context limits |
| CPU (idle) | < 1% | Event-driven, no polling |
| Startup time | < 2s | Code splitting, deferred init |
| Response latency | < 100ms | IPC optimization, caching |

### 9.2 Unreal Plugin Performance

| Metric | Target | Strategy |
|--------|--------|----------|
| Frame impact | < 0.1ms | Async operations, background thread |
| Memory | < 10MB | Circular buffer, limited history |
| Log processing | < 1ms/line | Fast parsing, no regex in hot path |

### 9.3 Context Size Management

```typescript
const CONTEXT_LIMITS = {
  maxLogLines: 200,
  maxLogBytes: 25 * 1024, // 25KB
  maxErrorBlockSize: 10 * 1024, // 10KB
  maxScreenshotSize: 2 * 1024 * 1024, // 2MB
  imageResizeTarget: { width: 1920, height: 1080 },
  imageQuality: 0.8,
};
```

### 9.4 Streaming Response Handling

```typescript
// Efficient streaming render
const StreamingMessage: React.FC<{ content: string }> = ({ content }) => {
  const [displayContent, setDisplayContent] = useState('');
  const contentRef = useRef(content);
  
  useEffect(() => {
    // Batch updates to reduce re-renders
    const intervalId = setInterval(() => {
      if (contentRef.current !== displayContent) {
        setDisplayContent(contentRef.current);
      }
    }, 50); // Update UI at 20fps max
    
    return () => clearInterval(intervalId);
  }, []);
  
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  
  return <MarkdownRenderer content={displayContent} />;
};
```

---

## 10. Testing Strategy

### 10.1 Test Pyramid

```
                    ┌─────────┐
                    │   E2E   │  ← 10% - Critical flows
                   ─┴─────────┴─
                  ┌─────────────┐
                  │ Integration │  ← 30% - Component interactions
                 ─┴─────────────┴─
                ┌─────────────────┐
                │   Unit Tests    │  ← 60% - Functions, components
               ─┴─────────────────┴─
```

### 10.2 Unit Tests

| Component | Test Focus | Tool |
|-----------|------------|------|
| React Components | Rendering, state | Vitest + Testing Library |
| Main Process Services | Logic, error handling | Vitest |
| State Management | Actions, selectors | Vitest |
| Utility Functions | Edge cases | Vitest |

### 10.3 Integration Tests

| Test | Description |
|------|-------------|
| IPC Communication | Main ↔ Renderer message passing |
| WebSocket Server | Connector connection/reconnection |
| Screenshot Flow | Capture → Preview → Attach |
| AI Request Flow | Input → Request → Stream → Complete |
| Storage Operations | Save → Load → Export |

### 10.4 E2E Tests

| Flow | Tool |
|------|------|
| Window Management | Playwright |
| Hotkey Registration | Manual + Playwright |
| Capture Flows | Playwright (screenshot mocking) |
| Full Ask Flow | Playwright + API mocking |

### 10.5 Unreal Plugin Testing

| Test Type | Description |
|-----------|-------------|
| Unit | Log parsing, error classification |
| Integration | WebSocket connection (mock server) |
| Manual | In-editor testing with real scenarios |

---

## 11. Deployment & Distribution

### 11.1 Build Pipeline

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Source      │────►│    Build      │────►│   Package     │
│   (GitHub)    │     │   (CI/CD)     │     │  (Artifacts)  │
└───────────────┘     └───────────────┘     └───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │         Build Matrix          │
              │  ┌────────┐  ┌────────────┐  │
              │  │ macOS  │  │  Windows   │  │
              │  │ arm64  │  │   x64      │  │
              │  │ x64    │  │            │  │
              │  └────────┘  └────────────┘  │
              └──────────────────────────────┘
```

### 11.2 Distribution Artifacts

| Platform | Format | Signing |
|----------|--------|---------|
| macOS | .dmg, .zip | Apple Developer ID |
| Windows | .exe (NSIS), .msi | Code signing cert |

### 11.3 Auto-Update

```typescript
// electron-updater configuration
const updateConfig = {
  provider: 'github', // or 's3', 'generic'
  owner: 'gorka-copilot',
  repo: 'overlay',
  releaseType: 'release',
};

// Update check on startup (opt-in)
if (settings.autoCheckUpdates) {
  autoUpdater.checkForUpdatesAndNotify();
}
```

### 11.4 Unreal Plugin Distribution

| Method | Description |
|--------|-------------|
| Manual | .zip download + manual install |
| Marketplace | Epic Games Marketplace (future) |
| Git Submodule | For source access |

---

## 12. Risk Assessment

### 12.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| macOS Screen Recording permission issues | Medium | High | Clear permission prompts, fallback to window capture |
| Electron memory leaks | Medium | Medium | Memory profiling, image cleanup |
| WebSocket connection instability | Low | Medium | Auto-reconnect, offline mode |
| AI API rate limits | Medium | High | Request queuing, caching |
| Unreal version compatibility | Medium | Medium | Version detection, graceful degradation |

### 12.2 UX Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Overlay interferes with workflow | Medium | High | Click-through, quick collapse |
| Hotkey conflicts | Medium | Medium | Configurable hotkeys, conflict detection |
| Slow AI responses | Medium | Medium | Streaming, progress indication |

### 12.3 Security Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API key exposure | Low | High | Encrypted storage, never log |
| Accidental sensitive data capture | Low | Medium | User confirmation, no auto-capture |

---

## Appendix A: File Structure

```
gorka-copilot-overlay/
├── package.json
├── electron-builder.yml
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── src/
│   ├── main/
│   │   ├── index.ts              # Entry point
│   │   ├── windowManager.ts
│   │   ├── preload.ts
│   │   └── services/
│   │       ├── websocketServer.ts
│   │       ├── screenshotService.ts
│   │       ├── hotkeyManager.ts
│   │       ├── aiClient.ts
│   │       └── storageService.ts
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── store/
│   │   └── utils/
│   └── shared/
│       └── types.ts              # Shared type definitions
├── unreal-plugin/
│   └── GorkaCopilotConnector/
│       ├── GorkaCopilotConnector.uplugin
│       ├── Source/
│       └── Config/
└── docs/
    ├── prd.md
    └── tdd.md
```

---

## Appendix B: Development Environment Setup

### Prerequisites

```bash
# Node.js 20.x
# npm 10.x or yarn 4.x
# Xcode Command Line Tools (macOS)
# Visual Studio Build Tools (Windows)
# Unreal Engine 5.3+ (for plugin development)
```

### Quick Start

```bash
# Clone repository
git clone https://github.com/gorka-copilot/overlay.git
cd overlay

# Install dependencies
npm install

# Development mode
npm run dev

# Build for production
npm run build

# Package installers
npm run package
```

---

## Appendix C: Configuration Files

### electron-builder.yml

```yaml
appId: com.gorka.copilot
productName: Gorka Copilot
directories:
  output: dist
  buildResources: build
files:
  - "dist/**/*"
  - "package.json"
mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
win:
  target:
    - target: nsis
      arch: [x64]
  sign: true
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
publish:
  provider: github
  owner: gorka-copilot
  repo: overlay
```

---

*Document maintained by the Gorka Copilot team. For questions, contact engineering@gorkacopilot.dev*
