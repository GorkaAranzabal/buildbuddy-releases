import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { BrowserWindow } from 'electron';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isUpdating = false;

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

    // On macOS (zip updater): isSilent=false is required — passing true causes the app
    // to quit without relaunching on some macOS versions (the new binary is placed but
    // never opened). isForceRunAfter=true ensures the new version opens after install.
    //
    // On Windows (NSIS): isSilent=true runs the installer without a UAC dialog chain,
    // isForceRunAfter=true relaunches the app automatically after the installer finishes.
    const isSilent = process.platform !== 'darwin';
    autoUpdater.quitAndInstall(isSilent, true);
  }
}
