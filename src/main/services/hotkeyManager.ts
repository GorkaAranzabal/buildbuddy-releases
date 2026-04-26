import { globalShortcut } from 'electron';
import type { HotkeyConfig } from '../../shared/types';

type HotkeyAction = keyof HotkeyConfig;
type HotkeyCallback = (action: HotkeyAction) => void;

export class HotkeyManager {
  private config: HotkeyConfig = {
    toggleOverlay: 'CommandOrControl+Shift+G',
    captureFullScreen: 'CommandOrControl+Shift+1',
    captureWindow: 'CommandOrControl+Shift+2',
    captureRegion: 'CommandOrControl+Shift+3',
    quickAsk: 'CommandOrControl+Enter',
    quickVoice: 'CommandOrControl+Shift+V',
  };

  private registeredShortcuts: string[] = [];
  private callback: HotkeyCallback | null = null;

  setConfig(config: HotkeyConfig): void {
    this.config = { ...config };
  }

  getConfig(): HotkeyConfig {
    return { ...this.config };
  }

  registerAll(callback: HotkeyCallback): void {
    this.callback = callback;

    // Unregister any existing shortcuts first
    this.unregisterAll();

    // Register each hotkey
    const actions: HotkeyAction[] = [
      'toggleOverlay',
      'captureFullScreen',
      'captureWindow',
      'captureRegion',
      'quickAsk',
      'quickVoice',
    ];

    for (const action of actions) {
      const accelerator = this.config[action];
      if (accelerator) {
        this.registerShortcut(action, accelerator);
      }
    }
  }

  private registerShortcut(action: HotkeyAction, accelerator: string): boolean {
    try {
      const success = globalShortcut.register(accelerator, () => {
        if (this.callback) {
          this.callback(action);
        }
      });

      if (success) {
        this.registeredShortcuts.push(accelerator);
        console.log(`Registered hotkey: ${accelerator} for ${action}`);
      } else {
        console.warn(`Failed to register hotkey: ${accelerator} for ${action}`);
      }

      return success;
    } catch (error) {
      console.error(`Error registering hotkey ${accelerator}:`, error);
      return false;
    }
  }

  unregisterAll(): void {
    for (const shortcut of this.registeredShortcuts) {
      try {
        globalShortcut.unregister(shortcut);
      } catch (error) {
        console.warn(`Error unregistering shortcut ${shortcut}:`, error);
      }
    }
    this.registeredShortcuts = [];
  }

  updateHotkey(action: HotkeyAction, accelerator: string): boolean {
    const oldAccelerator = this.config[action];

    // Unregister old shortcut
    if (oldAccelerator && this.registeredShortcuts.includes(oldAccelerator)) {
      try {
        globalShortcut.unregister(oldAccelerator);
        this.registeredShortcuts = this.registeredShortcuts.filter((s) => s !== oldAccelerator);
      } catch (error) {
        console.warn(`Error unregistering old shortcut ${oldAccelerator}:`, error);
      }
    }

    // Update config
    this.config[action] = accelerator;

    // Register new shortcut
    if (this.callback) {
      return this.registerShortcut(action, accelerator);
    }

    return true;
  }

  isAcceleratorAvailable(accelerator: string): boolean {
    // Check if the accelerator is valid and not already registered globally
    try {
      const isRegistered = globalShortcut.isRegistered(accelerator);
      return !isRegistered;
    } catch {
      return false;
    }
  }
}
