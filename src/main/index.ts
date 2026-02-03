import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { WindowManager } from './windowManager';
import { WebSocketServer } from './services/websocketServer';
import { ScreenshotService } from './services/screenshotService';
import { HotkeyManager } from './services/hotkeyManager';
import { AIClientService } from './services/aiClient';
import { StorageService } from './services/storageService';
import { AgentExecutor } from './services/agentExecutor';
import type { AIRequest, CaptureMode, Session, UserSettings, HotkeyConfig, ActionPlanRequest, AgentAction } from '../shared/types';

class GorkaCopilotApp {
  private windowManager: WindowManager;
  private webSocketServer: WebSocketServer;
  private screenshotService: ScreenshotService;
  private hotkeyManager: HotkeyManager;
  private aiClient: AIClientService;
  private storageService: StorageService;
  private agentExecutor: AgentExecutor;

  constructor() {
    this.windowManager = new WindowManager();
    this.webSocketServer = new WebSocketServer();
    this.screenshotService = new ScreenshotService();
    this.hotkeyManager = new HotkeyManager();
    this.aiClient = new AIClientService();
    this.storageService = new StorageService();
    this.agentExecutor = new AgentExecutor();
  }

  async initialize(): Promise<void> {
    // Initialize storage first
    await this.storageService.initialize();

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
        mainWindow.webContents.send('capture:result', result);
      }
    } catch (error) {
      console.error('Capture failed:', error);
    }
  }

  private setupIpcHandlers(): void {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

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

    // AI handlers
    ipcMain.on('ai:ask', async (_event, request: AIRequest) => {
      try {
        const context = request.context || this.webSocketServer.getCurrentContext();
        const fullRequest = { ...request, context };

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
      console.log('[Main] Execution result:', result.success ? '✅ Success' : '❌ Failed', result.error || '');
      return result;
    });

    ipcMain.on('agent:stop', () => {
      console.log('[Main] agent:stop called');
      this.agentExecutor.stop();
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
  }

  async cleanup(): Promise<void> {
    this.hotkeyManager.unregisterAll();
    await this.webSocketServer.stop();
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
app.on('window-all-closed', async () => {
  if (gorkaCopilot) {
    await gorkaCopilot.cleanup();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle before quit
app.on('before-quit', async () => {
  if (gorkaCopilot) {
    await gorkaCopilot.cleanup();
  }
});
