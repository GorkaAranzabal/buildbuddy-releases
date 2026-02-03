import React, { useState } from 'react';
import { AISettings } from './AISettings';
import { HotkeySettings } from './HotkeySettings';
import { PrivacySettings } from './PrivacySettings';

type SettingsTab = 'ai' | 'hotkeys' | 'privacy';

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

  return (
    <div className="flex flex-col h-full">
      {/* Tab navigation */}
      <div className="flex border-b border-white/[0.1]">
        <TabButton
          active={activeTab === 'ai'}
          onClick={() => setActiveTab('ai')}
        >
          AI Provider
        </TabButton>
        <TabButton
          active={activeTab === 'hotkeys'}
          onClick={() => setActiveTab('hotkeys')}
        >
          Hotkeys
        </TabButton>
        <TabButton
          active={activeTab === 'privacy'}
          onClick={() => setActiveTab('privacy')}
        >
          Privacy
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'ai' && <AISettings />}
        {activeTab === 'hotkeys' && <HotkeySettings />}
        {activeTab === 'privacy' && <PrivacySettings />}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'text-white/95 border-white/70'
          : 'text-white/50 border-transparent hover:text-white/80'
      }`}
    >
      {children}
    </button>
  );
}
