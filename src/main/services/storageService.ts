import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { app, safeStorage } from 'electron';
import type {
  HotkeyConfig,
  Session,
  StorageSchema,
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
};

const DEFAULT_HOTKEY_CONFIG: HotkeyConfig = {
  toggleOverlay: 'CommandOrControl+Shift+G',
  captureFullScreen: 'CommandOrControl+Shift+1',
  captureWindow: 'CommandOrControl+Shift+2',
  captureRegion: 'CommandOrControl+Shift+3',
  quickAsk: 'CommandOrControl+Shift+A',
};

const DEFAULT_WINDOW_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 400,
  height: 600,
  isCollapsed: false,
  isPinned: true,
};

export class StorageService {
  private db: Low<StorageSchema> | null = null;
  private dataPath: string;
  private maxSessions: number = 100;

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
      settings: DEFAULT_SETTINGS,
      hotkeyConfig: DEFAULT_HOTKEY_CONFIG,
      windowState: DEFAULT_WINDOW_STATE,
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
