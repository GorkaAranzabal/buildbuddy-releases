import { BrowserWindow, screen, app, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WindowState } from '../shared/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private vignetteWindow: BrowserWindow | null = null;
  private cursorWindow: BrowserWindow | null = null;
  private pasteHintWindow: BrowserWindow | null = null;
  private pasteHintTimer: NodeJS.Timeout | null = null;
  private cursorVisible: boolean = false;
  private cursorWindowLoaded: boolean = false;
  private pendingCursorPayload: { x: number; y: number; label: string } | null = null;
  private isCollapsed: boolean = false;
  private isPinned: boolean = true;
  private isVisible: boolean = true;
  private inSettingsMode: boolean = false;
  private inLoginMode: boolean = false;
  private inVideoMode: boolean = false;
  private preVideoModeBounds: { width: number; height: number } | null = null;
  private isQuitting: boolean = false;

  // Window dimensions - Notch style UI
  // BUTTON_RESERVE reserves space above the notch when expanded so the
  // Blueprints Library hover button can pop upward without being clipped.
  // It is baked into expandedBounds and applied as a Y offset on expand/collapse
  // so the notch stays at the same screen position.
  private static readonly BUTTON_RESERVE = 44;
  private expandedBounds: { width: number; height: number } = { width: 520, height: 600 };

  createMainWindow(savedState?: WindowState): BrowserWindow {
    // Notch dimensions
    const notchWidth = 180;
    const notchHeight = 50;

    // Use center positioning - will be adjusted after window is created
    const x = 800; // Will be centered after creation
    const y = 10;

    this.isCollapsed = true; // Always start in notch mode
    this.isPinned = true;
    this.expandedBounds = { width: 480, height: 400 + WindowManager.BUTTON_RESERVE };

    const config: WindowConfig = {
      width: notchWidth,
      height: notchHeight,
      minWidth: notchWidth,
      minHeight: notchHeight,
      x,
      y,
      alwaysOnTop: true,
      transparent: true,
      frame: false,
      resizable: false,
      skipTaskbar: true,
    };

    this.mainWindow = new BrowserWindow({
      ...config,
      show: false,
      hasShadow: false,
      transparent: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: true,
        backgroundThrottling: false, // keep YouTube infoDelivery firing when window is in background
      },
    });

    // Handle resize constraints
    this.mainWindow.setMinimumSize(notchWidth, notchHeight);

    // On Windows use 'screen-saver' level so the overlay stays above Unreal Engine's
    // fullscreen/maximized renderer. 'floating' is sufficient on macOS.
    const aotLevel = process.platform === 'win32' ? 'screen-saver' : 'floating';
    this.mainWindow.setAlwaysOnTop(true, aotLevel);

    // Center window on screen after creation
    this.mainWindow.center();

    // Load the app
    if (process.env.VITE_DEV_SERVER_URL) {
      this.mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
      // Open DevTools in development
      this.mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
      // In production, load from dist folder
      const indexPath = path.join(__dirname, '../renderer/index.html');
      console.log('Loading from:', indexPath);
      this.mainWindow.loadFile(indexPath);
      // DevTools disabled in production
    }

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    // Open external links in default browser
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      // Open all external URLs in the default browser
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    // Also handle navigation within the window (clicking links)
    this.mainWindow.webContents.on('will-navigate', (event, url) => {
      // If navigating to an external URL, open in browser instead
      if (url.startsWith('http://') || url.startsWith('https://')) {
        // Allow navigation to our own dev server (in development) or local files
        const devServerUrl = process.env.VITE_DEV_SERVER_URL;
        const isOwnDevServer = devServerUrl && url.startsWith(devServerUrl);
        const isLocalFile = url.startsWith('file://');

        if (!isOwnDevServer && !isLocalFile) {
          event.preventDefault();
          shell.openExternal(url);
        }
      }
    });

    // Track position changes
    this.mainWindow.on('moved', () => {
      if (!this.isCollapsed && !this.inLoginMode) {
        const bounds = this.mainWindow?.getBounds();
        if (bounds) {
          this.expandedBounds = { width: bounds.width, height: bounds.height };
        }
      }
    });

    this.mainWindow.on('resized', () => {
      if (!this.isCollapsed && !this.inSettingsMode) {
        const bounds = this.mainWindow?.getBounds();
        if (bounds) {
          this.expandedBounds = { width: bounds.width, height: bounds.height };
        }
      }
    });

    // When the app is actually quitting (app.quit() called), allow windows to close.
    // Otherwise on macOS, hide the window instead of closing it (standard macOS behaviour).
    app.on('before-quit', () => {
      this.isQuitting = true;
    });

    this.mainWindow.on('close', (event) => {
      if (process.platform === 'darwin' && !this.isQuitting && this.mainWindow) {
        event.preventDefault();
        this.mainWindow.hide();
        this.isVisible = false;
      }
    });

    return this.mainWindow;
  }

  createVignetteWindow(): BrowserWindow {
    // Get the primary display dimensions for full-screen overlay
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    this.vignetteWindow = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // Make it click-through (ignore all mouse events)
    this.vignetteWindow.setIgnoreMouseEvents(true);

    // Set the highest level to be above everything
    this.vignetteWindow.setAlwaysOnTop(true, 'screen-saver');

    // Load the vignette HTML
    if (process.env.VITE_DEV_SERVER_URL) {
      this.vignetteWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}vignette.html`);
    } else {
      const vignettePath = path.join(__dirname, '../renderer/vignette.html');
      this.vignetteWindow.loadFile(vignettePath);
    }

    return this.vignetteWindow;
  }

  showVignette(): void {
    if (!this.vignetteWindow) {
      this.createVignetteWindow();
    }

    // Get the display where the main window is currently located
    let targetDisplay = screen.getPrimaryDisplay();

    if (this.mainWindow) {
      const mainBounds = this.mainWindow.getBounds();
      const centerX = mainBounds.x + mainBounds.width / 2;
      const centerY = mainBounds.y + mainBounds.height / 2;

      try {
        targetDisplay = screen.getDisplayNearestPoint({ x: centerX, y: centerY });
      } catch (e) {
        console.warn('Could not get display for vignette, using primary');
      }
    }

    // Position vignette on the same display as the main window
    const { x, y, width, height } = targetDisplay.bounds;

    this.vignetteWindow?.setBounds({ x, y, width, height });

    // Start with 0 opacity and fade in
    this.vignetteWindow?.setOpacity(0);
    this.vignetteWindow?.show();

    // Smooth fade-in animation
    const fadeInDuration = 250; // ms
    const steps = 12;
    const stepDuration = fadeInDuration / steps;
    let currentStep = 0;

    const fadeIn = setInterval(() => {
      currentStep++;
      const opacity = currentStep / steps;

      if (this.vignetteWindow && !this.vignetteWindow.isDestroyed()) {
        this.vignetteWindow.setOpacity(Math.min(1, opacity));
      }

      if (currentStep >= steps) {
        clearInterval(fadeIn);
      }
    }, stepDuration);
  }

  hideVignette(): void {
    if (!this.vignetteWindow) return;

    // Smooth fade-out animation
    const fadeOutDuration = 300; // ms
    const steps = 15;
    const stepDuration = fadeOutDuration / steps;
    let currentStep = 0;

    const fadeOut = setInterval(() => {
      currentStep++;
      const opacity = 1 - (currentStep / steps);

      if (this.vignetteWindow && !this.vignetteWindow.isDestroyed()) {
        this.vignetteWindow.setOpacity(Math.max(0, opacity));
      }

      if (currentStep >= steps) {
        clearInterval(fadeOut);
        if (this.vignetteWindow && !this.vignetteWindow.isDestroyed()) {
          this.vignetteWindow.hide();
          this.vignetteWindow.setOpacity(1); // Reset for next show
        }
      }
    }, stepDuration);
  }

  getVignetteWindow(): BrowserWindow | null {
    return this.vignetteWindow;
  }

  // ===== Cursor Overlay =====

  createCursorWindow(): BrowserWindow {
    this.cursorWindowLoaded = false;

    this.cursorWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    this.cursorWindow.setIgnoreMouseEvents(true);
    this.cursorWindow.setAlwaysOnTop(true, 'screen-saver');

    // Once loaded, flush any pending position that arrived before page was ready
    this.cursorWindow.webContents.on('did-finish-load', () => {
      this.cursorWindowLoaded = true;
      if (this.pendingCursorPayload && this.cursorWindow && !this.cursorWindow.isDestroyed()) {
        this.cursorWindow.webContents.send('cursor:position', { ...this.pendingCursorPayload, show: true });
        this.pendingCursorPayload = null;
      }
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      this.cursorWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}cursor.html`);
    } else {
      const cursorPath = path.join(__dirname, '../renderer/cursor.html');
      this.cursorWindow.loadFile(cursorPath);
    }

    return this.cursorWindow;
  }

  showCursor(xRatio: number, yRatio: number, label: string, displayBounds: { x: number; y: number; width: number; height: number }): void {
    if (!this.cursorWindow) {
      this.createCursorWindow();
    }

    const win = this.cursorWindow!;

    // Compute absolute pixel positions in the main process so cursor.html doesn't
    // need to use vw/vh (which would be relative to the window's initial size, not
    // the final display-covering size).
    const pixelX = Math.round(xRatio * displayBounds.width);
    const pixelY = Math.round(yRatio * displayBounds.height);
    const payload = { x: pixelX, y: pixelY, label };

    // Cover the target display
    win.setBounds({ x: displayBounds.x, y: displayBounds.y, width: displayBounds.width, height: displayBounds.height });

    // Only send if page is loaded; otherwise queue it for did-finish-load
    if (this.cursorWindowLoaded) {
      win.webContents.send('cursor:position', { ...payload, show: true });
    } else {
      this.pendingCursorPayload = payload;
    }

    if (!this.cursorVisible) {
      this.cursorVisible = true;
      win.setOpacity(0);
      win.show();

      const fadeInDuration = 250;
      const steps = 12;
      const stepDuration = fadeInDuration / steps;
      let currentStep = 0;

      const fadeIn = setInterval(() => {
        currentStep++;
        if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
          this.cursorWindow.setOpacity(Math.min(1, currentStep / steps));
        }
        if (currentStep >= steps) clearInterval(fadeIn);
      }, stepDuration);
    }
  }

  updateCursor(xRatio: number, yRatio: number, label: string, displayBounds: { x: number; y: number; width: number; height: number }): void {
    if (this.cursorWindow && !this.cursorWindow.isDestroyed() && this.cursorVisible && this.cursorWindowLoaded) {
      const pixelX = Math.round(xRatio * displayBounds.width);
      const pixelY = Math.round(yRatio * displayBounds.height);
      this.cursorWindow.webContents.send('cursor:position', { x: pixelX, y: pixelY, label, show: true });
    }
  }

  hideCursor(): void {
    if (!this.cursorWindow || !this.cursorVisible) return;
    this.cursorVisible = false;

    const fadeOutDuration = 300;
    const steps = 15;
    const stepDuration = fadeOutDuration / steps;
    let currentStep = 0;

    const fadeOut = setInterval(() => {
      currentStep++;
      if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
        this.cursorWindow.setOpacity(Math.max(0, 1 - currentStep / steps));
      }
      if (currentStep >= steps) {
        clearInterval(fadeOut);
        if (this.cursorWindow && !this.cursorWindow.isDestroyed()) {
          this.cursorWindow.hide();
          this.cursorWindow.setOpacity(1);
          // Notify cursor.html to reset state
          this.cursorWindow.webContents.send('cursor:position', { xRatio: 0, yRatio: 0, label: '', show: false });
        }
      }
    }, stepDuration);
  }

  getCursorWindow(): BrowserWindow | null {
    return this.cursorWindow;
  }

  // ===== Paste Hint Overlay (Blueprints Library Ctrl/Cmd+V prompt) =====

  private createPasteHintWindow(): BrowserWindow {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    this.pasteHintWindow = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    this.pasteHintWindow.setIgnoreMouseEvents(true);
    this.pasteHintWindow.setAlwaysOnTop(true, 'screen-saver');

    if (process.env.VITE_DEV_SERVER_URL) {
      this.pasteHintWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}pasteHint.html`);
    } else {
      const hintPath = path.join(__dirname, '../renderer/pasteHint.html');
      this.pasteHintWindow.loadFile(hintPath);
    }

    return this.pasteHintWindow;
  }

  showPasteHint(durationMs: number = 7000): void {
    if (!this.pasteHintWindow || this.pasteHintWindow.isDestroyed()) {
      this.createPasteHintWindow();
    }

    // Overlay only the Build Buddy window so Unreal stays fully visible for pasting.
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const { x, y, width, height } = this.mainWindow.getBounds();
    this.pasteHintWindow?.setBounds({ x, y, width, height });

    this.pasteHintWindow?.setOpacity(0);
    this.pasteHintWindow?.showInactive();

    const fadeInDuration = 200;
    const steps = 10;
    let step = 0;
    const fadeIn = setInterval(() => {
      step++;
      if (this.pasteHintWindow && !this.pasteHintWindow.isDestroyed()) {
        this.pasteHintWindow.setOpacity(Math.min(1, step / steps));
      }
      if (step >= steps) clearInterval(fadeIn);
    }, fadeInDuration / steps);

    if (this.pasteHintTimer) clearTimeout(this.pasteHintTimer);
    this.pasteHintTimer = setTimeout(() => this.hidePasteHint(), durationMs);
  }

  hidePasteHint(): void {
    if (this.pasteHintTimer) {
      clearTimeout(this.pasteHintTimer);
      this.pasteHintTimer = null;
    }
    if (!this.pasteHintWindow || this.pasteHintWindow.isDestroyed()) return;

    const fadeOutDuration = 250;
    const steps = 12;
    let step = 0;
    const fadeOut = setInterval(() => {
      step++;
      if (this.pasteHintWindow && !this.pasteHintWindow.isDestroyed()) {
        this.pasteHintWindow.setOpacity(Math.max(0, 1 - step / steps));
      }
      if (step >= steps) {
        clearInterval(fadeOut);
        if (this.pasteHintWindow && !this.pasteHintWindow.isDestroyed()) {
          this.pasteHintWindow.hide();
          this.pasteHintWindow.setOpacity(1);
        }
      }
    }, fadeOutDuration / steps);
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  toggleVisibility(): void {
    if (!this.mainWindow) return;

    if (this.isVisible) {
      this.mainWindow.hide();
      this.isVisible = false;
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
      this.isVisible = true;
    }
  }

  show(): void {
    if (!this.mainWindow) return;
    this.mainWindow.show();
    this.mainWindow.focus();
    this.isVisible = true;
  }

  hide(): void {
    if (!this.mainWindow) return;
    this.mainWindow.hide();
    this.isVisible = false;
  }

  setCollapsed(collapsed: boolean): void {
    if (!this.mainWindow || this.isCollapsed === collapsed) return;

    this.isCollapsed = collapsed;

    // Get current window position to determine which display it's on
    const currentBounds = this.mainWindow.getBounds();
    const currentCenterX = currentBounds.x + currentBounds.width / 2;
    const currentCenterY = currentBounds.y + currentBounds.height / 2;

    // Get the display where the window currently is (not primary display!)
    let display;
    try {
      display = screen.getDisplayNearestPoint({ x: currentCenterX, y: currentCenterY });
    } catch (e) {
      console.warn('Could not get display, falling back to primary');
      display = screen.getPrimaryDisplay();
    }

    const displayBounds = display.workArea;

    // Constants
    const notchWidth = 180;
    const notchHeight = 50;
    // Use last known expanded dimensions (defaults to 520x600, persists after user resizes)
    const expandedWidth = this.expandedBounds.width;
    const expandedHeight = this.expandedBounds.height;

    if (collapsed) {
      // Collapse to notch - keep center X and current Y position (no jump to top).
      // Add BUTTON_RESERVE back so the notch sits at the same screen Y as it did
      // before we expanded (we subtracted it during expansion).
      const notchX = Math.round(currentCenterX - notchWidth / 2);
      let notchY = currentBounds.y + WindowManager.BUTTON_RESERVE;
      if (notchY < displayBounds.y) notchY = displayBounds.y;
      if (notchY + notchHeight > displayBounds.y + displayBounds.height) {
        notchY = displayBounds.y + displayBounds.height - notchHeight;
      }

      // Remove constraints first to allow position change
      this.mainWindow.setMinimumSize(1, 1);
      this.mainWindow.setMaximumSize(10000, 10000);
      this.mainWindow.setBounds({
        x: notchX,
        y: notchY,
        width: notchWidth,
        height: notchHeight,
      });
      this.mainWindow.setMinimumSize(notchWidth, notchHeight);
      this.mainWindow.setMaximumSize(notchWidth, notchHeight);
      this.mainWindow.setResizable(false);
    } else {
      // Expand in place - keep center X and shift Y up by BUTTON_RESERVE so the
      // notch stays where it was on screen (the reserved top strip is for the
      // Blueprints hover button). The collapse path reverses this offset.
      const expandedX = Math.round(currentCenterX - expandedWidth / 2);

      let expandedY = currentBounds.y - WindowManager.BUTTON_RESERVE;
      const displayBottom = displayBounds.y + displayBounds.height;
      if (expandedY < displayBounds.y) expandedY = displayBounds.y;
      if (expandedY + expandedHeight > displayBottom) {
        expandedY = Math.max(displayBounds.y, displayBottom - expandedHeight);
      }
      // Clamp X to stay within display edges
      const clampedX = Math.max(
        displayBounds.x,
        Math.min(expandedX, displayBounds.x + displayBounds.width - expandedWidth)
      );

      // Hide the window before any bounds changes to prevent the compositor from
      // flashing/tearing the transparent window during resize. Opacity is restored
      // only after the renderer has painted the new expanded layout (via the
      // window:restore-opacity round-trip below).
      this.mainWindow.setOpacity(0);

      // Make resizable BEFORE changing size constraints (required on Windows)
      this.mainWindow.setResizable(true);
      // Remove constraints first to allow position change
      this.mainWindow.setMinimumSize(1, 1);
      this.mainWindow.setMaximumSize(10000, 10000);
      this.mainWindow.setBounds({
        x: clampedX,
        y: expandedY,
        width: expandedWidth,
        height: expandedHeight,
      });
      // Allow free resizing within sensible bounds
      this.mainWindow.setMinimumSize(320, 130);
      this.mainWindow.setMaximumSize(800, 900);

      // Re-assert always-on-top after any bounds change — Windows resets z-order on resize
      if (this.isPinned) {
        const aotLevel = process.platform === 'win32' ? 'screen-saver' : 'floating';
        this.mainWindow.setAlwaysOnTop(true, aotLevel);
        this.mainWindow.moveTop();
      }

      // Tell the renderer to swap to chat view. The renderer will call
      // window:restore-opacity once it has painted the new content, so the
      // window only becomes visible when the correct layout is already on screen.
      this.mainWindow.webContents.send('window:collapsed-changed', false);
      return; // early return — collapse path below handles its own notification
    }

    // Re-assert always-on-top after any bounds change — Windows resets z-order on resize
    if (this.isPinned) {
      const aotLevel = process.platform === 'win32' ? 'screen-saver' : 'floating';
      this.mainWindow.setAlwaysOnTop(true, aotLevel);
      this.mainWindow.moveTop();
    }

    // Notify renderer of state change (collapse direction — no position jump, safe to do immediately)
    this.mainWindow.webContents.send('window:collapsed-changed', collapsed);
  }

  toggleCollapsed(): void {
    this.setCollapsed(!this.isCollapsed);
  }

  /**
   * Grow the window to a comfortable conversation height when messages start arriving.
   * Only grows — never shrinks. User can still resize freely after.
   */
  growForConversation(): void {
    if (!this.mainWindow || this.isCollapsed) return;
    const conversationHeight = 520 + WindowManager.BUTTON_RESERVE;
    const currentBounds = this.mainWindow.getBounds();
    if (currentBounds.height >= conversationHeight) return;

    const display = screen.getDisplayNearestPoint({
      x: currentBounds.x + currentBounds.width / 2,
      y: currentBounds.y + currentBounds.height / 2,
    });
    const displayBounds = display.workArea;

    let newY = currentBounds.y;
    if (newY + conversationHeight > displayBounds.y + displayBounds.height) {
      newY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - conversationHeight);
    }

    this.mainWindow.setMinimumSize(1, 1);
    this.mainWindow.setMaximumSize(10000, 10000);
    this.mainWindow.setBounds({ x: currentBounds.x, y: newY, width: currentBounds.width, height: conversationHeight });
    this.mainWindow.setMinimumSize(320, 130);
    this.mainWindow.setMaximumSize(800, 900);
    this.expandedBounds = { width: currentBounds.width, height: conversationHeight };
  }

  /**
   * Lock window to a fixed settings size (non-resizable).
   * Call with false to restore the previous chat size and resizability.
   */
  resizeSettingsPanel(width: number, height: number): void {
    if (!this.mainWindow || !this.inSettingsMode) return;
    const currentBounds = this.mainWindow.getBounds();
    const centerX = currentBounds.x + currentBounds.width / 2;
    const display = screen.getDisplayNearestPoint({ x: centerX, y: currentBounds.y });
    const displayBounds = display.workArea;

    const clampedWidth = Math.min(width, displayBounds.width);
    const clampedHeight = Math.min(height, displayBounds.height);
    const newX = Math.round(centerX - clampedWidth / 2);
    let newY = currentBounds.y;
    if (newY + clampedHeight > displayBounds.y + displayBounds.height) {
      newY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - clampedHeight);
    }

    this.mainWindow.setMinimumSize(1, 1);
    this.mainWindow.setMaximumSize(10000, 10000);
    this.mainWindow.setBounds({ x: newX, y: newY, width: clampedWidth, height: clampedHeight });
    this.mainWindow.setMinimumSize(clampedWidth, clampedHeight);
    this.mainWindow.setMaximumSize(clampedWidth, clampedHeight);
    this.mainWindow.setResizable(false);
  }

  setSettingsMode(enabled: boolean): void {
    if (!this.mainWindow) return;

    this.inSettingsMode = enabled;

    const currentBounds = this.mainWindow.getBounds();
    const centerX = currentBounds.x + currentBounds.width / 2;

    if (enabled) {
      const settingsWidth = 480;
      const settingsHeight = 560; // notch (~44) + mt-2 (8) + panel maxHeight (500) + breathing room

      const display = screen.getDisplayNearestPoint({ x: centerX, y: currentBounds.y });
      const displayBounds = display.workArea;

      const settingsX = Math.round(centerX - settingsWidth / 2);
      let settingsY = currentBounds.y;
      if (settingsY + settingsHeight > displayBounds.y + displayBounds.height) {
        settingsY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - settingsHeight);
      }

      this.mainWindow.setMinimumSize(1, 1);
      this.mainWindow.setMaximumSize(10000, 10000);
      this.mainWindow.setBounds({ x: settingsX, y: settingsY, width: settingsWidth, height: settingsHeight });
      this.mainWindow.setMinimumSize(settingsWidth, settingsHeight);
      this.mainWindow.setMaximumSize(settingsWidth, settingsHeight);
      this.mainWindow.setResizable(false);
    } else {
      // Restore chat expanded bounds
      const expandedWidth = this.expandedBounds.width;
      const expandedHeight = this.expandedBounds.height;
      const expandedX = Math.round(centerX - expandedWidth / 2);

      const display = screen.getDisplayNearestPoint({ x: centerX, y: currentBounds.y });
      const displayBounds = display.workArea;

      let expandedY = currentBounds.y;
      if (expandedY + expandedHeight > displayBounds.y + displayBounds.height) {
        expandedY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - expandedHeight);
      }

      this.mainWindow.setMinimumSize(1, 1);
      this.mainWindow.setMaximumSize(10000, 10000);
      this.mainWindow.setBounds({ x: expandedX, y: expandedY, width: expandedWidth, height: expandedHeight });
      this.mainWindow.setMinimumSize(320, 130);
      this.mainWindow.setMaximumSize(800, 900);
      this.mainWindow.setResizable(true);
    }
  }

  /**
   * Lock window to a fixed login size (non-resizable).
   * Called when showing the login/onboarding screen.
   */
  setLoginMode(enabled: boolean): void {
    if (!this.mainWindow) return;

    this.inLoginMode = enabled;

    if (enabled) {
      const loginWidth = 480;
      const loginHeight = 430; // fits all 3 login steps: email / plan / waiting

      const currentBounds = this.mainWindow.getBounds();
      const centerX = currentBounds.x + currentBounds.width / 2;

      const display = screen.getDisplayNearestPoint({ x: centerX, y: currentBounds.y });
      const displayBounds = display.workArea;

      const loginX = Math.round(centerX - loginWidth / 2);
      let loginY = currentBounds.y;
      if (loginY + loginHeight > displayBounds.y + displayBounds.height) {
        loginY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - loginHeight);
      }

      this.mainWindow.setMinimumSize(1, 1);
      this.mainWindow.setMaximumSize(10000, 10000);
      this.mainWindow.setBounds({ x: loginX, y: loginY, width: loginWidth, height: loginHeight });
      this.mainWindow.setMinimumSize(loginWidth, loginHeight);
      this.mainWindow.setMaximumSize(loginWidth, loginHeight);
      this.mainWindow.setResizable(false);
      this.isCollapsed = false; // treat as expanded for consistent state tracking
    }
  }

  /**
   * Expand the window to a taller size for YouTube video guided mode.
   * Restores the previous size when disabled.
   */
  setVideoMode(enabled: boolean): void {
    if (!this.mainWindow) return;

    if (enabled && !this.inVideoMode) {
      this.inVideoMode = true;
      this.preVideoModeBounds = { ...this.expandedBounds };

      const videoWidth = this.expandedBounds.width;
      const videoHeight = 720;

      const currentBounds = this.mainWindow.getBounds();
      const centerX = currentBounds.x + currentBounds.width / 2;
      const display = screen.getDisplayNearestPoint({ x: centerX, y: currentBounds.y });
      const displayBounds = display.workArea;

      const newX = Math.round(centerX - videoWidth / 2);
      let newY = currentBounds.y;
      if (newY + videoHeight > displayBounds.y + displayBounds.height) {
        newY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - videoHeight);
      }
      const clampedX = Math.max(displayBounds.x, Math.min(newX, displayBounds.x + displayBounds.width - videoWidth));

      this.mainWindow.setMinimumSize(1, 1);
      this.mainWindow.setMaximumSize(10000, 10000);
      this.mainWindow.setBounds({ x: clampedX, y: newY, width: videoWidth, height: videoHeight });
      this.mainWindow.setMinimumSize(320, 130);
      this.mainWindow.setMaximumSize(800, 900);
      this.expandedBounds = { width: videoWidth, height: videoHeight };

    } else if (!enabled && this.inVideoMode) {
      this.inVideoMode = false;
      const prev = this.preVideoModeBounds;
      this.preVideoModeBounds = null;

      if (prev) {
        const currentBounds = this.mainWindow.getBounds();
        const centerX = currentBounds.x + currentBounds.width / 2;
        const display = screen.getDisplayNearestPoint({ x: centerX, y: currentBounds.y });
        const displayBounds = display.workArea;

        const newX = Math.round(centerX - prev.width / 2);
        let newY = currentBounds.y;
        if (newY + prev.height > displayBounds.y + displayBounds.height) {
          newY = Math.max(displayBounds.y, displayBounds.y + displayBounds.height - prev.height);
        }
        const clampedX = Math.max(displayBounds.x, Math.min(newX, displayBounds.x + displayBounds.width - prev.width));

        this.mainWindow.setMinimumSize(1, 1);
        this.mainWindow.setMaximumSize(10000, 10000);
        this.mainWindow.setBounds({ x: clampedX, y: newY, width: prev.width, height: prev.height });
        this.mainWindow.setMinimumSize(320, 130);
        this.mainWindow.setMaximumSize(800, 900);
        this.expandedBounds = prev;
      }
    }
  }

  setAlwaysOnTop(value: boolean): void {
    if (!this.mainWindow) return;
    this.isPinned = value;
    const aotLevel = process.platform === 'win32' ? 'screen-saver' : 'floating';
    this.mainWindow.setAlwaysOnTop(value, aotLevel);
  }

  /**
   * Toggle whether the main window steals focus/activation when clicked.
   * Set to false during guided steps so clicking "Next step" doesn't close
   * popups or menus open in Unreal Engine (or any other app).
   * Works on both macOS (canBecomeKeyWindow) and Windows (WS_EX_NOACTIVATE).
   */
  setFocusable(focusable: boolean): void {
    if (!this.mainWindow) return;
    this.mainWindow.setFocusable(focusable);
    if (!focusable) {
      // Actively release key-window/active-app status so the previously-focused
      // app (e.g. Unreal Engine) regains it. Without this, the fix only works the
      // first time — subsequent guided sessions inherit Build Buddy's focus from
      // the preceding chat interaction and UE never gets focus back.
      this.mainWindow.blur();
    } else {
      // Re-activate Build Buddy so the user can type in the chat input immediately
      // without needing an extra click to bring the window back to the foreground.
      this.mainWindow.focus();
    }
  }

  getState(): WindowState {
    const bounds = this.mainWindow?.getBounds() || { x: 0, y: 0, width: 180, height: 50 };
    return {
      x: bounds.x,
      y: bounds.y,
      width: this.isCollapsed ? this.expandedBounds.width : (bounds.width || 520),
      height: this.isCollapsed ? this.expandedBounds.height : (bounds.height || 600),
      isCollapsed: this.isCollapsed,
      isPinned: this.isPinned,
    };
  }

  isWindowCollapsed(): boolean {
    return this.isCollapsed;
  }

  isWindowPinned(): boolean {
    return this.isPinned;
  }
}
