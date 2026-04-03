import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { BrowserWindow } from 'electron';
import { app } from 'electron';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isUpdating = false;
  private downloadTimeoutId: ReturnType<typeof setTimeout> | null = null;

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    autoUpdater.autoDownload = true;
    // Do NOT auto-install on quit — rely solely on the explicit in-app "Restart to Update"
    // button. autoInstallOnAppQuit=true causes a race between electron-updater's before-quit
    // hook and our own async cleanup, and it can silently fail on macOS.
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[AutoUpdater] Update available:', info.version);
      this.mainWindow?.webContents.send('updater:downloading', { version: info.version });
      // Start 5-minute timeout — if download hasn't finished by then, tell UI to offer manual download
      if (this.downloadTimeoutId) clearTimeout(this.downloadTimeoutId);
      this.downloadTimeoutId = setTimeout(() => {
        console.warn('[AutoUpdater] Download timed out after 5 minutes');
        this.mainWindow?.webContents.send('updater:error', { message: 'Download timed out. Please update manually.' });
      }, DOWNLOAD_TIMEOUT_MS);
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[AutoUpdater] App is up to date.');
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`[AutoUpdater] Download: ${Math.round(progress.percent)}%`);
      this.mainWindow?.webContents.send('updater:download-progress', { percent: Math.round(progress.percent) });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[AutoUpdater] Update downloaded:', info.version);
      if (this.downloadTimeoutId) {
        clearTimeout(this.downloadTimeoutId);
        this.downloadTimeoutId = null;
      }
      this.mainWindow?.webContents.send('updater:update-ready');
    });

    autoUpdater.on('error', (error) => {
      console.error('[AutoUpdater] Error:', error.message);
      if (this.downloadTimeoutId) {
        clearTimeout(this.downloadTimeoutId);
        this.downloadTimeoutId = null;
      }
      this.mainWindow?.webContents.send('updater:error', { message: error.message });
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
    // Use checkForUpdates() — NOT checkForUpdatesAndNotify(). The "notify" variant
    // shows a native OS notification that has its own "Install now" action calling
    // quitAndInstall() internally without setting isUpdating=true, which bypasses
    // our window-all-closed / before-quit guards and corrupts the update flow.
    // Our in-app banner (via updater:update-ready) is the single update UI path.
    autoUpdater.checkForUpdates()?.catch((err) => {
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

    if (process.platform === 'darwin') {
      // Squirrel.Mac's built-in isForceRunAfter=true is unreliable on macOS 12+
      // (Ventura/Sonoma) — the app quits and update installs but relaunch never fires.
      // Instead: spawn a detached shell watcher that polls until this process exits,
      // waits 1s for Squirrel.Mac to finish placing the new bundle, then opens it.
      const { spawn } = require('child_process');
      const appPath = app.getPath('exe').split('/Contents/MacOS/')[0];
      spawn('bash', [
        '-c',
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.1; done; sleep 1; open '${appPath}'`,
      ], { detached: true, stdio: 'ignore' }).unref();
      // false = don't attempt built-in relaunch (our watcher handles it)
      autoUpdater.quitAndInstall(false, false);
    } else {
      // Windows NSIS: silent install, auto-relaunch via installer
      autoUpdater.quitAndInstall(true, true);
    }
  }
}
