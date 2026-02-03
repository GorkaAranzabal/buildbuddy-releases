import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';

interface SettingsPanelProps {
  onClose: () => void;
  onBack: () => void;
}

export function SettingsPanel({ onClose, onBack }: SettingsPanelProps) {
  const { settings, setSettings } = useAppStore();
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setProvider(settings.aiProvider);
      // Don't show actual API key for security
      setApiKey(settings.apiKey ? '••••••••••••••••' : '');
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const newSettings = {
        aiProvider: provider,
        ...(apiKey && !apiKey.includes('•') ? { apiKey } : {}),
      };
      await window.electronAPI.settings.update(newSettings);
      const updatedSettings = await window.electronAPI.settings.get();
      setSettings(updatedSettings);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
    setIsSaving(false);
  };

  return (
    <div 
      className="mt-2 rounded-2xl border border-white/[0.12] overflow-hidden"
      style={{
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(80px) saturate(200%)',
        WebkitBackdropFilter: 'blur(80px) saturate(200%)',
        width: '480px',
        maxHeight: '500px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-white/70 hover:text-white/90 text-sm transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="text-white/90 font-medium">Settings</h2>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-white/[0.1] hover:bg-white/[0.15] flex items-center justify-center transition-all"
        >
          <svg className="w-3.5 h-3.5 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Settings content */}
      <div className="p-4 space-y-4">
        {/* AI Provider */}
        <div className="space-y-2">
          <label className="text-white/70 text-sm">AI Provider</label>
          <div className="flex gap-2">
            <button
              onClick={() => setProvider('openai')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                provider === 'openai'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1]'
              }`}
            >
              OpenAI
            </button>
            <button
              onClick={() => setProvider('anthropic')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                provider === 'anthropic'
                  ? 'bg-blue-500 text-white'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1]'
              }`}
            >
              Anthropic
            </button>
          </div>
        </div>

        {/* API Key */}
        <div className="space-y-2">
          <label className="text-white/70 text-sm">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Enter your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`}
            className="w-full px-4 py-2.5 bg-white/[0.06] border border-white/[0.1] rounded-lg text-sm text-white/90 placeholder-white/40 focus:outline-none focus:border-white/20 transition-all"
          />
          <p className="text-white/40 text-xs">
            Your API key is encrypted and stored locally.
          </p>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded-lg text-white text-sm font-medium transition-all"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
