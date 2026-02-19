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
  private isCollapsed: boolean = false;
  private isPinned: boolean = true;
  private isVisible: boolean = true;
  private inSettingsMode: boolean = false;
  private isQuitting: boolean = false;

  // Window dimensions - Notch style UI
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
    this.expandedBounds = { width: 480, height: 175 };

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
      },
    });

    // Handle resize constraints
    this.mainWindow.setMinimumSize(notchWidth, notchHeight);

    // Ensure alwaysOnTop with 'floating' level (required for Windows consistency)
    this.mainWindow.setAlwaysOnTop(true, 'floating');

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
      if (!this.isCollapsed) {
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
      // Collapse to notch - keep center X and current Y position (no jump to top)
      const notchX = Math.round(currentCenterX - notchWidth / 2);
      // Keep current Y, only clamp to stay within display bounds
      let notchY = currentBounds.y;
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
      // Expand in place - keep center X and current Y position (no jump to top)
      const expandedX = Math.round(currentCenterX - expandedWidth / 2);

      // Keep current Y, only clamp to stay within display bounds
      let expandedY = currentBounds.y;
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
      this.mainWindow.setResizable(true);
    }

    // Notify renderer of state change
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
    const conversationHeight = 520;
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

  setAlwaysOnTop(value: boolean): void {
    if (!this.mainWindow) return;
    this.isPinned = value;
    this.mainWindow.setAlwaysOnTop(value, 'floating');
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
