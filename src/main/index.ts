import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, session, clipboard } from 'electron';
import path from 'path';

// Temporary diagnostic log buffer — captures recent console output so users can copy it
// from Settings → "Copy Debug Logs" and paste back when reporting issues.
const DEBUG_LOG_BUFFER: string[] = [];
const DEBUG_LOG_MAX = 1000;
function pushDebugLog(level: string, args: unknown[]): void {
  try {
    const ts = new Date().toISOString();
    const text = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    DEBUG_LOG_BUFFER.push(`[${ts}] [${level}] ${text}`);
    if (DEBUG_LOG_BUFFER.length > DEBUG_LOG_MAX) DEBUG_LOG_BUFFER.shift();
  } catch { /* never let logging crash the app */ }
}
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log = (...args: unknown[]) => { pushDebugLog('log', args); _origLog(...args); };
console.warn = (...args: unknown[]) => { pushDebugLog('warn', args); _origWarn(...args); };
console.error = (...args: unknown[]) => { pushDebugLog('error', args); _origError(...args); };

import { WindowManager } from './windowManager';
import { WebSocketServer } from './services/websocketServer';
import { ScreenshotService } from './services/screenshotService';
import { HotkeyManager } from './services/hotkeyManager';
import { AIClientService, ACTIVE_AI_BACKEND } from './services/aiClient';
import { StorageService } from './services/storageService';
import { AgentExecutor } from './services/agentExecutor';
import { UECommandService } from './services/ueCommandService';
import { EntitlementService } from './services/entitlementService';
import { AutoUpdaterService } from './services/autoUpdaterService';
import { DocImageService } from './services/docImageService';
import { focusUnrealEditor } from './services/windowFocusService';
import { ProjectAnalysisService } from './services/projectAnalysisService';
import { UnrealMCPService } from './services/unrealMCPService';
import { UnrealMCPAdapter } from './services/engines/unrealMCPAdapter';
import { GodotMCPAdapter } from './services/engines/godotMCPAdapter';
import { BlenderMCPAdapter } from './services/engines/blenderMCPAdapter';
import { EngineRegistryService } from './services/engineRegistryService';
import { FairUseService } from './services/fairUseService';
import { YoutubeTranscript } from 'youtube-transcript';
import type { AIRequest, CaptureMode, CaptureResult, ConversationThread, Session, UserSettings, HotkeyConfig, ActionPlanRequest, AgentAction, UECommandType, UnrealContext, SelectedEngine } from '../shared/types';
import {
  initAnalytics, trackAppLaunched, trackAppInstalled, trackPlanIdentified,
  trackFeatureUsed, trackScreenCaptureTaken, trackRemoteControlCommand,
  trackAIRequest, trackFairUseTimeout, trackEngineConnected, estimateCostUsd,
  shutdownAnalytics, classifyPrompt, classifyError,
  trackHotkeyTriggered, trackAIRequestFailed, trackMCPConnectFailed,
  trackScreenshotFailed, trackUpgradeClicked,
  trackEngineSetupStarted, trackEngineSetupFailed,
  trackGuidedStepGenerated, trackGuidedStepVerified,
  trackConversationStarted, trackConversationEnded, hashThreadId,
  trackSnippetViewed, trackSnippetCopied, trackSnippetUpgradeClick,
  trackSnippetDirectBuildAttempt, trackSnippetDirectBuildSuccess, trackSnippetDirectBuildError,
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
  private engineRegistry: EngineRegistryService;
  private fairUseService: FairUseService;
  private tray: Tray | null = null;

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
    this.fairUseService = new FairUseService(this.storageService, this.entitlementService);
    this.autoUpdaterService = new AutoUpdaterService();
    this.docImageService = new DocImageService();
    this.projectAnalysisService = new ProjectAnalysisService();
    this.unrealMCPService = new UnrealMCPService();
    const unrealAdapter = new UnrealMCPAdapter(this.unrealMCPService, this.windowManager);
    this.engineRegistry = new EngineRegistryService(unrealAdapter);

    // Give the Godot adapter the correct path to the bundled gopeak CLI
    const gopeakCli = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'gopeak', 'build', 'cli.js')
      : path.join(process.cwd(), 'node_modules', 'gopeak', 'build', 'cli.js');
    (this.engineRegistry.getAdapterFor('godot') as GodotMCPAdapter).setGopeakCliPath(gopeakCli);
  }

  async initialize(): Promise<void> {
    // Initialize storage first
    await this.storageService.initialize();

    // Initialize analytics with persistent anonymous device ID
    initAnalytics();
    trackAppLaunched();
    trackAppInstalled(); // fires only on first ever launch (new install)

    // Identify plan tier + link email so PostHog can segment by plan
    const authState = await this.entitlementService.getAuthState();
    if (authState.isLoggedIn && authState.entitlement) {
      trackPlanIdentified(
        authState.entitlement.active ? 'pro' : 'free',
        authState.email ?? undefined,
      );
    }

    // Load settings
    const settings = await this.storageService.getSettings();
    this.aiClient.configure(settings.aiProvider, settings.apiKey);

    // Restore proxy session credentials from storage so AI calls work
    // immediately after restart without requiring a fresh login.
    // If the stored token is missing or expired, refresh it proactively.
    if (authState.isLoggedIn && authState.email) {
      const email = authState.email;
      // Wire up the auto-refresh callback so the AI client can recover from
      // mid-session token expiry without asking the user to log in again.
      this.aiClient.setProxyRefreshCallback((em) => this.entitlementService.refreshProxyToken(em));

      const stored = await this.entitlementService.getProxyToken();
      const isValid = stored && Date.now() < stored.expiresAt - 60_000;
      if (isValid) {
        this.aiClient.setProxyCredentials(stored.token, stored.expiresAt, email);
      } else {
        // Token missing or expired — fetch a fresh one before the first AI call.
        try {
          const fresh = await this.entitlementService.refreshProxyToken(email);
          this.aiClient.setProxyCredentials(fresh.token, fresh.expiresAt, email);
        } catch (err) {
          console.warn('[Startup] Could not refresh proxy session token:', err);
          // If refresh fails but we have a stale token, set it anyway so the
          // refresh callback inside getValidProxyToken() can retry per-call.
          if (stored) {
            this.aiClient.setProxyCredentials(stored.token, stored.expiresAt, email);
          }
        }
      }
    }

    // Set engine from persisted selection
    const savedEngine = settings.selectedEngine ?? null;
    this.engineRegistry.setEngine(savedEngine);
    this.aiClient.setEngine(savedEngine);

    // Load hotkey config
    const hotkeyConfig = await this.storageService.getHotkeyConfig();

    // Load window state
    const windowState = await this.storageService.getWindowState();

    // Create main window
    const mainWindow = this.windowManager.createMainWindow(windowState);

    // Set up system tray (gives users a reliable way to quit on all platforms)
    this.setupTray();

    // Register hotkeys
    this.hotkeyManager.setConfig(hotkeyConfig);
    this.hotkeyManager.registerAll(this.handleHotkeyAction.bind(this));

    // Start WebSocket server — but never fatal. The server binds 127.0.0.1:9876 which
    // collides with Blender's MCP addon. If Blender is the active engine, skip the bind
    // entirely (engine-mcp:start would stop it anyway). For any other engine, swallow a
    // bind failure so the rest of init (IPC handlers, etc.) still runs.
    if (savedEngine === 'blender') {
      console.log('[Main] Skipping WebSocket server start — Blender owns port 9876');
    } else {
      try {
        await this.webSocketServer.start();
      } catch (err) {
        console.error('[Main] WebSocket server failed to start (continuing without it):', err);
      }
    }

    // Setup IPC handlers
    this.setupIpcHandlers();

    // Setup connector event forwarding
    this.setupConnectorEventForwarding();

    // Initialize auto-updater
    this.autoUpdaterService.initialize(mainWindow);
    // Release hotkeys/sockets/tray/MCP child BEFORE Squirrel/NSIS quits, so the new
    // instance can claim those resources after relaunch. Critical on Windows where NSIS
    // will fail to overwrite files held by the MCP child process. Cap at 5s — a hung
    // subsystem must not block the update indefinitely.
    this.autoUpdaterService.setBeforeInstallHook(async () => {
      console.log('[Main] Running pre-install cleanup');
      await Promise.race([
        this.cleanup(),
        new Promise<void>((resolve) => setTimeout(() => {
          console.warn('[Main] Pre-install cleanup timed out after 5s — proceeding anyway');
          resolve();
        }, 5000)),
      ]);
    });

    // Save window state on close
    mainWindow.on('close', async () => {
      const state = this.windowManager.getState();
      await this.storageService.updateWindowState(state);
    });
  }

  private handleHotkeyAction(action: string): void {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

    trackHotkeyTriggered(action);

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
        mainWindow.focus();
        mainWindow.webContents.send('focus-input');
        break;
      case 'quickVoice':
        this.windowManager.show();
        this.windowManager.setCollapsed(false);
        mainWindow.focus();
        mainWindow.webContents.send('start-voice');
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
      trackScreenshotFailed({ mode, errorClass: classifyError(error) });
    }
  }

  private setupTray(): void {
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'tray-icon.png')
      : path.join(process.cwd(), 'build', 'icon.png');

    let trayImage = nativeImage.createFromPath(iconPath);
    if (trayImage.isEmpty()) {
      trayImage = nativeImage.createEmpty();
    } else {
      trayImage = trayImage.resize({ width: 16, height: 16 });
    }

    this.tray = new Tray(trayImage);
    this.tray.setToolTip('BuildBuddy');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show BuildBuddy',
        click: () => { this.windowManager.show(); },
      },
      { type: 'separator' },
      {
        label: 'Quit BuildBuddy',
        click: () => { app.quit(); },
      },
    ]);
    this.tray.setContextMenu(contextMenu);

    // Clicking the tray icon shows the window
    this.tray.on('click', () => { this.windowManager.show(); });
  }

  private setupIpcHandlers(): void {
    const mainWindow = this.windowManager.getMainWindow();
    if (!mainWindow) return;

    // App info
    ipcMain.handle('app:get-version', () => {
      return app.getVersion();
    });

    // Clipboard fallback — renderer calls this when navigator.clipboard fails.
    ipcMain.handle('clipboard:write-text', (_event, text: string) => {
      try {
        clipboard.writeText(String(text ?? ''));
        return true;
      } catch {
        return false;
      }
    });

    ipcMain.on('app:quit', () => {
      app.quit();
    });

    ipcMain.on('window:grow-for-conversation', () => {
      this.windowManager.growForConversation();
    });

    ipcMain.on('window:set-focusable', (_event, focusable: boolean) => {
      this.windowManager.setFocusable(focusable);
    });

    ipcMain.on('window:enter-settings', () => {
      this.windowManager.setSettingsMode(true);
    });

    ipcMain.on('window:resize-settings', (_event, payload: { width: number; height: number }) => {
      this.windowManager.resizeSettingsPanel(payload.width, payload.height);
    });

    ipcMain.on('window:exit-settings', () => {
      this.windowManager.setSettingsMode(false);
    });

    ipcMain.on('window:enter-login', () => {
      this.windowManager.setLoginMode(true);
    });

    ipcMain.on('window:enter-video-mode', () => {
      this.windowManager.setVideoMode(true);
    });

    ipcMain.on('window:exit-video-mode', () => {
      this.windowManager.setVideoMode(false);
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

    ipcMain.handle('ue:browse-engine-path', async () => {
      const { dialog } = await import('electron');
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Unreal Engine Folder',
        buttonLabel: 'Select',
      });
      return result.canceled ? null : result.filePaths[0];
    });

    ipcMain.handle('ue:detect-engine-path', async () => {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      const bases = process.platform === 'darwin'
        ? ['/Users/Shared/Epic Games']
        : ['C:\\Program Files\\Epic Games', 'C:\\Program Files (x86)\\Epic Games'];

      for (const base of bases) {
        try {
          const entries = await fs.readdir(base);
          const ueDir = entries
            .filter((e) => /^UE_\d/i.test(e))
            .sort()
            .reverse()[0]; // Highest version first
          if (ueDir) return join(base, ueDir);
        } catch {
          // Directory doesn't exist on this machine, try next
        }
      }
      return null;
    });

    ipcMain.handle('ue:detect-uefn-path', async () => {
      const { promises: fs } = await import('fs');
      const { join } = await import('path');
      const bases = process.platform === 'darwin'
        ? ['/Users/Shared/Epic Games']
        : ['C:\\Program Files\\Epic Games', 'C:\\Program Files (x86)\\Epic Games'];

      for (const base of bases) {
        try {
          const entries = await fs.readdir(base);
          if (entries.includes('UEFN')) return join(base, 'UEFN');
        } catch {
          // Directory doesn't exist on this machine, try next
        }
      }
      return null;
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

    ipcMain.on('window:restore-opacity', () => {
      this.windowManager.getMainWindow()?.setOpacity(1);
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

    // Paste-hint overlay handlers
    ipcMain.on('paste-hint:show', (_e, durationMs?: number) => {
      this.windowManager.showPasteHint(typeof durationMs === 'number' ? durationMs : undefined);
    });

    ipcMain.on('paste-hint:hide', () => {
      this.windowManager.hidePasteHint();
    });

    // Cursor overlay handlers
    ipcMain.handle('cursor:show', (_event, params: { xRatio: number; yRatio: number; label: string; displayBounds: { x: number; y: number; width: number; height: number } }) => {
      this.windowManager.showCursor(params.xRatio, params.yRatio, params.label ?? '', params.displayBounds);
    });

    ipcMain.handle('cursor:hide', () => {
      this.windowManager.hideCursor();
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
    // Uses setOpacity(0) instead of hide() so the window stays in the macOS
    // window layer (preserving position and alwaysOnTop level) while becoming
    // invisible to desktopCapturer.  hide()+show() causes the window to lose
    // its floating level or shift position on macOS, making it appear to vanish.
    ipcMain.handle('capture:fullscreen-sync', async () => {
      try {
        // Get the display where our window currently is
        const windowBounds = mainWindow.getBounds();
        const windowCenterX = windowBounds.x + windowBounds.width / 2;
        const windowCenterY = windowBounds.y + windowBounds.height / 2;
        console.log('[Screenshot] Window center:', windowCenterX, windowCenterY);

        const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
        console.log('[Screenshot] Target display:', currentDisplay.id);

        // Make the window invisible without removing it from the window layer.
        // This avoids the macOS hide()+show() issue where the window loses its
        // floating level or shifts position and appears to vanish permanently.
        const wasVisible = mainWindow.isVisible();
        console.log('[Screenshot] Window visible:', wasVisible);
        if (wasVisible) {
          mainWindow.setOpacity(0);
          // Give the compositor time to update before capturing
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Capture the screenshot of the display where our window is
        console.log('[Screenshot] Starting capture...');
        const result = await this.screenshotService.captureFullScreen(currentDisplay.id);
        console.log('[Screenshot] Capture complete:', result ? `${result.imageBase64.length} bytes` : 'null');
        if (result) trackScreenCaptureTaken('fullscreen-sync');

        // Restore window opacity and bring back to front
        if (wasVisible) {
          mainWindow.setOpacity(1);
          mainWindow.moveTop();
        }

        return result;
      } catch (error) {
        console.error('[Screenshot] Capture failed:', error);
        trackScreenshotFailed({ mode: 'fullscreen-sync', errorClass: classifyError(error) });
        // Only restore opacity if we changed it
        if (wasVisible) {
          mainWindow.setOpacity(1);
          mainWindow.moveTop();
        }
        return null;
      }
    });

    // Fullscreen capture WITHOUT hiding the notch window (used by guided step verification)
    ipcMain.handle('capture:fullscreen-no-hide', async () => {
      try {
        const windowBounds = mainWindow.getBounds();
        const windowCenterX = windowBounds.x + windowBounds.width / 2;
        const windowCenterY = windowBounds.y + windowBounds.height / 2;
        const currentDisplay = screen.getDisplayNearestPoint({ x: windowCenterX, y: windowCenterY });
        const result = await this.screenshotService.captureFullScreen(currentDisplay.id);
        if (result) trackScreenCaptureTaken('fullscreen-no-hide');
        return result;
      } catch (error) {
        console.error('[Screenshot] No-hide capture failed:', error);
        trackScreenshotFailed({ mode: 'fullscreen-no-hide', errorClass: classifyError(error) });
        return null;
      }
    });

    // High-resolution fullscreen capture for cursor targeting (physical pixel size for AI precision)
    ipcMain.handle('capture:fullscreen-hires', async () => {
      try {
        const windowBounds = mainWindow.getBounds();
        const currentDisplay = screen.getDisplayNearestPoint({
          x: windowBounds.x + windowBounds.width / 2,
          y: windowBounds.y + windowBounds.height / 2,
        });
        const scaleFactor = currentDisplay.scaleFactor || 1;
        return await this.screenshotService.captureFullScreen(currentDisplay.id, scaleFactor);
      } catch (error) {
        console.error('[Screenshot] Hi-res capture failed:', error);
        return null;
      }
    });

    // Auth / Entitlement handlers
    ipcMain.handle('auth:login', async (_event, email: string) => {
      const state = await this.entitlementService.login(email);
      if (state.entitlement) {
        trackPlanIdentified(state.entitlement.active ? 'pro' : 'free', email);
      }
      // Wire fresh proxy token into the AI client so requests go through the
      // backend proxy — no API key ever lives in the app bundle.
      const proxyToken = await this.entitlementService.getProxyToken();
      if (proxyToken) {
        this.aiClient.setProxyCredentials(proxyToken.token, proxyToken.expiresAt, email);
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

    ipcMain.handle('fairuse:get-state', async () => {
      return this.storageService.getFairUseState();
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

        // Fair-use check (Pro users only; free users are handled by entitlement weekly limit)
        const earlyTools = this.engineRegistry.getTools();
        const earlyMcpConnected = this.engineRegistry.getStatus() === 'connected' && earlyTools.length > 0;
        const fairUseType: 'rc' | 'chat' = (earlyMcpConnected && request.agentMode !== 'guide') ? 'rc' : 'chat';
        const fairUse = await this.fairUseService.checkRequest(fairUseType);
        if (!fairUse.allowed) {
          const authStateForTimeout = await this.entitlementService.getAuthState();
          const fairUseState = await this.storageService.getFairUseState();
          trackFairUseTimeout({
            requestType: fairUseType,
            plan: authStateForTimeout.entitlement?.active ? 'pro' : 'free',
            email: authStateForTimeout.email ?? null,
            unlockedAt: fairUse.unlockedAt ?? 0,
            violationCount: fairUseState.violations.length,
          });
          mainWindow.webContents.send('ai:error', {
            message: fairUse.reason || 'Fair-use rate limit reached',
            type: 'fair_use_timeout',
            unlockedAt: fairUse.unlockedAt,
          });
          return;
        }

        // Record the ask
        await this.entitlementService.recordAsk();
        trackFeatureUsed('ai_ask');

        // Analytics setup — gather context before streaming, fire event after
        const authState = await this.entitlementService.getAuthState();
        const promptLengthChars = request.prompt.length;
        const estimatedInputTokens = this.aiClient.estimateTokens(request.prompt);
        let accumulatedResponse = '';
        let activeModel = ACTIVE_AI_BACKEND === 'openrouter' ? 'google/gemini-2.5-flash'
          : this.entitlementService.isPro() ? 'gpt-4o' : 'gpt-4o-mini';

        // Set model based on entitlement tier
        if (ACTIVE_AI_BACKEND === 'gemini' || ACTIVE_AI_BACKEND === 'anthropic') {
          // Both tiers use the same primary model; no override needed.
          this.aiClient.setModelOverride(null);
        } else if (!this.entitlementService.isPro()) {
          this.aiClient.setModelOverride('gpt-4o-mini');
        } else {
          this.aiClient.setModelOverride(null);
        }

        const activeEngine = this.engineRegistry.getEngine();
        const isUnrealSession = !activeEngine || activeEngine === 'unreal';

        // UE WebSocket runtime context (build errors etc.) is UE-specific —
        // only fall back to it when this is an Unreal session. User-supplied
        // context (request.context) is kept regardless.
        const context = request.context || (isUnrealSession ? this.webSocketServer.getCurrentContext() : null);

        // Inject UE project context — only when Unreal is the selected engine
        // (or no engine selected yet). Otherwise the user's Blender/Godot/etc.
        // session gets UE project analysis glued onto every prompt, which
        // confuses the AI and makes it respond as if the user is in UE.
        const currentSettings = await this.storageService.getSettings();
        let projectContext: string | undefined;
        const shouldInjectUEContext = isUnrealSession && (
          currentSettings.ueProjectPath
            ? true
            : isUERelatedQuery(request.prompt, context)
        );
        if (shouldInjectUEContext && currentSettings.ueProjectPath) {
          try {
            const freshAnalysis = await this.projectAnalysisService.analyzeProject(currentSettings.ueProjectPath);
            await this.storageService.saveProjectAnalysis(freshAnalysis);
            projectContext = this.projectAnalysisService.generateContextText(freshAnalysis);
          } catch {
            const cachedAnalysis = await this.storageService.getProjectAnalysis();
            if (cachedAnalysis) {
              projectContext = this.projectAnalysisService.generateContextText(cachedAnalysis);
            }
          }
        } else if (shouldInjectUEContext) {
          const cachedAnalysis = await this.storageService.getProjectAnalysis();
          if (cachedAnalysis) {
            projectContext = this.projectAnalysisService.generateContextText(cachedAnalysis);
          }
        }

        // When MCP is connected, use tool-calling flow so the AI can execute
        // actions in the editor and observe results iteratively.
        const mcpTools = this.engineRegistry.getTools();
        const mcpConnected = this.engineRegistry.getStatus() === 'connected' && mcpTools.length > 0;
        console.log(`[ai:ask] engine=${this.engineRegistry.getEngine()} mcpStatus=${this.engineRegistry.getStatus()} tools=${mcpTools.length} mcpConnected=${mcpConnected}`);

        let editorSnapshot = '';
        if (mcpConnected) {
          editorSnapshot = await this.engineRegistry.getEditorSnapshot();
        }

        const fullRequest = { ...request, context, projectContext, editorSnapshot, mcpConnected };

        // In guide mode, skip tool calling even when MCP is connected —
        // the AI will explain steps for the user to follow manually.
        const useTools = mcpConnected && request.agentMode !== 'guide';

        if (useTools) {
          if (ACTIVE_AI_BACKEND === 'openrouter') activeModel = 'minimax/minimax-m2.5';
          const executeTool = async (name: string, args: Record<string, unknown>) => {
            trackRemoteControlCommand(`mcp_tool_${name}`);
            return this.engineRegistry.callTool(name, args);
          };

          try {
            for await (const chunk of this.aiClient.askWithTools(fullRequest, mcpTools, executeTool)) {
              accumulatedResponse += chunk;
              mainWindow.webContents.send('ai:stream', chunk);
            }
          } catch (toolsError) {
            // Tool-calling path failed (e.g. model/schema issue) — fall back to plain ask
            console.error('[ai:ask] askWithTools failed, falling back to ask:', toolsError);
            mainWindow.webContents.send('ai:stream', '');  // clear any partial stream
            accumulatedResponse = '';
            for await (const chunk of this.aiClient.ask(fullRequest)) {
              accumulatedResponse += chunk;
              mainWindow.webContents.send('ai:stream', chunk);
            }
          }
        } else {
          for await (const chunk of this.aiClient.ask(fullRequest)) {
            accumulatedResponse += chunk;
            mainWindow.webContents.send('ai:stream', chunk);
          }
        }

        mainWindow.webContents.send('ai:complete', { success: true });

        // Fire analytics AFTER ai:complete — zero latency impact on the user
        const requestType: 'chat' | 'rc' | 'guided' =
          request.agentMode === 'guide' ? 'guided' : (useTools ? 'rc' : 'chat');
        const estimatedOutputTokens = this.aiClient.estimateTokens(accumulatedResponse);
        trackAIRequest({
          requestType,
          model: activeModel,
          engineType: this.engineRegistry.getEngine() as string | null,
          engineConnected: mcpConnected,
          hadScreenshot: !!request.screenshot,
          promptLengthChars,
          promptCategory: classifyPrompt(request.prompt),
          estimatedInputTokens,
          estimatedOutputTokens,
          estimatedCostUsd: estimateCostUsd(activeModel, estimatedInputTokens, estimatedOutputTokens),
          plan: authState.entitlement?.active ? 'pro' : 'free',
          email: authState.email ?? null,
        });
      } catch (error) {
        mainWindow.webContents.send('ai:error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        try {
          const authState = await this.entitlementService.getAuthState();
          const mcpTools = this.engineRegistry.getTools();
          const mcpConnected = this.engineRegistry.getStatus() === 'connected' && mcpTools.length > 0;
          const failedRequestType: 'chat' | 'rc' | 'guided' =
            request.agentMode === 'guide' ? 'guided' : (mcpConnected ? 'rc' : 'chat');
          const failedModel = ACTIVE_AI_BACKEND === 'openrouter'
            ? (mcpConnected ? 'minimax/minimax-m2.5' : 'google/gemini-2.5-flash')
            : (this.entitlementService.isPro() ? 'gpt-4o' : 'gpt-4o-mini');
          trackAIRequestFailed({
            requestType: failedRequestType,
            model: failedModel,
            errorClass: classifyError(error),
            plan: authState.entitlement?.active ? 'pro' : 'free',
            email: authState.email ?? null,
          });
        } catch {
          // best-effort analytics — never crash the error path
        }
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

    // Renderer-side analytics relay — only a whitelist of events is accepted so
    // arbitrary events can't be injected from the renderer.
    ipcMain.on('analytics:track', async (_event, payload: { event: string; properties?: Record<string, unknown> }) => {
      try {
        const authState = await this.entitlementService.getAuthState();
        const plan: 'free' | 'pro' = authState.entitlement?.active ? 'pro' : 'free';
        const email = authState.email ?? null;
        const props = payload?.properties ?? {};
        switch (payload?.event) {
          case 'upgrade_clicked':
            trackUpgradeClicked({
              source: (props.source as 'weekly_limit_banner' | 'settings' | 'login_screen' | 'upgrade_prompt' | 'other') ?? 'other',
              plan,
              email,
            });
            break;
          case 'engine_setup_started':
            trackEngineSetupStarted({ engineType: String(props.engineType ?? 'unknown') });
            break;
          case 'engine_setup_failed':
            trackEngineSetupFailed({
              engineType: String(props.engineType ?? 'unknown'),
              stage: (props.stage as 'select' | 'path' | 'mcp' | 'handshake' | 'deps' | 'other') ?? 'other',
              errorClass: (props.errorClass as 'timeout' | 'rate_limit' | 'auth' | 'network' | 'other') ?? 'other',
            });
            break;
          case 'guided_step_verified':
            trackGuidedStepVerified({
              stepIndex: Number(props.stepIndex ?? 0),
              success: Boolean(props.success),
              engineType: this.engineRegistry.getEngine() as string | null,
              msSinceGenerated: Number(props.msSinceGenerated ?? 0),
            });
            break;
          case 'snippet_viewed':
            trackSnippetViewed({
              snippetId: String(props.snippetId ?? ''),
              category: String(props.category ?? 'Unknown'),
              plan,
              email,
            });
            break;
          case 'snippet_copied':
            trackSnippetCopied({
              snippetId: String(props.snippetId ?? ''),
              category: String(props.category ?? 'Unknown'),
              t3dLength: Number(props.t3dLength ?? 0),
              targetBlueprint: String(props.targetBlueprint ?? 'unknown'),
              plan,
            });
            break;
          case 'snippet_upgrade_click':
            trackSnippetUpgradeClick({
              snippetId: String(props.snippetId ?? ''),
              plan,
            });
            break;
          case 'snippet_direct_build_attempt':
            trackSnippetDirectBuildAttempt({
              snippetId: String(props.snippetId ?? ''),
              nodeCount: Number(props.nodeCount ?? 0),
              plan,
            });
            break;
          case 'snippet_direct_build_success':
            trackSnippetDirectBuildSuccess({
              snippetId: String(props.snippetId ?? ''),
              nodeCount: Number(props.nodeCount ?? 0),
              plan,
            });
            break;
          case 'snippet_direct_build_error':
            trackSnippetDirectBuildError({
              snippetId: String(props.snippetId ?? ''),
              errorHead: String(props.errorHead ?? '').slice(0, 200),
              plan,
            });
            break;
          default:
            // drop unknown events silently — prevents arbitrary capture from renderer
            break;
        }
      } catch (err) {
        console.error('[analytics:track] relay failed:', err);
      }
    });

    // Thread handlers
    ipcMain.handle('threads:save', async (_event, thread: ConversationThread) => {
      const existed = !!(await this.storageService.getThread(thread.id));
      await this.storageService.saveThread(thread);
      if (!existed) {
        const authState = await this.entitlementService.getAuthState();
        trackConversationStarted({
          threadId: hashThreadId(thread.id),
          engineType: this.engineRegistry.getEngine() as string | null,
          plan: authState.entitlement?.active ? 'pro' : 'free',
          email: authState.email ?? null,
        });
      }
    });

    ipcMain.handle('threads:get', async (_event, id: string) => {
      return this.storageService.getThread(id);
    });

    ipcMain.handle('threads:list', async (_event, limit?: number) => {
      return this.storageService.getThreads(limit);
    });

    ipcMain.handle('threads:delete', async (_event, id: string) => {
      const existing = await this.storageService.getThread(id);
      await this.storageService.deleteThread(id);
      if (existing) {
        trackConversationEnded({
          threadId: hashThreadId(id),
          messageCount: existing.messages?.length ?? 0,
          durationMs: Math.max(0, (existing.updatedAt ?? 0) - (existing.createdAt ?? 0)),
        });
      }
    });

    ipcMain.handle('threads:set-active', async (_event, id: string | null) => {
      await this.storageService.setActiveThreadId(id);
    });

    ipcMain.handle('threads:get-active', async () => {
      return this.storageService.getActiveThreadId();
    });

    // AI summarize handler
    ipcMain.handle('ai:summarize', async (_event, params: { messages: Array<{ role: string; content: string }>; existingSummary?: string }) => {
      return this.aiClient.summarizeConversation(params.messages, params.existingSummary);
    });

    // AI step verification handler
    ipcMain.handle('ai:verify-step', async (_event, params: { stepText: string; screenshot: CaptureResult | null }) => {
      if (!params.screenshot) return 'Looks good!';
      return this.aiClient.verifyStep(params.stepText, params.screenshot);
    });

    // AI next step generation handler.
    // Streams internally so cursor computation starts mid-stream (as soon as step
    // text is extracted). Returns the step text immediately on stream end — cursor
    // fires from the main process directly when CU resolves, decoupled from the
    // IPC response so step text appears ASAP without waiting for cursor.
    ipcMain.handle('ai:generate-next-step', async (_event, params: { goal: string; currentStep: string; stepHistory: string[]; screenshot: CaptureResult | null }) => {
      if (!params.screenshot) return { nextStep: null, isComplete: true, completionMessage: 'Task complete!' };
      const screenshot = params.screenshot;
      let cursorPromise: Promise<any> | null = null;

      trackGuidedStepGenerated({
        stepIndex: params.stepHistory?.length ?? 0,
        engineType: this.engineRegistry.getEngine() as string | null,
      });

      const result = await this.aiClient.generateNextStep(
        params as { goal: string; currentStep: string; stepHistory: string[]; screenshot: CaptureResult },
        (earlyStepText) => {
          // Step text arrived mid-stream — start Computer Use immediately in parallel
          cursorPromise = this.aiClient.generateClickTarget(earlyStepText, screenshot);
        },
      );

      // Show cursor from main process without blocking the step-text response.
      // CU has been running since mid-stream, so it will resolve very shortly after
      // the stream ends (or may already be done).
      // cursorFiredByMain tells the renderer to skip its own CU call.
      let cursorFiredByMain = false;
      if (cursorPromise && result.nextStep && screenshot?.displayBounds) {
        cursorFiredByMain = true;
        (cursorPromise as Promise<any>).then((cursorTarget) => {
          if (cursorTarget) {
            this.windowManager.showCursor(
              cursorTarget.xRatio,
              cursorTarget.yRatio,
              cursorTarget.description ?? '',
              screenshot.displayBounds!,
            );
          }
        }).catch(() => null);
      }

      // Return step result immediately — cursor will appear independently
      return { ...result, cursorFiredByMain };
    });

    // AI click target detection handler
    ipcMain.handle('ai:generate-click-target', async (_event, params: { stepText: string; screenshot: CaptureResult }) => {
      return this.aiClient.generateClickTarget(params.stepText, params.screenshot);
    });

    ipcMain.handle('youtube:fetch-transcript', async (_event, videoId: string) => {
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      return (segments as Array<{ text: string; offset: number }>)
        .map((s) => ({ text: s.text, offset: Math.round(s.offset / 1000) })); // offset → seconds
    });

    ipcMain.handle('ai:generate-steps-from-transcript', async (_event, params: { segments: Array<{ text: string; offset: number }>; goal: string }) => {
      return this.aiClient.generateStepsFromTranscript(params.segments, params.goal);
    });

    ipcMain.handle('ai:transcribe-audio', async (_event, params: { audioBase64: string; mimeType: string }) => {
      return this.aiClient.transcribeAudio(params.audioBase64, params.mimeType);
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
      if (!s.devMode && !this.entitlementService.isPro()) {
        return { success: false, error: 'pro_required' };
      }
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

    ipcMain.handle('unreal-mcp:get-tools', () => this.unrealMCPService.getTools());

    ipcMain.handle('unreal:select-project-folder', async () => {
      const { dialog } = await import('electron');
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const projectPath = result.filePaths[0];
      const s = await this.storageService.getSettings();
      await this.storageService.setSettings({ ...s, ueProjectPath: projectPath });
      return { projectPath };
    });

    ipcMain.handle('unreal:focus-editor', async () => {
      return focusUnrealEditor();
    });

    // ===== Engine Selection =====
    ipcMain.handle('engine:get-selected', () => this.engineRegistry.getEngine());

    ipcMain.handle('engine:set-selected', async (_e, engine: SelectedEngine) => {
      this.engineRegistry.setEngine(engine);
      this.aiClient.setEngine(engine);
      await this.storageService.updateSettings({ selectedEngine: engine });
      mainWindow.webContents.send('engine:selected', engine);
      return { success: true };
    });

    ipcMain.handle('engine:auto-detect', async () => {
      const screenshot = await this.screenshotService.captureFullScreen();
      return this.engineRegistry.autoDetectEngine(
        screenshot,
        (shot) => this.aiClient.detectEngine(shot)
      );
    });

    ipcMain.handle('engine-mcp:get-status', () => this.engineRegistry.getStatus());

    ipcMain.handle('engine-mcp:start', async () => {
      const s = await this.storageService.getSettings();
      if (!s.devMode && !this.entitlementService.isPro()) {
        return { success: false, error: 'pro_required' };
      }
      // blender-mcp connects to Blender on port 9876 — same as Build Buddy's WebSocket.
      // Stop the WebSocket server while Blender is active to free the port.
      if (this.engineRegistry.getEngine() === 'blender') {
        await this.webSocketServer.stop();
      }
      return this.engineRegistry.start(s);
    });

    ipcMain.handle('engine-mcp:stop', async () => {
      await this.engineRegistry.stop();
      // Restart the WebSocket server if it was stopped for Blender
      if (this.engineRegistry.getEngine() === 'blender') {
        await this.webSocketServer.start();
      }
      return { success: true };
    });

    ipcMain.handle('engine-mcp:call-tool', (_e, name: string, args: Record<string, unknown>) =>
      this.engineRegistry.callTool(name, args)
    );

    ipcMain.handle('debug:copy-logs', () => {
      const header = `BuildBuddy v${app.getVersion()} | platform=${process.platform} arch=${process.arch} | packaged=${app.isPackaged}\n` +
        `engine=${this.engineRegistry.getEngine() ?? 'none'} | mcpStatus=${this.engineRegistry.getStatus()}\n` +
        `--- last ${DEBUG_LOG_BUFFER.length} log lines ---\n`;
      const body = DEBUG_LOG_BUFFER.join('\n');
      clipboard.writeText(header + body);
      return { success: true, lines: DEBUG_LOG_BUFFER.length };
    });

    ipcMain.handle('engine-mcp:open-log', async () => {
      const { shell } = await import('electron');
      const engine = this.engineRegistry.getEngine();
      if (engine === 'blender') {
        const blenderAdapter = this.engineRegistry.getAdapterFor('blender') as BlenderMCPAdapter;
        const logPath = blenderAdapter.getDiagnosticLogPath();
        const result = await shell.openPath(logPath);
        return { success: result === '', error: result || undefined, path: logPath };
      }
      return { success: false, error: 'No diagnostic log available for this engine' };
    });

    ipcMain.handle('engine:check-setup', async (_e, engine: SelectedEngine) => {
      if (engine === 'unreal') {
        // Always show the onboarding card for Unreal — Remote Execution must be enabled
        // manually in UE Editor and there's no file-based way to verify it's done.
        return {
          engine: 'unreal',
          stepsComplete: false,
          pendingSteps: [
            { n: 1, title: 'Open Project Settings', desc: 'In Unreal Editor: Edit → Project Settings → Plugins → Python', isAutomatic: false },
            { n: 2, title: 'Enable Remote Execution', desc: 'Check "Enable Remote Execution" and set Multicast Bind Address to 0.0.0.0', isAutomatic: false },
            { n: 3, title: 'Set Engine Path', desc: 'Browse to your Unreal Engine installation folder (e.g. /Users/Shared/Epic Games/UE_5.4)', isAutomatic: false },
          ],
        };
      }
      return this.engineRegistry.checkSetup(engine);
    });

    ipcMain.handle('engine:install-deps', (_e, engine: SelectedEngine) =>
      this.engineRegistry.installDeps(engine)
    );

    ipcMain.handle('engine:get-setup-steps', (_e, engine: SelectedEngine) =>
      this.engineRegistry.getSetupSteps(engine)
    );

    ipcMain.handle('unity:setup-server', async () => {
      const { dialog } = await import('electron');
      const { existsSync, readdirSync } = await import('fs');
      const { execSync } = await import('child_process');
      const result = await dialog.showOpenDialog({
        title: 'Select your Unity project folder',
        buttonLabel: 'Select Project',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const projectPath = result.filePaths[0];

      // Find Server~ directory in Library/PackageCache or Packages/
      let serverDir: string | null = null;
      const cacheDir = path.join(projectPath, 'Library', 'PackageCache');
      if (existsSync(cacheDir)) {
        const entries = readdirSync(cacheDir).filter(e =>
          e.toLowerCase().includes('mcp-unity@') || e.toLowerCase().includes('mcp_unity@')
        );
        if (entries.length > 0) {
          serverDir = path.join(cacheDir, entries[0], 'Server~');
        }
      }
      if (!serverDir || !existsSync(serverDir)) {
        const localDir = path.join(projectPath, 'Packages', 'mcp-unity', 'Server~');
        if (existsSync(localDir)) serverDir = localDir;
      }
      if (!serverDir || !existsSync(serverDir)) {
        return { success: false, error: 'mcp-unity package not found in this Unity project. Make sure you installed it via Package Manager first.' };
      }

      // Build if needed
      const builtPath = path.join(serverDir, 'build', 'index.js');
      if (!existsSync(builtPath)) {
        try {
          execSync('npm install', { cwd: serverDir, timeout: 120000, stdio: 'ignore' });
          execSync('npm run build', { cwd: serverDir, timeout: 60000, stdio: 'ignore' });
        } catch (err) {
          return { success: false, error: `Failed to build MCP server: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      await this.storageService.updateSettings({ unityProjectPath: projectPath });
      return { success: true, projectPath, serverPath: builtPath };
    });

    ipcMain.handle('godot:install-addon', async () => {
      const { dialog } = await import('electron');
      const result = await dialog.showOpenDialog({
        title: 'Select your Godot project folder',
        buttonLabel: 'Select Project',
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const projectPath = result.filePaths[0];
      // In production the addon is bundled as an extraResource; in dev it's in node_modules
      const addonSrc = app.isPackaged
        ? path.join(process.resourcesPath, 'godot-addon')
        : path.join(process.cwd(), 'node_modules', 'gopeak', 'build', 'addon');
      const godotAdapter = this.engineRegistry.getAdapterFor('godot') as GodotMCPAdapter;
      const installResult = godotAdapter.installAddonToProject(addonSrc, projectPath);
      if (installResult.success) {
        await this.storageService.updateSettings({ godotProjectPath: projectPath });
      }
      return { ...installResult, projectPath };
    });

    ipcMain.handle('blender:show-addon', async () => {
      const { shell } = await import('electron');
      const blenderAdapter = this.engineRegistry.getAdapterFor('blender') as BlenderMCPAdapter;
      const addonPath = blenderAdapter.getAddonPath();
      shell.showItemInFolder(addonPath);
      return { addonPath };
    });

    ipcMain.handle('blender:install-addon', async () => {
      const fsSync = await import('fs');
      const { execSync: exec } = await import('child_process');
      const blenderAdapter = this.engineRegistry.getAdapterFor('blender') as BlenderMCPAdapter;
      const addonSrc = blenderAdapter.getAddonPath();

      if (!fsSync.existsSync(addonSrc)) {
        return { success: false, error: 'addon.py not downloaded yet. Please wait a moment and try again.' };
      }

      // Find Blender executable
      const blenderCandidates = process.platform === 'darwin'
        ? [
            '/Applications/Blender.app/Contents/MacOS/Blender',
            `${app.getPath('home')}/Applications/Blender.app/Contents/MacOS/Blender`,
          ]
        : process.platform === 'win32'
          ? [
              'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe',
              'C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe',
              'C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe',
              'C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe',
            ]
          : ['/usr/bin/blender', '/usr/local/bin/blender'];

      const blenderExe = blenderCandidates.find(p => fsSync.existsSync(p));
      if (!blenderExe) {
        return { success: false, error: 'Could not find Blender. Make sure Blender is installed in the Applications folder.' };
      }

      // Use Blender's own installer — this handles sys.path and preferences correctly
      const addonSrcEscaped = addonSrc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const pythonScript = `import bpy; bpy.ops.preferences.addon_install(filepath='${addonSrcEscaped}', overwrite=True); bpy.ops.preferences.addon_enable(module='blender_mcp'); bpy.ops.wm.save_userpref()`;

      try {
        exec(`"${blenderExe}" --background --python-expr "${pythonScript.replace(/"/g, '\\"')}"`, {
          timeout: 30000,
          stdio: 'pipe',
        });
        return { success: true, versions: ['installed via Blender'] };
      } catch (err) {
        return { success: false, error: `Blender installer failed: ${err instanceof Error ? err.message : String(err)}` };
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

    this.engineRegistry.onStatusChange(async (status, error) => {
      mainWindow.webContents.send('engine-mcp:status', { status, error });
      if (status === 'connected') {
        const authState = await this.entitlementService.getAuthState();
        trackEngineConnected({
          engineType: this.engineRegistry.getEngine() as string,
          plan: authState.entitlement?.active ? 'pro' : 'free',
          email: authState.email ?? null,
        });
      } else if (status === 'error') {
        const authState = await this.entitlementService.getAuthState();
        trackMCPConnectFailed({
          engineType: this.engineRegistry.getEngine() as string,
          errorClass: 'other',
          plan: authState.entitlement?.active ? 'pro' : 'free',
          email: authState.email ?? null,
        });
      }
    });
  }

  get isUpdating(): boolean {
    return this.autoUpdaterService.updating;
  }

  private didCleanup = false;
  async cleanup(): Promise<void> {
    if (this.didCleanup) return;
    this.didCleanup = true;
    this.hotkeyManager.unregisterAll();
    await this.webSocketServer.stop();
    await this.unrealMCPService.stop();
    this.screenshotService.clearTempFiles();
    this.tray?.destroy();
    this.tray = null;
  }
}

// Application instance
let gorkaCopilot: GorkaCopilotApp;

// Handle app ready
app.whenReady().then(async () => {
  // Force the macOS Local Network permission prompt early. macOS gates loopback
  // socket calls in some recent releases — without an explicit grant the
  // Blender MCP probe to 127.0.0.1:9876 fails with EPERM/EACCES. Touching a
  // refused loopback port (1) at startup triggers TCC to surface the prompt
  // before the user clicks Connect, so the grant is in place when needed.
  if (process.platform === 'darwin') {
    try {
      const { Socket } = await import('net');
      const probe = new Socket();
      probe.setTimeout(500);
      probe.once('error', () => probe.destroy());
      probe.once('timeout', () => probe.destroy());
      probe.connect(1, '127.0.0.1');
    } catch { /* best-effort */ }
  }

  // YouTube embeds are blocked in production because the page loads from file://,
  // giving a null Referer that YouTube rejects. Inject a real Referer so the embed loads.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      if (!headers['Referer'] && !headers['referer']) {
        headers['Referer'] = 'https://build-buddy.app';
      }
      callback({ requestHeaders: headers });
    }
  );

  // Grant microphone access for Web Speech API voice input
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

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

// Handle before quit - do cleanup. cleanup() is idempotent, so it's safe to call
// during auto-update too (the beforeInstall hook already invoked it).
app.on('before-quit', async () => {
  if (gorkaCopilot) {
    await gorkaCopilot.cleanup();
  }
  await shutdownAnalytics();
});
