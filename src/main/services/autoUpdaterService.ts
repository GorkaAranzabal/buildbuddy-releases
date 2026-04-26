import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { BrowserWindow } from 'electron';
import { app } from 'electron';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_INSTALL_WINDOW_MS = 2 * 60 * 1000; // auto-install if download finishes within 2 min of launch

export class AutoUpdaterService {
  private mainWindow: BrowserWindow | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isUpdating = false;
  private downloadTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private checkRetryCount = 0;
  private launchedAt = 0;
  private beforeInstallHook: (() => Promise<void>) | null = null;
  private static readonly MAX_CHECK_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 60_000;

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.launchedAt = Date.now();

    // Skip auto-updates when running unpacked or from a local `--dir` build —
    // electron-builder only emits app-update.yml for published artifacts, and
    // its absence makes electron-updater spam ENOENT errors that gate the chat.
    const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
    if (!app.isPackaged || !fs.existsSync(updateConfigPath)) {
      console.log('[AutoUpdater] Skipping init — no app-update.yml (unpacked or local build)');
      return;
    }

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

      // If the update finished within the auto-install window after launch, install it
      // automatically — the user just opened the app and hasn't done much yet, so a quick
      // restart is the least disruptive path. After that, fall back to the manual button.
      const sinceLaunch = Date.now() - this.launchedAt;
      if (sinceLaunch < AUTO_INSTALL_WINDOW_MS && !this.isUpdating) {
        console.log('[AutoUpdater] Auto-installing within launch window (delay 3s)');
        setTimeout(() => {
          if (!this.isUpdating) {
            this.installUpdate().catch((err) => {
              console.error('[AutoUpdater] Auto-install failed:', err);
              this.mainWindow?.webContents.send('updater:error', { message: String(err?.message || err) });
            });
          }
        }, 3000);
      }
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
      this.checkRetryCount = 0; // reset retry counter for fresh scheduled check
      this.checkNow();
    }, CHECK_INTERVAL_MS);
  }

  /** Register a hook that runs (awaited) just before quitAndInstall. Used for resource cleanup. */
  setBeforeInstallHook(fn: () => Promise<void>): void {
    this.beforeInstallHook = fn;
  }

  private checkNow(): void {
    // Use checkForUpdates() — NOT checkForUpdatesAndNotify(). The "notify" variant
    // shows a native OS notification that has its own "Install now" action calling
    // quitAndInstall() internally without setting isUpdating=true, which bypasses
    // our window-all-closed / before-quit guards and corrupts the update flow.
    // Our in-app banner (via updater:update-ready) is the single update UI path.
    autoUpdater.checkForUpdates()?.catch((err) => {
      console.error('[AutoUpdater] Check failed:', err.message);
      if (this.checkRetryCount < AutoUpdaterService.MAX_CHECK_RETRIES) {
        this.checkRetryCount++;
        console.log(`[AutoUpdater] Retrying (${this.checkRetryCount}/${AutoUpdaterService.MAX_CHECK_RETRIES}) in 60s...`);
        setTimeout(() => this.checkNow(), AutoUpdaterService.RETRY_DELAY_MS);
      } else {
        this.checkRetryCount = 0; // reset for next scheduled interval
      }
    });
  }

  /** Whether we're in the middle of a quit-and-install */
  get updating(): boolean {
    return this.isUpdating;
  }

  async installUpdate(): Promise<void> {
    if (this.isUpdating) {
      console.log('[AutoUpdater] Install already in progress, ignoring');
      return;
    }
    console.log('[AutoUpdater] Installing update and restarting...');
    this.isUpdating = true;

    // Resolve the bundle path BEFORE running cleanup — process.execPath is stable across
    // the install (Squirrel replaces the bundle contents at the same on-disk location).
    const appBundlePath = process.platform === 'darwin'
      ? process.execPath.split('/Contents/MacOS/')[0]
      : null;

    // Run cleanup synchronously so hotkeys/sockets/tray/MCP child are released before
    // Squirrel quits the app — leaving them held was preventing the new instance from
    // claiming those resources after relaunch.
    if (this.beforeInstallHook) {
      try {
        await this.beforeInstallHook();
      } catch (err) {
        console.error('[AutoUpdater] beforeInstall hook failed (continuing anyway):', err);
      }
    }

    if (process.platform === 'darwin' && appBundlePath) {
      // Belt-and-suspenders: spawn a detached watcher that polls until Squirrel.Mac has
      // finished swapping the bundle (Info.plist mtime is fresher than this process'
      // start time), then `open`s it. If Squirrel.Mac's own relaunch fires first, the
      // second `open` is a no-op (macOS dedupes).
      const startedAt = Math.floor(Date.now() / 1000) - 5; // small skew tolerance
      const plistPath = `${appBundlePath}/Contents/Info.plist`;
      const logDir = path.join(os.homedir(), 'Library', 'Logs', 'BuildBuddy');
      try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
      const logPath = path.join(logDir, 'updater.log');

      const script = `
exec >> '${logPath}' 2>&1
echo "[$(date)] watcher start pid=${process.pid} bundle='${appBundlePath}'"
# Wait for parent to exit
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
echo "[$(date)] parent exited, waiting for Squirrel.Mac to settle bundle"
# Wait until the new bundle's Info.plist mtime is fresher than our start time, capped at 30s
for i in $(seq 1 150); do
  if [ -f '${plistPath}' ]; then
    MTIME=$(stat -f %m '${plistPath}' 2>/dev/null || echo 0)
    if [ "$MTIME" -gt ${startedAt} ]; then
      echo "[$(date)] bundle updated (mtime=$MTIME > ${startedAt}) after $((i*200))ms"
      break
    fi
  fi
  sleep 0.2
done
# Small additional grace for Squirrel to finish copying nested files
sleep 1
echo "[$(date)] opening bundle"
open '${appBundlePath}'
echo "[$(date)] open exit=$?"
`;
      try {
        spawn('bash', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
      } catch (err) {
        console.error('[AutoUpdater] Failed to spawn relaunch watcher:', err);
      }
    }

    // Canonical install path. (true, true) = silent install (NSIS) + force relaunch.
    // On macOS this delegates to Squirrel.Mac which now does the bundle swap AND fires
    // its own relaunch (the watcher above is a fallback).
    autoUpdater.quitAndInstall(true, true);
  }
}
