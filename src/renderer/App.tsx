import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAppStore } from './store';
import { NotchBar, RobotStatus } from './components/layout/NotchBar';
import { ExpandedPanel } from './components/layout/ExpandedPanel';
import { SettingsPanel } from './components/layout/SettingsPanel';
import { LoginScreen } from './components/auth/LoginScreen';

type ViewMode = 'collapsed' | 'chat' | 'settings' | 'login';

function App() {
  const {
    isCollapsed, setCollapsed, setConnectorStatus, setCurrentContext,
    setSettings, setHotkeyConfig, isLoading, messages,
    setAuthState, setDailyUsage, clearAuth,
    setUnrealMCPStatus,
  } = useAppStore();
  const [isReady, setIsReady] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('collapsed');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const isExpanded = viewMode !== 'collapsed' && viewMode !== 'login';

  // Track vignette state to handle show/hide properly
  const vignetteShownRef = useRef(false);

  // Handle full-screen vignette visibility via IPC
  useEffect(() => {
    if (!window.electronAPI?.vignette) return;

    if (isLoading && !vignetteShownRef.current) {
      vignetteShownRef.current = true;
      window.electronAPI.vignette.show();
    } else if (!isLoading && vignetteShownRef.current) {
      vignetteShownRef.current = false;
      window.electronAPI.vignette.hide();
    }
  }, [isLoading]);

  // Initialize the rest of the app (settings, hotkeys, connector)
  const initializeAppServices = async () => {
    const settings = await window.electronAPI.settings.get();
    setSettings(settings);

    const hotkeyConfig = await window.electronAPI.settings.getHotkeys();
    setHotkeyConfig(hotkeyConfig);

    const connectorStatus = await window.electronAPI.connector.getStatus();
    setConnectorStatus(connectorStatus.status, connectorStatus.client);

    const context = await window.electronAPI.connector.getContext();
    if (context) {
      setCurrentContext(context);
    }

    const usage = await window.electronAPI.auth.getUsage();
    setDailyUsage(usage);
  };

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
        // Check auth state FIRST
        const auth = await window.electronAPI.auth.getState();
        setAuthState(auth);

        if (!auth.isLoggedIn) {
          // Not logged in - show login, expand window
          setViewMode('login');
          setCollapsed(false);
          window.electronAPI?.window.collapse(false);
          setIsReady(true);
          return;
        }

        // Logged in - initialize services
        await initializeAppServices();
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

    // Subscribe to MCP status updates
    const unsubscribeMCPStatus = window.electronAPI.unrealMcp.onStatusChange((status) => {
      setUnrealMCPStatus(status);
    });
    window.electronAPI.unrealMcp.getStatus().then(setUnrealMCPStatus);

    // Listen for focus-input hotkey to expand (always expand, don't toggle)
    const unsubscribeFocus = window.electronAPI.onFocusInput(() => {
      setViewMode((current) => {
        if (current === 'login') return current; // Don't switch away from login
        return 'chat';
      });
      setCollapsed(false);
    });

    // Cleanup
    return () => {
      unsubscribeConnectorStatus();
      unsubscribeContextUpdate();
      unsubscribeFocus();
      unsubscribeMCPStatus();
    };
  }, [setCollapsed, setConnectorStatus, setCurrentContext, setSettings, setHotkeyConfig, setAuthState, setDailyUsage, setUnrealMCPStatus]);

  const handleLogin = async (email: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const authResult = await window.electronAPI.auth.login(email);
      setAuthState(authResult);

      // Initialize the rest of the app
      await initializeAppServices();

      setViewMode('collapsed');
      setCollapsed(true);
      window.electronAPI?.window.collapse(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Failed to sign in');
    }
    setIsLoggingIn(false);
  };

  const handleLogout = async () => {
    await window.electronAPI.auth.logout();
    clearAuth();
    window.electronAPI?.window.exitSettings();
    setViewMode('login');
    setCollapsed(false);
    window.electronAPI?.window.collapse(false);
  };

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
    window.electronAPI?.window.enterSettings();
  };

  const handleClose = () => {
    setViewMode('collapsed');
    setCollapsed(true);
    window.electronAPI?.window.collapse(true);
  };

  const handleBackToChat = () => {
    setViewMode('chat');
    window.electronAPI?.window.exitSettings();
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
      {/* Notch Bar - Hidden during login */}
      {viewMode !== 'login' && (
        <NotchBar
          isExpanded={isExpanded}
          onToggle={handleToggleExpanded}
          onSettings={handleOpenSettings}
          isLoading={isLoading}
          robotStatus={robotStatus}
        />
      )}

      {/* Login Screen */}
      {viewMode === 'login' && (
        <LoginScreen
          onLogin={handleLogin}
          isLoading={isLoggingIn}
          error={loginError}
        />
      )}

      {/* Chat Panel - Shows when in chat mode */}
      {viewMode === 'chat' && (
        <ExpandedPanel onClose={handleClose} />
      )}

      {/* Settings Panel - Shows when in settings mode */}
      {viewMode === 'settings' && (
        <SettingsPanel onClose={handleClose} onBack={handleBackToChat} onLogout={handleLogout} />
      )}
    </div>
  );
}

export default App;
