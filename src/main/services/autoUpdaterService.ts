import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import { app } from 'electron';
import type { BrowserWindow } from 'electron';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isUpdating = false;

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdater] Update available:', info.version);
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[AutoUpdater] App is up to date.');
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`[AutoUpdater] Download: ${Math.round(progress.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] Update downloaded:', info.version);
      this.mainWindow?.webContents.send('updater:update-ready');
    });

    autoUpdater.on('error', (error) => {
      console.error('[AutoUpdater] Error:', error.message);
    });

    // Check for updates after a short delay to not block startup
    setTimeout(() => {
      this.checkNow();
    }, 3000);

    // Re-check periodically while the app is running
    this.intervalId = setInterval(() => {
      this.checkNow();
    }, CHECK_INTERVAL_MS);
  }

  private checkNow(): void {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[AutoUpdater] Check failed:', err.message);
    });
  }

  /** Whether we're in the middle of a quit-and-install */
  get updating(): boolean {
    return this.isUpdating;
  }

  installUpdate(): void {
    console.log('[AutoUpdater] Installing update and restarting...');
    this.isUpdating = true;

    // On macOS, quitAndInstall closes windows then quits.
    // We need to prevent other handlers (window-all-closed, before-quit)
    // from interfering with the updater's own quit/relaunch flow.
    autoUpdater.quitAndInstall(true, true);
  }
}
