import React from 'react';
import { useAppStore } from '../../store';
import { TitleBar } from './TitleBar';
import { ChatView } from '../chat/ChatView';
import { HistoryView } from '../history/HistoryView';
import { SettingsView } from '../settings/SettingsView';

export function ExpandedView() {
  const activeView = useAppStore((state) => state.activeView);

  return (
    <div className="w-full h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        {activeView === 'chat' && <ChatView />}
        {activeView === 'history' && <HistoryView />}
        {activeView === 'settings' && <SettingsView />}
      </div>
    </div>
  );
}
