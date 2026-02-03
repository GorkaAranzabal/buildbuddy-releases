import { BrowserWindow, screen, app } from 'electron';
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
  private isCollapsed: boolean = false;
  private isPinned: boolean = true;
  private isVisible: boolean = true;

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
    this.expandedBounds = { width: 520, height: 600 };

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
      // Also open DevTools for debugging
      this.mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // Show window when ready
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
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
      if (!this.isCollapsed) {
        const bounds = this.mainWindow?.getBounds();
        if (bounds) {
          this.expandedBounds = { width: bounds.width, height: bounds.height };
        }
      }
    });

    // Prevent closing on macOS (hide instead)
    this.mainWindow.on('close', (event) => {
      if (process.platform === 'darwin' && this.mainWindow) {
        event.preventDefault();
        this.mainWindow.hide();
        this.isVisible = false;
      }
    });

    return this.mainWindow;
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
    const expandedWidth = 520;
    const expandedHeight = 600;

    if (collapsed) {
      // Collapse to notch - keep horizontal position, just resize
      const notchX = currentBounds.x + (currentBounds.width - notchWidth) / 2;
      // Keep it near the top of the current display
      const notchY = displayBounds.y + 10;
      
      this.mainWindow.setMinimumSize(notchWidth, notchHeight);
      this.mainWindow.setMaximumSize(notchWidth, notchHeight);
      this.mainWindow.setResizable(false);
      this.mainWindow.setBounds({
        x: Math.floor(notchX),
        y: notchY,
        width: notchWidth,
        height: notchHeight,
      });
    } else {
      // Expand below notch - keep centered on the same position
      const expandedX = currentBounds.x + (currentBounds.width - expandedWidth) / 2;
      // Keep it near the top of the current display
      const expandedY = displayBounds.y + 10;
      
      this.mainWindow.setMinimumSize(expandedWidth, 200);
      this.mainWindow.setMaximumSize(expandedWidth, 700);
      this.mainWindow.setResizable(false); // Keep fixed width
      this.mainWindow.setBounds({
        x: Math.floor(expandedX),
        y: expandedY,
        width: expandedWidth,
        height: expandedHeight,
      });
    }

    // Notify renderer of state change
    this.mainWindow.webContents.send('window:collapsed-changed', collapsed);
  }

  toggleCollapsed(): void {
    this.setCollapsed(!this.isCollapsed);
  }

  setAlwaysOnTop(value: boolean): void {
    if (!this.mainWindow) return;
    this.isPinned = value;
    this.mainWindow.setAlwaysOnTop(value);
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
