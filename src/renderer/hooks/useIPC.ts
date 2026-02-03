import { useEffect, useCallback } from 'react';

/**
 * Hook for IPC communication with the main process
 */
export function useIPC() {
  // Window controls
  const toggleWindow = useCallback(() => {
    window.electronAPI.window.toggle();
  }, []);

  const collapseWindow = useCallback((collapsed: boolean) => {
    window.electronAPI.window.collapse(collapsed);
  }, []);

  const pinWindow = useCallback((pinned: boolean) => {
    window.electronAPI.window.pin(pinned);
  }, []);

  // Screenshot capture
  const captureFullscreen = useCallback(() => {
    window.electronAPI.capture.fullscreen();
  }, []);

  const captureWindow = useCallback((windowId: string) => {
    window.electronAPI.capture.window(windowId);
  }, []);

  const captureRegion = useCallback(() => {
    window.electronAPI.capture.region();
  }, []);

  // AI
  const askAI = useCallback((request: Parameters<typeof window.electronAPI.ai.ask>[0]) => {
    window.electronAPI.ai.ask(request);
  }, []);

  // Connector
  const requestSnapshot = useCallback(() => {
    window.electronAPI.connector.requestSnapshot();
  }, []);

  return {
    // Window
    toggleWindow,
    collapseWindow,
    pinWindow,

    // Capture
    captureFullscreen,
    captureWindow,
    captureRegion,

    // AI
    askAI,

    // Connector
    requestSnapshot,
  };
}

/**
 * Hook to listen for capture results
 */
export function useCaptureResult(
  callback: Parameters<typeof window.electronAPI.capture.onResult>[0]
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.capture.onResult(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen for AI stream
 */
export function useAIStream(
  callback: Parameters<typeof window.electronAPI.ai.onStream>[0]
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.ai.onStream(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen for AI completion
 */
export function useAIComplete(
  callback: Parameters<typeof window.electronAPI.ai.onComplete>[0]
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.ai.onComplete(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen for AI errors
 */
export function useAIError(
  callback: Parameters<typeof window.electronAPI.ai.onError>[0]
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.ai.onError(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen for connector status changes
 */
export function useConnectorStatus(
  callback: Parameters<typeof window.electronAPI.connector.onStatusChange>[0]
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.connector.onStatusChange(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen for context updates
 */
export function useContextUpdate(
  callback: Parameters<typeof window.electronAPI.connector.onContextUpdate>[0]
) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.connector.onContextUpdate(callback);
    return () => unsubscribe();
  }, [callback]);
}

/**
 * Hook to listen for focus input events (from hotkey)
 */
export function useFocusInput(callback: () => void) {
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFocusInput(callback);
    return () => unsubscribe();
  }, [callback]);
}
