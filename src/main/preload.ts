const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI = {
  // Window controls
  window: {
    toggle: () => ipcRenderer.send('window:toggle'),
    collapse: (collapsed) => ipcRenderer.send('window:collapse', collapsed),
    pin: (pinned) => ipcRenderer.send('window:pin', pinned),
    getState: () => ipcRenderer.invoke('window:get-state'),
    growForConversation: () => ipcRenderer.send('window:grow-for-conversation'),
    enterSettings: () => ipcRenderer.send('window:enter-settings'),
    exitSettings: () => ipcRenderer.send('window:exit-settings'),
  },

  // Vignette overlay (full-screen AI thinking effect)
  vignette: {
    show: () => ipcRenderer.send('vignette:show'),
    hide: () => ipcRenderer.send('vignette:hide'),
  },

  // Screenshot capture
  capture: {
    fullscreen: () => ipcRenderer.send('capture:fullscreen'),
    fullscreenSync: () => ipcRenderer.invoke('capture:fullscreen-sync'),
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

  // AI assistant
  ai: {
    ask: (request) => ipcRenderer.send('ai:ask', request),
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
  },

  // Focus input (triggered by hotkey)
  onFocusInput: (callback) => {
    const subscription = () => callback();
    ipcRenderer.on('focus-input', subscription);
    return () => ipcRenderer.removeListener('focus-input', subscription);
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

  // Unreal MCP (MCP server via Python Remote Execution)
  unrealMcp: {
    getStatus: () => ipcRenderer.invoke('unreal-mcp:get-status'),
    start: () => ipcRenderer.invoke('unreal-mcp:start'),
    stop: () => ipcRenderer.invoke('unreal-mcp:stop'),
    testConnection: () => ipcRenderer.invoke('unreal-mcp:test-connection'),
    callTool: (name, args) => ipcRenderer.invoke('unreal-mcp:call-tool', name, args),
    executeIntent: (params) => ipcRenderer.invoke('unreal-mcp:execute-intent', params),
    onStatusChange: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('unreal-mcp:status', handler);
      return () => ipcRenderer.removeListener('unreal-mcp:status', handler);
    },
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
