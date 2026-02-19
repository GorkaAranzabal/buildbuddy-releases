import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { WindowManager } from './windowManager';
import { WebSocketServer } from './services/websocketServer';
import { ScreenshotService } from './services/screenshotService';
import { HotkeyManager } from './services/hotkeyManager';
import { AIClientService } from './services/aiClient';
import { StorageService } from './services/storageService';
import { AgentExecutor } from './services/agentExecutor';
import { UECommandService } from './services/ueCommandService';
import { EntitlementService } from './services/entitlementService';
import { AutoUpdaterService } from './services/autoUpdaterService';
import { DocImageService } from './services/docImageService';
import { ProjectAnalysisService } from './services/projectAnalysisService';
import { UnrealMCPService } from './services/unrealMCPService';
import type { AIRequest, CaptureMode, Session, UserSettings, HotkeyConfig, ActionPlanRequest, AgentAction, UECommandType, UnrealContext } from '../shared/types';
import {
  initAnalytics, trackAppLaunched, trackPlanIdentified,
  trackFeatureUsed, trackScreenCaptureTaken, trackRemoteControlCommand,
  shutdownAnalytics,
} from './analytics';

// Keywords that are unambiguously Unreal Engine-specific.
// We only inject the UE project context when the query is actually UE-related
// to avoid polluting responses about other software (Blender, Unity, etc.).
const UE_KEYWORDS = [
  'unreal', 'ue4', 'ue5', 'blueprint', 'blueprints',
  'uproject', 'uasset', 'umap', 'uproperty', 'ufunction', 'uclass',
  'niagara', 'nanite', 'lumen', 'metasound',
  'gameplay ability', 'world partition', 'actor component',
  'game mode', 'game instance', 'subsystem',
];

function isUERelatedQuery(prompt: string, context: UnrealContext | null): boolean {
  // If the UE connector is live, the user is definitely working in UE
  if (context?.projectInfo) return true;
  // Otherwise check for UE-specific keywords in the prompt
  const lower = prompt.toLowerCase();
  return UE_KEYWORDS.some((kw) => lower.includes(kw));
}

class GorkaCopilotApp {
  private windowManager: WindowManager;
  private webSocketServer: WebSocketServer;
  private screenshotService: ScreenshotService;
  private hotkeyManager: HotkeyManager;
  private aiClient: AIClientService;
  private storageService: StorageService;
  private agentExecutor: AgentExecutor;
  private ueCommandService: UECommandService;
  private entitlementService: EntitlementService;
  private autoUpdaterService: AutoUpdaterService;
  private docImageService: DocImageService;
  private projectAnalysisService: ProjectAnalysisService;
  private unrealMCPService: UnrealMCPService;

  constructor() {
    this.windowManager = new WindowManager();
    this.webSocketServer = new WebSocketServer();
    this.screenshotService = new ScreenshotService();
    this.hotkeyManager = new HotkeyManager();
    this.aiClient = new AIClientService();
    this.storageService = new StorageService();
    this.agentExecutor = new AgentExecutor();
    this.ueCommandService = new UECommandService(this.webSocketServer);
    this.entitlementService = new EntitlementService(this.storageService);
    this.autoUpdaterService = new AutoUpdaterService();
    this.docImageService = new DocImageService();
    this.projectAnalysisService = new ProjectAnalysisService();
    this.unrealMCPService = new UnrealMCPService();
  }

  async initialize(): Promise<void> {
    // Initialize storage first
    await this.storageService.initialize();

    // Initialize analytics with persistent anonymous device ID
    initAnalytics();
    trackAppLaunched();

    // Identify plan tier (no PII — just 'free' or 'pro')
    const authState = await this.entitlementService.getAuthState();
    if (authState.isLoggedIn && authState.entitlement) {
      trackPlanIdentified(authState.entitlement.active ? 'pro' : 'free');
    }

    // Load settings
    const settings = await this.storageService.getSettings();
    this.aiClient.configure(settings.aiProvider, settings.apiKey);

    // Load hotkey config
    const hotkeyConfig = await this.storageService.getHotkeyConfig();

    // Load window state
    const windowState = await this.storageService.getWindowState();

    // Create main window
    const mainWindow = this.windowManager.createMainWindow(windowState);

    // Register hotkeys
    this.hotkeyManager.setConfig(hotkeyConfig);
    this.hotkeyManager.registerAll(this.handleHotkeyAction.bind(this));

    // Start WebSocket server
    await this.webSocketServer.start();

    // Setup IPC handlers
    this.setupIpcHandlers();

    // Setup connector event forwarding
    this.setupConnectorEventForwarding();

    // Initialize auto-updater
    this.autoUpdaterService.initialize(mainWindow);

    // Save window state on close
    mainWindow.on('close', async () => {
      const state = this.windowManager.getState();
      await this.storageService.updateWindowState(state);
    });
  }

  private handleHotkeyAction(action: string): void {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

    switch (action) {
      case 'toggleOverlay':
        this.windowManager.toggleVisibility();
        break;
      case 'captureFullScreen':
        this.handleCapture('fullscreen');
        break;
      case 'captureWindow':
        this.handleCapture('window');
        break;
      case 'captureRegion':
        this.handleCapture('region');
        break;
      case 'quickAsk':
        this.windowManager.show();
        this.windowManager.setCollapsed(false);
        mainWindow.webContents.send('focus-input');
        break;
    }
  }

  private async handleCapture(mode: CaptureMode): Promise<void> {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

    try {
      let result;
      switch (mode) {
        case 'fullscreen':
          result = await this.screenshotService.captureFullScreen();
          break;
        case 'window':
          // For window capture, we'll need to show a window picker
          const windows = await this.screenshotService.getAvailableWindows();
          mainWindow.webContents.send('capture:windows-list', windows);
          return;
        case 'region':
          result = await this.screenshotService.captureRegion(mainWindow);
          break;
      }

      if (result) {
        trackScreenCaptureTaken(mode);
        mainWindow.webContents.send('capture:result', result);
      }
    } catch (error) {
      console.error('Capture failed:', error);
    }
  }

  private setupIpcHandlers(): void {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

    // App info
    ipcMain.handle('app:get-version', () => {
      return app.getVersion();
    });

    ipcMain.on('app:quit', () => {
      app.quit();
    });

    ipcMain.on('window:grow-for-conversation', () => {
      this.windowManager.growForConversation();
    });

    ipcMain.on('window:enter-settings', () => {
      this.windowManager.setSettingsMode(true);
    });

    ipcMain.on('window:exit-settings', () => {
      this.windowManager.setSettingsMode(false);
    });

    // UE Project Analysis handlers
    ipcMain.handle('project:browse', async () => {
      const { dialog } = await import('electron');
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Unreal Engine Project Folder',
        buttonLabel: 'Select Project',
      });
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle('project:analyze', async (_event, projectPath: string) => {
      const analysis = await this.projectAnalysisService.analyzeProject(projectPath);
      await this.storageService.saveProjectAnalysis(analysis);
      return analysis;
    });

    ipcMain.handle('project:get-analysis', async () => {
      return this.storageService.getProjectAnalysis();
    });

    // Window handlers
    ipcMain.on('window:toggle', () => {
      this.windowManager.toggleVisibility();
    });

    ipcMain.on('window:collapse', (_event, collapsed: boolean) => {
      this.windowManager.setCollapsed(collapsed);
    });

    ipcMain.on('window:pin', (_event, pinned: boolean) => {
      this.windowManager.setAlwaysOnTop(pinned);
    });

    ipcMain.handle('window:get-state', () => {
      return this.windowManager.getState();
    });

    // Vignette handlers
    ipcMain.on('vignette:show', () => {
      this.windowManager.showVignette();
    });

    ipcMain.on('vignette:hide', () => {
      this.windowManager.hideVignette();
    });

    // Capture handlers
    ipcMain.on('capture:fullscreen', () => {
      this.handleCapture('fullscreen');
    });

    ipcMain.on('capture:window', async (_event, windowId: string) => {
      try {
        const result = await this.screenshotService.captureWindow(windowId);
        mainWindow.webContents.send('capture:result', result);
      } catch (error) {
        console.error('Window capture failed:', error);
      }
    });

    ipcMain.on('capture:region', () => {
      this.handleCapture('region');
    });

    ipcMain.handle('capture:get-windows', async () => {
      return this.screenshotService.getAvailableWindows();
    });

    // Synchronous fullscreen capture (for auto-screenshot on send)
    // Hides the app window before capture to avoid capturing ourselves
    ipcMain.handle('capture:fullscreen-sync', async () => {
      try {
        // Get the display where our window currently is
        const windowBounds = mainWindow.getBounds();
        const windowCenterX = windowBounds.x + windowBounds.width / 2;
        const windowCenterY = windowBounds.y + windowBounds.height / 2;
        console.log('[Screenshot] Window center:', windowCenterX, windowCenterY);
        
        const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
        console.log('[Screenshot] Target display:', currentDisplay.id);
        
        // Hide our window before capturing
        const wasVisible = mainWindow.isVisible();
        console.log('[Screenshot] Window visible:', wasVisible);
        if (wasVisible) {
          mainWindow.hide();
          // Wait for window to fully hide
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Capture the screenshot of the display where our window is
        console.log('[Screenshot] Starting capture...');
        const result = await this.screenshotService.captureFullScreen(currentDisplay.id);
        console.log('[Screenshot] Capture complete:', result ? `${result.imageBase64.length} bytes` : 'null');
        if (result) trackScreenCaptureTaken('fullscreen-sync');

        // Show our window again
        if (wasVisible) {
          mainWindow.show();
        }

        return result;
      } catch (error) {
        console.error('[Screenshot] Capture failed:', error);
        // Make sure to show window even if capture fails
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        return null;
      }
    });

    // Auth / Entitlement handlers
    ipcMain.handle('auth:login', async (_event, email: string) => {
      const state = await this.entitlementService.login(email);
      if (state.entitlement) {
        trackPlanIdentified(state.entitlement.active ? 'pro' : 'free');
      }
      return state;
    });

    ipcMain.handle('auth:logout', async () => {
      await this.entitlementService.logout();
    });

    ipcMain.handle('auth:get-state', async () => {
      return this.entitlementService.getAuthState();
    });

    ipcMain.handle('auth:check-can-ask', async () => {
      return this.entitlementService.checkCanAsk();
    });

    ipcMain.handle('auth:record-ask', async () => {
      return this.entitlementService.recordAsk();
    });

    ipcMain.handle('auth:get-usage', async () => {
      return this.storageService.getDailyUsage();
    });

    ipcMain.handle('auth:check-entitlement', async (_event, email: string) => {
      return this.entitlementService.checkEntitlement(email);
    });

    // Auto-updater handlers
    ipcMain.on('updater:install', () => {
      this.autoUpdaterService.installUpdate();
    });

    // AI handlers
    ipcMain.on('ai:ask', async (_event, request: AIRequest) => {
      try {
        // Check entitlement before processing
        const canAsk = await this.entitlementService.checkCanAsk();
        if (!canAsk.allowed) {
          mainWindow.webContents.send('ai:error', {
            message: canAsk.reason || 'Ask limit reached',
            type: 'entitlement_limit',
          });
          return;
        }

        // Record the ask
        await this.entitlementService.recordAsk();
        trackFeatureUsed('ai_ask');

        // Set model based on entitlement tier
        if (!this.entitlementService.isPro()) {
          this.aiClient.setModelOverride('gpt-4o-mini');
        } else {
          this.aiClient.setModelOverride(null);
        }

        const context = request.context || this.webSocketServer.getCurrentContext();

        // Inject UE project context. If the user has explicitly configured a project
        // path, always inject it — they set it because they want it for all questions.
        // Otherwise fall back to keyword-based detection (covers the live-connector case).
        const currentSettings = await this.storageService.getSettings();
        let projectContext: string | undefined;
        const shouldInjectUEContext = currentSettings.ueProjectPath
          ? true
          : isUERelatedQuery(request.prompt, context);
        if (shouldInjectUEContext && currentSettings.ueProjectPath) {
          try {
            const freshAnalysis = await this.projectAnalysisService.analyzeProject(currentSettings.ueProjectPath);
            await this.storageService.saveProjectAnalysis(freshAnalysis);
            projectContext = this.projectAnalysisService.generateContextText(freshAnalysis);
          } catch {
            // Fall back to cached analysis if re-scan fails (e.g. path moved)
            const cachedAnalysis = await this.storageService.getProjectAnalysis();
            if (cachedAnalysis) {
              projectContext = this.projectAnalysisService.generateContextText(cachedAnalysis);
            }
          }
        } else if (shouldInjectUEContext) {
          // No project path but connector provides context — use cached analysis if any
          const cachedAnalysis = await this.storageService.getProjectAnalysis();
          if (cachedAnalysis) {
            projectContext = this.projectAnalysisService.generateContextText(cachedAnalysis);
          }
        }

        const fullRequest = { ...request, context, projectContext };

        for await (const chunk of this.aiClient.ask(fullRequest)) {
          mainWindow.webContents.send('ai:stream', chunk);
        }

        // Send completion signal when streaming is done
        mainWindow.webContents.send('ai:complete', { success: true });
      } catch (error) {
        mainWindow.webContents.send('ai:error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Storage handlers
    ipcMain.handle('storage:save-session', async (_event, session: Session) => {
      await this.storageService.saveSession(session);
    });

    ipcMain.handle('storage:get-sessions', async (_event, limit?: number) => {
      return this.storageService.getSessions(limit);
    });

    ipcMain.handle('storage:delete-session', async (_event, id: string) => {
      await this.storageService.deleteSession(id);
    });

    ipcMain.handle('storage:clear-sessions', async () => {
      await this.storageService.clearAllSessions();
    });

    // Settings handlers
    ipcMain.handle('settings:get', async () => {
      return this.storageService.getSettings();
    });

    ipcMain.handle('settings:update', async (_event, settings: Partial<UserSettings>) => {
      await this.storageService.updateSettings(settings);
      const fullSettings = await this.storageService.getSettings();
      this.aiClient.configure(fullSettings.aiProvider, fullSettings.apiKey);
    });

    ipcMain.handle('settings:get-hotkeys', async () => {
      return this.storageService.getHotkeyConfig();
    });

    ipcMain.handle('settings:update-hotkeys', async (_event, config: Partial<HotkeyConfig>) => {
      await this.storageService.updateHotkeyConfig(config);
      const fullConfig = await this.storageService.getHotkeyConfig();
      this.hotkeyManager.setConfig(fullConfig);
      this.hotkeyManager.unregisterAll();
      this.hotkeyManager.registerAll(this.handleHotkeyAction.bind(this));
    });

    // Connector handlers
    ipcMain.handle('connector:get-status', () => {
      const clients = this.webSocketServer.getConnectedClients();
      const client = clients.length > 0 ? clients[0] : null;
      return {
        status: client?.connected ? 'connected' : 'disconnected',
        client,
      };
    });

    ipcMain.handle('connector:get-context', () => {
      return this.webSocketServer.getCurrentContext();
    });

    ipcMain.on('connector:request-snapshot', () => {
      this.webSocketServer.requestSnapshot();
    });

    // Agent handlers
    // Pass mainWindow to executor
    this.agentExecutor.setMainWindow(mainWindow);
    console.log('[Main] Agent handlers registered');

    ipcMain.handle('agent:check-permissions', async () => {
      console.log('[Main] agent:check-permissions called');
      
      // First try the actual robotjs test - this is more reliable than the system check
      const robotjsWorks = await this.agentExecutor.testPermissions();
      if (robotjsWorks) {
        console.log('[Main] ✅ Robotjs test passed - permissions OK');
        return { hasPermission: true, platform: 'macOS' };
      }
      
      // If robotjs test failed, do the system check (which may prompt)
      const result = await this.agentExecutor.checkPermissions();
      console.log('[Main] Permission check result:', result);
      return result;
    });

    ipcMain.handle('agent:request-plan', async (_event, request: ActionPlanRequest) => {
      console.log('[Main] agent:request-plan called');
      console.log('[Main] Request context length:', request.conversationContext?.length);
      console.log('[Main] Request has screenshot:', !!request.screenshot);
      
      try {
        // Remember which app was active before user clicked on BuildBuddy
        console.log('[Main] Remembering previous app...');
        await this.agentExecutor.rememberPreviousApp();
        
        console.log('[Main] Calling AI for action plan...');
        const plan = await this.aiClient.requestActionPlan(request);
        console.log('[Main] ✅ Got plan with', plan.actions?.length, 'actions');
        console.log('[Main] Plan goal:', plan.goal);
        return plan;
      } catch (error) {
        console.error('[Main] ❌ Action plan request failed:', error);
        return { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });

    ipcMain.handle('agent:execute', async (_event, { actions, displayBounds, screenshotDimensions, scaleFactor }: { 
      actions: AgentAction[], 
      displayBounds?: { x: number; y: number; width: number; height: number },
      screenshotDimensions?: { width: number; height: number },
      scaleFactor?: number
    }) => {
      console.log('[Main] agent:execute called with', actions.length, 'actions');
      console.log('[Main] Display bounds:', displayBounds);
      console.log('[Main] Screenshot dimensions:', screenshotDimensions);
      console.log('[Main] Scale factor:', scaleFactor);
      
      // Set display bounds, screenshot dimensions, and scale factor for coordinate scaling
      this.agentExecutor.setDisplayBounds(displayBounds || null, screenshotDimensions, scaleFactor);
      
      // Set up progress callback to forward to renderer
      this.agentExecutor.setProgressCallback((progress) => {
        console.log('[Main] Progress:', progress.status, progress.currentStep, '/', progress.totalSteps);
        mainWindow.webContents.send('agent:progress', progress);
      });

      const result = await this.agentExecutor.execute(actions);
      trackFeatureUsed('agent_execute');
      console.log('[Main] Execution result:', result.success ? '✅ Success' : '❌ Failed', result.error || '');
      return result;
    });

    ipcMain.on('agent:stop', () => {
      console.log('[Main] agent:stop called');
      this.agentExecutor.stop();
    });

    // ===== Documentation Image Handlers =====
    ipcMain.handle('docs:fetch-images', async (_event, query: string) => {
      try {
        return await this.docImageService.fetchImagesForQuery(query);
      } catch (error) {
        console.error('[DocImages] Failed:', query, error);
        return [];
      }
    });

    // ===== Unreal Engine Command Handlers =====
    console.log('[Main] UE command handlers registered');

    ipcMain.handle('ue:is-connected', () => {
      return this.ueCommandService.isConnected();
    });

    ipcMain.handle('ue:execute-command', async (_event, command: UECommandType, params: Record<string, unknown>) => {
      console.log('[Main] ue:execute-command called:', command, params);
      trackRemoteControlCommand(command);
      return this.ueCommandService.executeCommand(command, params);
    });

    // Convenience handlers for common operations
    ipcMain.handle('ue:create-blueprint', async (_event, name: string, parentClass?: string, path?: string) => {
      return this.ueCommandService.createBlueprint(name, parentClass, path);
    });

    ipcMain.handle('ue:open-blueprint', async (_event, assetPath: string) => {
      return this.ueCommandService.openBlueprint(assetPath);
    });

    ipcMain.handle('ue:spawn-actor', async (_event, actorType: string, name?: string, location?: { x: number; y: number; z: number }) => {
      return this.ueCommandService.spawnActor(actorType, name, location);
    });

    ipcMain.handle('ue:get-level-actors', async () => {
      return this.ueCommandService.getLevelActors();
    });

    ipcMain.handle('ue:save-all', async () => {
      return this.ueCommandService.saveAll();
    });

    ipcMain.handle('ue:play-in-editor', async () => {
      return this.ueCommandService.playInEditor();
    });

    ipcMain.handle('ue:stop-play-in-editor', async () => {
      return this.ueCommandService.stopPlayInEditor();
    });

    ipcMain.handle('ue:compile-project', async () => {
      return this.ueCommandService.compileProject();
    });

    ipcMain.handle('ue:get-project-info', async () => {
      return this.ueCommandService.getProjectInfo();
    });

    ipcMain.handle('ue:get-assets', async (_event, path?: string, type?: string) => {
      return this.ueCommandService.getAssets(path, type);
    });

    // ===== Unreal MCP =====
    ipcMain.handle('unreal-mcp:get-status', () => this.unrealMCPService.getStatus());

    ipcMain.handle('unreal-mcp:start', async () => {
      const s = await this.storageService.getSettings();
      return this.unrealMCPService.start(s.unrealEnginePath ?? '', s.ueProjectPath ?? '');
    });

    ipcMain.handle('unreal-mcp:stop', async () => {
      await this.unrealMCPService.stop();
      return { success: true };
    });

    ipcMain.handle('unreal-mcp:test-connection', () => this.unrealMCPService.testConnection());

    ipcMain.handle('unreal-mcp:call-tool', (_e, name: string, args: Record<string, unknown>) =>
      this.unrealMCPService.callTool(name, args)
    );

    ipcMain.handle('unreal-mcp:execute-intent', async (
      _e,
      { conversationHistory, intent }: { conversationHistory: { role: string; content: string }[]; intent: string }
    ) => {
      try {
        console.log('[MCP Intent] Generating Python script for:', intent.slice(0, 80));
        const cameraInfo = await this.unrealMCPService.getViewportCameraInfo();
        if (cameraInfo) {
          console.log('[MCP Intent] Camera info fetched:', JSON.stringify(cameraInfo));
        }
        const script = await this.aiClient.requestUEPythonScript(conversationHistory, intent, undefined, cameraInfo ?? undefined);
        console.log('[MCP Intent] Script generated, executing...');
        const result = await this.unrealMCPService.callTool('editor_run_python', { code: script });
        trackRemoteControlCommand('mcp_execute_intent');
        const output = (result.data as any)?.content?.[0]?.text ?? '';
        console.log('[MCP Intent] Execution result:', result.success, output.slice(0, 100));
        return { success: result.success, script, output, error: result.error };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[MCP Intent] Error:', error);
        return { success: false, script: '', output: '', error };
      }
    });
  }

  private setupConnectorEventForwarding(): void {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

    this.webSocketServer.onStatusChange((status, client) => {
      mainWindow.webContents.send('connector:status', { status, client });
    });

    this.webSocketServer.onContextUpdate((context) => {
      mainWindow.webContents.send('connector:context', context);
    });

    this.unrealMCPService.onStatusChange((status) => {
      mainWindow.webContents.send('unreal-mcp:status', status);
    });
  }

  get isUpdating(): boolean {
    return this.autoUpdaterService.updating;
  }

  async cleanup(): Promise<void> {
    this.hotkeyManager.unregisterAll();
    await this.webSocketServer.stop();
    await this.unrealMCPService.stop();
    this.screenshotService.clearTempFiles();
  }
}

// Application instance
let gorkaCopilot: GorkaCopilotApp;

// Handle app ready
app.whenReady().then(async () => {
  gorkaCopilot = new GorkaCopilotApp();
  await gorkaCopilot.initialize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      gorkaCopilot.initialize();
    }
  });
});

// Handle window close
app.on('window-all-closed', () => {
  // Don't call app.quit() during auto-update — let electron-updater handle the quit/relaunch
  if (gorkaCopilot?.isUpdating) {
    console.log('[Main] Skipping app.quit() — auto-updater is handling restart');
    return;
  }
  // On macOS, quit when all windows are closed (unlike typical Mac behavior)
  app.quit();
});

// Handle before quit - do cleanup
app.on('before-quit', async () => {
  // Skip cleanup during auto-update to avoid interfering with the restart
  if (gorkaCopilot?.isUpdating) {
    console.log('[Main] Skipping cleanup — auto-updater is handling restart');
    return;
  }
  if (gorkaCopilot) {
    await gorkaCopilot.cleanup();
  }
  await shutdownAnalytics();
});
