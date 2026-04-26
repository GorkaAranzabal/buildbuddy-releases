import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app, safeStorage } from 'electron';
import type {
  ConversationThread,
  DailyUsage,
  FairUseState,
  HotkeyConfig,
  Session,
  StorageSchema,
  ThreadListItem,
  UEProjectAnalysis,
  UserSettings,
  WindowState,
} from '../../shared/types';

const DEFAULT_SETTINGS: UserSettings = {
  aiProvider: 'openai',
  apiKey: '',
  preferredModel: 'gpt-4-turbo-preview',
  screenshotCaptureEnabled: true,
  sendLogsEnabled: true,
  localOnlyMode: false,
  theme: 'dark',
  defaultPinned: true,
  startMinimized: false,
  autoConnectUnreal: true,
  maxContextLines: 200,
  maxContextSize: 25 * 1024,
  ueProjectPath: '',
  unrealMCPEnabled: false,
  unrealEnginePath: '',
  devMode: false,
  selectedEngine: null,
  godotProjectPath: '',
  unityProjectPath: '',
  uefnEnginePath: '',
  uefnProjectPath: '',
};

const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  toggleOverlay: 'CommandOrControl+Shift+G',
  captureFullScreen: 'CommandOrControl+Shift+1',
  captureWindow: 'CommandOrControl+Shift+2',
  captureRegion: 'CommandOrControl+Shift+3',
  quickAsk: 'CommandOrControl+Enter',
  quickVoice: 'CommandOrControl+Shift+V',
};

const DEFAULT_WINDOW_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 400,
  height: 600,
  isCollapsed: false,
  isPinned: true,
};

const DEFAULT_DAILY_USAGE: DailyUsage = {
  date: new Date().toISOString().split('T')[0],
  askCount: 0,
};

const DEFAULT_FAIR_USE_STATE: FairUseState = {
  chatTimestamps: [],
  rcTimestamps: [],
  timeoutUntil: null,
  violations: [],
};

export class StorageService {
  private db: Low<StorageSchema> | null = null;
  private dataPath: string;
  private maxSessions: number = 100;
  private maxThreads: number = 50;

  constructor() {
    this.dataPath = path.join(
      app.getPath('userData'),
      'data.json'
    );

    // Ensure directory exists
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    const adapter = new JSONFile<StorageSchema>(this.dataPath);
    this.db = new Low(adapter, {
      sessions: [],
      threads: [],
      activeThreadId: null,
      settings: DEFAULT_SETTINGS,
      hotkeyConfig: DEFAULT_HOTKEY_CONFIG,
      windowState: DEFAULT_WINDOW_STATE,
      authEmail: null,
      dailyUsage: DEFAULT_DAILY_USAGE,
    });

    await this.db.read();

    // Ensure all default values exist
    if (!this.db.data.settings) {
      this.db.data.settings = DEFAULT_SETTINGS;
    }
    if (!this.db.data.hotkeyConfig) {
      this.db.data.hotkeyConfig = DEFAULT_HOTKEY_CONFIG;
    }
    if (!this.db.data.windowState) {
      this.db.data.windowState = DEFAULT_WINDOW_STATE;
    }
    if (!this.db.data.sessions) {
      this.db.data.sessions = [];
    }
    if (this.db.data.authEmail === undefined) {
      this.db.data.authEmail = null;
    }
    if (!this.db.data.dailyUsage) {
      this.db.data.dailyUsage = DEFAULT_DAILY_USAGE;
    }
    if (!this.db.data.threads) {
      this.db.data.threads = [];
    }
    if (this.db.data.activeThreadId === undefined) {
      this.db.data.activeThreadId = null;
    }
    if (!this.db.data.fairUseState) {
      this.db.data.fairUseState = DEFAULT_FAIR_USE_STATE;
    }

    await this.db.write();
  }

  // ============ Sessions ============

  async saveSession(session: Session): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Add to beginning of array
    this.db.data.sessions.unshift(session);

    // Trim to max sessions
    if (this.db.data.sessions.length > this.maxSessions) {
      this.db.data.sessions = this.db.data.sessions.slice(0, this.maxSessions);
    }

    await this.db.write();
  }

  async getSessions(limit?: number): Promise<Session[]> {
    if (!this.db) throw new Error('Database not initialized');

    if (limit) {
      return this.db.data.sessions.slice(0, limit);
    }
    return [...this.db.data.sessions];
  }

  async getSession(id: string): Promise<Session | null> {
    if (!this.db) throw new Error('Database not initialized');

    return this.db.data.sessions.find((s) => s.id === id) || null;
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.data.sessions = this.db.data.sessions.filter((s) => s.id !== id);
    await this.db.write();
  }

  async clearAllSessions(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.data.sessions = [];
    await this.db.write();
  }

  // ============ Threads ============

  async saveThread(thread: ConversationThread): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const idx = this.db.data.threads.findIndex((t) => t.id === thread.id);
    if (idx >= 0) {
      this.db.data.threads[idx] = thread;
    } else {
      this.db.data.threads.unshift(thread);
    }

    // Sort by updatedAt descending and cap at maxThreads
    this.db.data.threads.sort((a, b) => b.updatedAt - a.updatedAt);
    if (this.db.data.threads.length > this.maxThreads) {
      this.db.data.threads = this.db.data.threads.slice(0, this.maxThreads);
    }

    await this.db.write();
  }

  async getThread(id: string): Promise<ConversationThread | null> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.data.threads.find((t) => t.id === id) || null;
  }

  async getThreads(limit?: number): Promise<ThreadListItem[]> {
    if (!this.db) throw new Error('Database not initialized');

    const sorted = [...this.db.data.threads].sort((a, b) => b.updatedAt - a.updatedAt);
    const sliced = limit ? sorted.slice(0, limit) : sorted;
    return sliced.map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      messageCount: t.messages.length,
    }));
  }

  async deleteThread(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.data.threads = this.db.data.threads.filter((t) => t.id !== id);
    if (this.db.data.activeThreadId === id) {
      this.db.data.activeThreadId = null;
    }
    await this.db.write();
  }

  async getActiveThreadId(): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.data.activeThreadId;
  }

  async setActiveThreadId(id: string | null): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.activeThreadId = id;
    await this.db.write();
  }

  // ============ Settings ============

  async getSettings(): Promise<UserSettings> {
    if (!this.db) throw new Error('Database not initialized');

    const settings = { ...DEFAULT_SETTINGS, ...this.db.data.settings };

    // Decrypt API key if encrypted
    if (settings.apiKey && safeStorage.isEncryptionAvailable()) {
      try {
        settings.apiKey = this.decryptApiKey(settings.apiKey);
      } catch {
        // If decryption fails, key might not be encrypted
      }
    }

    return settings;
  }

  async updateSettings(settings: Partial<UserSettings>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Encrypt API key if provided
    if (settings.apiKey && safeStorage.isEncryptionAvailable()) {
      settings.apiKey = this.encryptApiKey(settings.apiKey);
    }

    this.db.data.settings = { ...this.db.data.settings, ...settings };
    await this.db.write();
  }

  // ============ Project Analysis ============

  async getProjectAnalysis(): Promise<UEProjectAnalysis | null> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.data.projectAnalysis ?? null;
  }

  async saveProjectAnalysis(analysis: UEProjectAnalysis): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.projectAnalysis = analysis;
    await this.db.write();
  }

  async clearProjectAnalysis(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.projectAnalysis = undefined;
    await this.db.write();
  }

  private encryptApiKey(key: string): string {
    if (!key || !safeStorage.isEncryptionAvailable()) return key;
    const encrypted = safeStorage.encryptString(key);
    return encrypted.toString('base64');
  }

  private decryptApiKey(encryptedKey: string): string {
    if (!encryptedKey || !safeStorage.isEncryptionAvailable()) return encryptedKey;
    try {
      const buffer = Buffer.from(encryptedKey, 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      return encryptedKey; // Return as-is if decryption fails
    }
  }

  // ============ Hotkey Config ============

  async getHotkeyConfig(): Promise<HotkeyConfig> {
    if (!this.db) throw new Error('Database not initialized');

    return { ...DEFAULT_HOTKEY_CONFIG, ...this.db.data.hotkeyConfig };
  }

  async updateHotkeyConfig(config: Partial<HotkeyConfig>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.data.hotkeyConfig = { ...this.db.data.hotkeyConfig, ...config };
    await this.db.write();
  }

  // ============ Window State ============

  async getWindowState(): Promise<WindowState> {
    if (!this.db) throw new Error('Database not initialized');

    return { ...DEFAULT_WINDOW_STATE, ...this.db.data.windowState };
  }

  async updateWindowState(state: Partial<WindowState>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.data.windowState = { ...this.db.data.windowState, ...state };
    await this.db.write();
  }

  // ============ Auth ============

  async getAuthEmail(): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.data.authEmail;
  }

  async setAuthEmail(email: string | null): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.authEmail = email;
    await this.db.write();
  }

  async getProxyToken(): Promise<{ token: string; expiresAt: number } | null> {
    if (!this.db) throw new Error('Database not initialized');
    const token = this.db.data.proxySessionToken;
    const expiresAt = this.db.data.proxyTokenExpiresAt;
    if (!token || !expiresAt) return null;
    return { token, expiresAt };
  }

  async setProxyToken(token: string, expiresAt: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.proxySessionToken = token;
    this.db.data.proxyTokenExpiresAt = expiresAt;
    await this.db.write();
  }

  async clearProxyToken(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.proxySessionToken = undefined;
    this.db.data.proxyTokenExpiresAt = undefined;
    await this.db.write();
  }

  // ============ Weekly Usage ============

  /** Returns the ISO date string of the Monday that starts the current week. */
  private getWeekStart(): string {
    const d = new Date();
    const day = d.getDay(); // 0=Sun, 1=Mon...6=Sat
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // rewind to Monday
    return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().split('T')[0];
  }

  // ---- Reinstall-resistant backup in home directory ----
  // Stored at ~/.build-buddy-usage.json — survives app reinstalls since it's
  // outside the app's userData folder. Keyed by email+week so multiple users
  // on the same machine and weekly resets both work correctly.

  private get usageBackupPath(): string {
    return path.join(os.homedir(), '.build-buddy-usage.json');
  }

  private readUsageBackup(): { email: string; weekStart: string; askCount: number } | null {
    try {
      const raw = fs.readFileSync(this.usageBackupPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private writeUsageBackup(email: string, weekStart: string, askCount: number): void {
    try {
      fs.writeFileSync(this.usageBackupPath, JSON.stringify({ email, weekStart, askCount }), 'utf-8');
    } catch {
      // Non-fatal — local db is still the source of truth during this session
    }
  }
  // -------------------------------------------------------

  async getDailyUsage(): Promise<DailyUsage> {
    if (!this.db) throw new Error('Database not initialized');

    const weekStart = this.getWeekStart();
    const email = this.db.data.authEmail ?? '';

    if (this.db.data.dailyUsage.date !== weekStart) {
      this.db.data.dailyUsage = { date: weekStart, askCount: 0 };
      await this.db.write();
    }

    // Check home-dir backup — if it has a higher count for this email+week,
    // restore it so a fresh reinstall doesn't reset the limit.
    const backup = this.readUsageBackup();
    if (backup && backup.email === email && backup.weekStart === weekStart && backup.askCount > this.db.data.dailyUsage.askCount) {
      this.db.data.dailyUsage.askCount = backup.askCount;
      await this.db.write();
    }

    return { ...this.db.data.dailyUsage };
  }

  async incrementDailyUsage(): Promise<DailyUsage> {
    if (!this.db) throw new Error('Database not initialized');

    const weekStart = this.getWeekStart();
    const email = this.db.data.authEmail ?? '';

    if (this.db.data.dailyUsage.date !== weekStart) {
      this.db.data.dailyUsage = { date: weekStart, askCount: 0 };
    }

    this.db.data.dailyUsage.askCount++;
    await this.db.write();

    // Mirror to home-dir backup so the count survives a reinstall
    this.writeUsageBackup(email, weekStart, this.db.data.dailyUsage.askCount);

    return { ...this.db.data.dailyUsage };
  }

  async resetDailyUsage(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.dailyUsage = { date: this.getWeekStart(), askCount: 0 };
    await this.db.write();
  }

  // ============ Fair Use ============

  async getFairUseState(): Promise<FairUseState> {
    if (!this.db) throw new Error('Database not initialized');
    return { ...DEFAULT_FAIR_USE_STATE, ...this.db.data.fairUseState };
  }

  async setFairUseState(state: FairUseState): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.data.fairUseState = state;
    await this.db.write();
  }

  // ============ Export ============

  async exportSession(id: string, format: 'json' | 'markdown'): Promise<string> {
    const session = await this.getSession(id);
    if (!session) throw new Error('Session not found');

    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    }

    // Markdown format
    const lines: string[] = [
      `# Gorka Copilot Session`,
      ``,
      `**Date:** ${new Date(session.timestamp).toLocaleString()}`,
      ``,
      `## Question`,
      ``,
      session.prompt,
      ``,
      `## Response`,
      ``,
      session.response.raw,
      ``,
    ];

    if (session.context?.projectInfo) {
      lines.push(`## Context`);
      lines.push(``);
      lines.push(`- Project: ${session.context.projectInfo.project_name}`);
      lines.push(`- Engine: UE ${session.context.projectInfo.engine_version}`);
      lines.push(``);
    }

    return lines.join('\n');
  }
}
