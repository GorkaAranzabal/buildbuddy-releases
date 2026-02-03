import React, { useEffect, useState, useMemo } from 'react';
import { useAppStore } from './store';
import { NotchBar, RobotStatus } from './components/layout/NotchBar';
import { ExpandedPanel } from './components/layout/ExpandedPanel';
import { SettingsPanel } from './components/layout/SettingsPanel';

type ViewMode = 'collapsed' | 'chat' | 'settings';

function App() {
  const { isCollapsed, setCollapsed, setConnectorStatus, setCurrentContext, setSettings, setHotkeyConfig, isLoading, messages } =
    useAppStore();
  const [isReady, setIsReady] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('collapsed');
  const isExpanded = viewMode !== 'collapsed';

  useEffect(() => {
    // Check if electronAPI is available
    if (!window.electronAPI) {
      console.error('electronAPI not available');
      setIsReady(true);
      return;
    }

    // Initialize app state from main process
    const initializeApp = async () => {
      try {
        // Get initial settings
        const settings = await window.electronAPI.settings.get();
        setSettings(settings);

        // Get hotkey config
        const hotkeyConfig = await window.electronAPI.settings.getHotkeys();
        setHotkeyConfig(hotkeyConfig);

        // Get initial connector status
        const connectorStatus = await window.electronAPI.connector.getStatus();
        setConnectorStatus(connectorStatus.status, connectorStatus.client);

        // Get initial context if connected
        const context = await window.electronAPI.connector.getContext();
        if (context) {
          setCurrentContext(context);
        }

        setIsReady(true);
      } catch (err) {
        console.error('Failed to initialize app:', err);
        setIsReady(true);
      }
    };

    initializeApp();

    // Set up event listeners
    const unsubscribeConnectorStatus = window.electronAPI.connector.onStatusChange((data) => {
      setConnectorStatus(data.status, data.client);
    });

    const unsubscribeContextUpdate = window.electronAPI.connector.onContextUpdate((context) => {
      setCurrentContext(context);
    });

    // Listen for focus-input hotkey to expand
    const unsubscribeFocus = window.electronAPI.onFocusInput(() => {
      handleToggleExpanded();
    });

    // Cleanup
    return () => {
      unsubscribeConnectorStatus();
      unsubscribeContextUpdate();
      unsubscribeFocus();
    };
  }, [setCollapsed, setConnectorStatus, setCurrentContext, setSettings, setHotkeyConfig]);

  const handleToggleExpanded = () => {
    if (viewMode === 'collapsed') {
      setViewMode('chat');
      setCollapsed(false);
      window.electronAPI?.window.collapse(false);
    } else {
      setViewMode('collapsed');
      setCollapsed(true);
      window.electronAPI?.window.collapse(true);
    }
  };

  const handleOpenSettings = () => {
    setViewMode('settings');
    setCollapsed(false);
    window.electronAPI?.window.collapse(false);
  };

  const handleClose = () => {
    setViewMode('collapsed');
    setCollapsed(true);
    window.electronAPI?.window.collapse(true);
  };

  const handleBackToChat = () => {
    setViewMode('chat');
  };

  // Determine robot status based on the conversation
  const robotStatus: RobotStatus = useMemo(() => {
    // If loading, NotchBar will show thinking automatically
    if (isLoading) return 'idle'; // NotchBar handles this with isLoading prop
    
    // Check the last assistant message for errors
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant') {
      const content = lastMessage.content.toLowerCase();
      // Check if message contains error indicators
      if (content.startsWith('error:') || content.includes('failed') || content.includes('unable to')) {
        return 'error';
      }
      // If we just got a successful response, show success briefly
      // (This could be enhanced with a timeout to go back to idle)
      return 'success';
    }
    
    return 'idle';
  }, [messages, isLoading]);

  // Show loading state
  if (!isReady) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div 
          className="flex items-center gap-2 px-4 py-2 rounded-full"
          style={{
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
          }}
        >
          <div className="animate-spin w-4 h-4 border-2 border-white/50 border-t-transparent rounded-full"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center pt-0">
      {/* Notch Bar - Always visible */}
      <NotchBar
        isExpanded={isExpanded}
        onToggle={handleToggleExpanded}
        onSettings={handleOpenSettings}
        isLoading={isLoading}
        robotStatus={robotStatus}
      />

      {/* Chat Panel - Shows when in chat mode */}
      {viewMode === 'chat' && (
        <ExpandedPanel onClose={handleClose} />
      )}

      {/* Settings Panel - Shows when in settings mode */}
      {viewMode === 'settings' && (
        <SettingsPanel onClose={handleClose} onBack={handleBackToChat} />
      )}
    </div>
  );
}

export default App;
