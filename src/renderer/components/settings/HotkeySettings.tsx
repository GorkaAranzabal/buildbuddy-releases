import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import type { HotkeyConfig } from '../../../shared/types';

const HOTKEY_LABELS: Record<keyof HotkeyConfig, string> = {
  toggleOverlay: 'Toggle Overlay',
  captureFullScreen: 'Capture Full Screen',
  captureWindow: 'Capture Window',
  captureRegion: 'Capture Region',
  quickAsk: 'Quick Ask (Focus Input)',
};

export function HotkeySettings() {
  const hotkeyConfig = useAppStore((state) => state.hotkeyConfig);
  const setHotkeyConfig = useAppStore((state) => state.setHotkeyConfig);

  const [config, setConfig] = useState<HotkeyConfig>(
    hotkeyConfig || {
      toggleOverlay: 'CommandOrControl+Shift+G',
      captureFullScreen: 'CommandOrControl+Shift+1',
      captureWindow: 'CommandOrControl+Shift+2',
      captureRegion: 'CommandOrControl+Shift+3',
      quickAsk: 'CommandOrControl+Shift+A',
    }
  );
  const [editingKey, setEditingKey] = useState<keyof HotkeyConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (hotkeyConfig) {
      setConfig(hotkeyConfig);
    }
  }, [hotkeyConfig]);

  const handleKeyDown = (e: React.KeyboardEvent, action: keyof HotkeyConfig) => {
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];

    if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    // Add the actual key
    const key = e.key.toUpperCase();
    if (!['META', 'CONTROL', 'ALT', 'SHIFT'].includes(key)) {
      parts.push(key);
    }

    if (parts.length > 1) {
      const accelerator = parts.join('+');
      setConfig((prev) => ({ ...prev, [action]: accelerator }));
      setEditingKey(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await window.electronAPI.settings.updateHotkeys(config);
      const newConfig = await window.electronAPI.settings.getHotkeys();
      setHotkeyConfig(newConfig);
    } catch (error) {
      console.error('Failed to save hotkeys:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const formatAccelerator = (accelerator: string): string => {
    return accelerator
      .replace('CommandOrControl', '⌘/Ctrl')
      .replace('Alt', '⌥/Alt')
      .replace('Shift', '⇧')
      .replace(/\+/g, ' + ');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-200 mb-4">Keyboard Shortcuts</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Click on a shortcut to edit it. Press the new key combination to set.
        </p>

        <div className="space-y-2">
          {(Object.keys(HOTKEY_LABELS) as Array<keyof HotkeyConfig>).map((action) => (
            <div
              key={action}
              className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg"
            >
              <span className="text-sm text-zinc-200">{HOTKEY_LABELS[action]}</span>
              <button
                onClick={() => setEditingKey(action)}
                onKeyDown={(e) => editingKey === action && handleKeyDown(e, action)}
                onBlur={() => setEditingKey(null)}
                className={`px-3 py-1.5 rounded text-sm font-mono transition-colors ${
                  editingKey === action
                    ? 'bg-blue-600 text-white animate-pulse'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
              >
                {editingKey === action ? 'Press keys...' : formatAccelerator(config[action])}
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Hotkeys'}
        </button>
      </div>
    </div>
  );
}
