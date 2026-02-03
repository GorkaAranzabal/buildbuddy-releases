import React from 'react';

interface StatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'connecting';
  label?: string;
  showLabel?: boolean;
}

export function StatusIndicator({ status, label, showLabel = true }: StatusIndicatorProps) {
  const statusConfig = {
    connected: {
      color: 'bg-green-400',
      label: label || 'Connected',
      bgColor: 'bg-green-900/30',
      textColor: 'text-green-400',
      pulse: true,
    },
    disconnected: {
      color: 'bg-red-400',
      label: label || 'Disconnected',
      bgColor: 'bg-red-900/30',
      textColor: 'text-red-400',
      pulse: false,
    },
    connecting: {
      color: 'bg-yellow-400',
      label: label || 'Connecting...',
      bgColor: 'bg-yellow-900/30',
      textColor: 'text-yellow-400',
      pulse: true,
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${config.bgColor} ${config.textColor}`}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full ${config.color} ${config.pulse ? 'status-pulse' : ''}`}
      />
      {showLabel && <span>{config.label}</span>}
    </div>
  );
}
