const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI = {
  // Window controls
  window: {
    toggle: () => ipcRenderer.send('window:toggle'),
    collapse: (collapsed) => ipcRenderer.send('window:collapse', collapsed),
    onCollapsedChanged: (callback) => {
      const subscription = (_event, collapsed) => callback(collapsed);
      ipcRenderer.on('window:collapsed-changed', subscription);
      return () => ipcRenderer.removeListener('window:collapsed-changed', subscription);
    },
    restoreOpacity: () => ipcRenderer.send('window:restore-opacity'),
    pin: (pinned) => ipcRenderer.send('window:pin', pinned),
    getState: () => ipcRenderer.invoke('window:get-state'),
    growForConversation: () => ipcRenderer.send('window:grow-for-conversation'),
    setFocusable: (value) => ipcRenderer.send('window:set-focusable', value),
    enterSettings: () => ipcRenderer.send('window:enter-settings'),
    exitSettings: () => ipcRenderer.send('window:exit-settings'),
    resizeSettings: (width, height) => ipcRenderer.send('window:resize-settings', { width, height }),
    enterLogin: () => ipcRenderer.send('window:enter-login'),
    enterVideoMode: () => ipcRenderer.send('window:enter-video-mode'),
    exitVideoMode: () => ipcRenderer.send('window:exit-video-mode'),
  },

  // Vignette overlay (full-screen AI thinking effect)
  vignette: {
    show: () => ipcRenderer.send('vignette:show'),
    hide: () => ipcRenderer.send('vignette:hide'),
  },

  // Paste-hint overlay (Blueprints Library Ctrl/Cmd+V prompt)
  pasteHint: {
    show: (durationMs) => ipcRenderer.send('paste-hint:show', durationMs),
    hide: () => ipcRenderer.send('paste-hint:hide'),
  },

  // Virtual cursor overlay (guided steps pointer)
  cursor: {
    show: (params) => ipcRenderer.invoke('cursor:show', params),
    hide: () => ipcRenderer.invoke('cursor:hide'),
  },

  // Screenshot capture
  capture: {
    fullscreen: () => ipcRenderer.send('capture:fullscreen'),
    fullscreenSync: () => ipcRenderer.invoke('capture:fullscreen-sync'),
    fullscreenNoHide: () => ipcRenderer.invoke('capture:fullscreen-no-hide'),
    fullscreenHiRes: () => ipcRenderer.invoke('capture:fullscreen-hires'),
    window: (windowId) => ipcRenderer.send('capture:window', windowId),
    region: () => ipcRenderer.send('capture:region'),
    getWindows: () => ipcRenderer.invoke('capture:get-windows'),
    onResult: (callback) => {
      const subscription = (_event, result) => callback(result);
      ipcRenderer.on('capture:result', subscription);
      return () => ipcRenderer.removeListener('capture:result', subscription);
    },
    onWindowsList: (callback) => {
      const subscription = (_event, windows) => callback(windows);
      ipcRenderer.on('capture:windows-list', subscription);
      return () => ipcRenderer.removeListener('capture:windows-list', subscription);
    },
  },

  // YouTube transcript helper
  youtube: {
    fetchTranscript: (videoId) => ipcRenderer.invoke('youtube:fetch-transcript', videoId),
  },

  // AI assistant
  ai: {
    ask: (request) => ipcRenderer.send('ai:ask', request),
    summarize: (params) => ipcRenderer.invoke('ai:summarize', params),
    verifyStep: (params) => ipcRenderer.invoke('ai:verify-step', params),
    generateNextStep: (params) => ipcRenderer.invoke('ai:generate-next-step', params),
    generateClickTarget: (params) => ipcRenderer.invoke('ai:generate-click-target', params),
    generateStepsFromTranscript: (params) => ipcRenderer.invoke('ai:generate-steps-from-transcript', params),
    transcribeAudio: (params) => ipcRenderer.invoke('ai:transcribe-audio', params),
    onStream: (callback) => {
      const subscription = (_event, chunk) => callback(chunk);
      ipcRenderer.on('ai:stream', subscription);
      return () => ipcRenderer.removeListener('ai:stream', subscription);
    },
    onComplete: (callback) => {
      const subscription = (_event, response) => callback(response);
      ipcRenderer.on('ai:complete', subscription);
      return () => ipcRenderer.removeListener('ai:complete', subscription);
    },
    onError: (callback) => {
      const subscription = (_event, error) => callback(error);
      ipcRenderer.on('ai:error', subscription);
      return () => ipcRenderer.removeListener('ai:error', subscription);
    },
  },

  // Conversation threads
  threads: {
    save: (thread) => ipcRenderer.invoke('threads:save', thread),
    get: (id) => ipcRenderer.invoke('threads:get', id),
    list: (limit) => ipcRenderer.invoke('threads:list', limit),
    delete: (id) => ipcRenderer.invoke('threads:delete', id),
    setActive: (id) => ipcRenderer.invoke('threads:set-active', id),
    getActive: () => ipcRenderer.invoke('threads:get-active'),
  },

  // Connector (Unreal Engine)
  connector: {
    getStatus: () => ipcRenderer.invoke('connector:get-status'),
    getContext: () => ipcRenderer.invoke('connector:get-context'),
    requestSnapshot: () => ipcRenderer.send('connector:request-snapshot'),
    onStatusChange: (callback) => {
      const subscription = (_event, data) => callback(data);
      ipcRenderer.on('connector:status', subscription);
      return () => ipcRenderer.removeListener('connector:status', subscription);
    },
    onContextUpdate: (callback) => {
      const subscription = (_event, context) => callback(context);
      ipcRenderer.on('connector:context', subscription);
      return () => ipcRenderer.removeListener('connector:context', subscription);
    },
  },

  // Storage
  storage: {
    saveSession: (session) => ipcRenderer.invoke('storage:save-session', session),
    getSessions: (limit) => ipcRenderer.invoke('storage:get-sessions', limit),
    deleteSession: (id) => ipcRenderer.invoke('storage:delete-session', id),
    clearSessions: () => ipcRenderer.invoke('storage:clear-sessions'),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings) => ipcRenderer.invoke('settings:update', settings),
    getHotkeys: () => ipcRenderer.invoke('settings:get-hotkeys'),
    updateHotkeys: (config) => ipcRenderer.invoke('settings:update-hotkeys', config),
  },

  // Auth / Entitlements
  auth: {
    login: (email) => ipcRenderer.invoke('auth:login', email),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getState: () => ipcRenderer.invoke('auth:get-state'),
    checkCanAsk: () => ipcRenderer.invoke('auth:check-can-ask'),
    recordAsk: () => ipcRenderer.invoke('auth:record-ask'),
    getUsage: () => ipcRenderer.invoke('auth:get-usage'),
    checkEntitlement: (email) => ipcRenderer.invoke('auth:check-entitlement', email),
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    quit: () => ipcRenderer.send('app:quit'),
  },

  // Auto-updater
  updater: {
    install: () => ipcRenderer.send('updater:install'),
    onUpdateReady: (callback) => {
      const subscription = (_event) => callback();
      ipcRenderer.on('updater:update-ready', subscription);
      return () => ipcRenderer.removeListener('updater:update-ready', subscription);
    },
    onDownloading: (callback: (version: string) => void) => {
      const subscription = (_event, data) => callback(data.version);
      ipcRenderer.on('updater:downloading', subscription);
      return () => ipcRenderer.removeListener('updater:downloading', subscription);
    },
    onDownloadProgress: (callback: (percent: number) => void) => {
      const subscription = (_event, data) => callback(data.percent);
      ipcRenderer.on('updater:download-progress', subscription);
      return () => ipcRenderer.removeListener('updater:download-progress', subscription);
    },
    onError: (callback: (message: string) => void) => {
      const subscription = (_event, data) => callback(data.message);
      ipcRenderer.on('updater:error', subscription);
      return () => ipcRenderer.removeListener('updater:error', subscription);
    },
  },

  // Analytics relay — renderer-side events. Only whitelisted events in main land.
  analytics: {
    track: (event, properties) => ipcRenderer.send('analytics:track', { event, properties }),
  },

  // Focus input (triggered by hotkey)
  onFocusInput: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('focus-input', subscription);
    return () => ipcRenderer.removeListener('focus-input', subscription);
  },

  // Start voice input (triggered by hotkey)
  onStartVoice: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('start-voice', subscription);
    return () => ipcRenderer.removeListener('start-voice', subscription);
  },

  // Agent automation
  agent: {
    checkPermissions: () => ipcRenderer.invoke('agent:check-permissions'),
    requestPlan: (request) => ipcRenderer.invoke('agent:request-plan', request),
    execute: (actions, displayBounds, screenshotDimensions, scaleFactor) => ipcRenderer.invoke('agent:execute', { actions, displayBounds, screenshotDimensions, scaleFactor }),
    stop: () => ipcRenderer.send('agent:stop'),
    onProgress: (callback) => {
      const subscription = (_event, progress) => callback(progress);
      ipcRenderer.on('agent:progress', subscription);
      return () => ipcRenderer.removeListener('agent:progress', subscription);
    },
  },

  // Documentation images
  docs: {
    fetchImages: (query: string) => ipcRenderer.invoke('docs:fetch-images', query),
  },

  // UE Project analysis
  project: {
    browse: () => ipcRenderer.invoke('project:browse'),
    analyze: (projectPath) => ipcRenderer.invoke('project:analyze', projectPath),
    getAnalysis: () => ipcRenderer.invoke('project:get-analysis'),
  },

  // Unreal Engine commands
  ue: {
    browseEnginePath: () => ipcRenderer.invoke('ue:browse-engine-path'),
    detectEnginePath: () => ipcRenderer.invoke('ue:detect-engine-path'),
    detectUefnPath: () => ipcRenderer.invoke('ue:detect-uefn-path'),
    isConnected: () => ipcRenderer.invoke('ue:is-connected'),
    executeCommand: (command, params) => ipcRenderer.invoke('ue:execute-command', command, params),
    // Blueprint
    createBlueprint: (name, parentClass, path) => ipcRenderer.invoke('ue:create-blueprint', name, parentClass, path),
    openBlueprint: (assetPath) => ipcRenderer.invoke('ue:open-blueprint', assetPath),
    // Level
    spawnActor: (actorType, name, location) => ipcRenderer.invoke('ue:spawn-actor', actorType, name, location),
    getLevelActors: () => ipcRenderer.invoke('ue:get-level-actors'),
    // Editor
    saveAll: () => ipcRenderer.invoke('ue:save-all'),
    playInEditor: () => ipcRenderer.invoke('ue:play-in-editor'),
    stopPlayInEditor: () => ipcRenderer.invoke('ue:stop-play-in-editor'),
    compileProject: () => ipcRenderer.invoke('ue:compile-project'),
    getProjectInfo: () => ipcRenderer.invoke('ue:get-project-info'),
    // Assets
    getAssets: (path, type) => ipcRenderer.invoke('ue:get-assets', path, type),
  },

  // Unreal MCP (Model Context Protocol)
  unrealMcp: {
    getStatus: () => ipcRenderer.invoke('unreal-mcp:get-status'),
    start: () => ipcRenderer.invoke('unreal-mcp:start'),
    stop: () => ipcRenderer.invoke('unreal-mcp:stop'),
    testConnection: () => ipcRenderer.invoke('unreal-mcp:test-connection'),
    callTool: (name, args) => ipcRenderer.invoke('unreal-mcp:call-tool', name, args),
    getTools: () => ipcRenderer.invoke('unreal-mcp:get-tools'),
    onStatusChange: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('unreal-mcp:status', handler);
      return () => ipcRenderer.removeListener('unreal-mcp:status', handler);
    },
  },

  // Engine Selection
  engine: {
    getSelected: () => ipcRenderer.invoke('engine:get-selected'),
    setSelected: (engine) => ipcRenderer.invoke('engine:set-selected', engine),
    autoDetect: () => ipcRenderer.invoke('engine:auto-detect'),
    checkSetup: (engine) => ipcRenderer.invoke('engine:check-setup', engine),
    installDeps: (engine) => ipcRenderer.invoke('engine:install-deps', engine),
    getSetupSteps: (engine) => ipcRenderer.invoke('engine:get-setup-steps', engine),
    onSelected: (callback) => {
      const handler = (_event, engine) => callback(engine);
      ipcRenderer.on('engine:selected', handler);
      return () => ipcRenderer.removeListener('engine:selected', handler);
    },
  },

  // Unreal-specific helpers
  unreal: {
    selectProjectFolder: () => ipcRenderer.invoke('unreal:select-project-folder'),
    focusEditor: () => ipcRenderer.invoke('unreal:focus-editor'),
  },

  // Godot-specific helpers
  godot: {
    installAddon: () => ipcRenderer.invoke('godot:install-addon'),
  },

  // Unity-specific helpers
  unity: {
    setupServer: () => ipcRenderer.invoke('unity:setup-server'),
  },

  // Blender-specific helpers
  blender: {
    showAddon: () => ipcRenderer.invoke('blender:show-addon'),
    installAddon: () => ipcRenderer.invoke('blender:install-addon'),
  },

  // Fair-use rate limiting
  fairuse: {
    getState: () => ipcRenderer.invoke('fairuse:get-state'),
  },

  // Clipboard (fallback when navigator.clipboard fails — e.g. overlay not focused)
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  },

  // Debug — temporary, for copying recent console logs to clipboard
  debug: {
    copyLogs: () => ipcRenderer.invoke('debug:copy-logs'),
  },

  // Engine-agnostic MCP
  engineMcp: {
    getStatus: () => ipcRenderer.invoke('engine-mcp:get-status'),
    start: () => ipcRenderer.invoke('engine-mcp:start'),
    stop: () => ipcRenderer.invoke('engine-mcp:stop'),
    callTool: (name, args) => ipcRenderer.invoke('engine-mcp:call-tool', name, args),
    openLog: () => ipcRenderer.invoke('engine-mcp:open-log'),
    onStatusChange: (callback) => {
      const handler = (_event, payload) => {
        // Backwards-compat: payload was the bare status string before {status, error}.
        if (payload && typeof payload === 'object' && 'status' in payload) {
          callback(payload.status, payload.error);
        } else {
          callback(payload);
        }
      };
      ipcRenderer.on('engine-mcp:status', handler);
      return () => ipcRenderer.removeListener('engine-mcp:status', handler);
    },
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
