import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';

export function PrivacySettings() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);

  const [screenshotEnabled, setScreenshotEnabled] = useState(settings?.screenshotCaptureEnabled ?? true);
  const [logsEnabled, setLogsEnabled] = useState(settings?.sendLogsEnabled ?? true);
  const [localOnly, setLocalOnly] = useState(settings?.localOnlyMode ?? false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setScreenshotEnabled(settings.screenshotCaptureEnabled);
      setLogsEnabled(settings.sendLogsEnabled);
      setLocalOnly(settings.localOnlyMode);
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await window.electronAPI.settings.update({
        screenshotCaptureEnabled: screenshotEnabled,
        sendLogsEnabled: logsEnabled,
        localOnlyMode: localOnly,
      });
      const newSettings = await window.electronAPI.settings.get();
      setSettings(newSettings);
    } catch (error) {
      console.error('Failed to save privacy settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear all session history? This cannot be undone.')) {
      try {
        await window.electronAPI.storage.clearSessions();
        alert('History cleared successfully.');
      } catch (error) {
        console.error('Failed to clear history:', error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-200 mb-4">Privacy Settings</h3>

        <div className="space-y-4">
          {/* Screenshot capture */}
          <ToggleSetting
            label="Enable Screenshot Capture"
            description="Allow capturing screenshots to send to AI for visual context"
            enabled={screenshotEnabled}
            onChange={setScreenshotEnabled}
          />

          {/* Log sending */}
          <ToggleSetting
            label="Send Unreal Logs to AI"
            description="Include Unreal Engine logs and error context in AI requests"
            enabled={logsEnabled}
            onChange={setLogsEnabled}
          />

          {/* Local only mode */}
          <ToggleSetting
            label="Local Only Mode"
            description="Disable all AI API calls (app will not make external requests)"
            enabled={localOnly}
            onChange={setLocalOnly}
          />
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save Privacy Settings'}
        </button>
      </div>

      {/* Data management */}
      <div className="pt-4 border-t border-zinc-700">
        <h3 className="text-sm font-medium text-zinc-200 mb-4">Data Management</h3>

        <div className="space-y-3">
          <button
            onClick={handleClearHistory}
            className="w-full px-4 py-2 bg-red-600/20 border border-red-600/50 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-lg transition-colors"
          >
            Clear All Session History
          </button>

          <p className="text-xs text-zinc-500">
            All data is stored locally on your machine. Session history includes your questions,
            AI responses, and any attached context. Screenshots are stored temporarily and
            deleted when the app closes.
          </p>
        </div>
      </div>

      {/* Security info */}
      <div className="pt-4 border-t border-zinc-700">
        <h3 className="text-sm font-medium text-zinc-200 mb-3">Security Information</h3>
        <ul className="space-y-2 text-xs text-zinc-400">
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Unreal connector traffic stays on localhost (127.0.0.1)</span>
          </li>
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>API keys are encrypted using OS-level secure storage</span>
          </li>
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Data is only sent to AI APIs when you click Ask</span>
          </li>
          <li className="flex items-start gap-2">
            <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>No telemetry or analytics are collected</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

interface ToggleSettingProps {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

function ToggleSetting({ label, description, enabled, onChange }: ToggleSettingProps) {
  return (
    <div className="flex items-start justify-between gap-4 p-3 bg-zinc-800/50 rounded-lg">
      <div>
        <div className="text-sm text-zinc-200">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{description}</div>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
          enabled ? 'bg-blue-600' : 'bg-zinc-600'
        }`}
      >
        <span
          className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
            enabled ? 'left-6' : 'left-1'
          }`}
        />
      </button>
    </div>
  );
}
