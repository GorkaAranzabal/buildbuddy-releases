import React from 'react';
import type { ExecutionProgress, AgentAction } from '../../../shared/types';

interface ExecutionOverlayProps {
  progress: ExecutionProgress;
  onStop: () => void;
}

function describeAction(action: AgentAction | null): string {
  if (!action) return 'Preparing...';
  
  switch (action.type) {
    case 'focus_window':
      return `Focusing "${action.titleIncludes}"`;
    case 'click':
      return `Clicking (${action.x}, ${action.y})`;
    case 'double_click':
      return `Double-clicking (${action.x}, ${action.y})`;
    case 'right_click':
      return `Right-clicking (${action.x}, ${action.y})`;
    case 'type_text':
      return `Typing "${action.text.substring(0, 20)}${action.text.length > 20 ? '...' : ''}"`;
    case 'key_press':
      return `Pressing ${action.keys}`;
    case 'wait':
      return `Waiting ${action.ms}ms`;
    case 'done':
      return 'Finishing up';
    default:
      return 'Executing...';
  }
}

export function ExecutionOverlay({ progress, onStop }: ExecutionOverlayProps) {
  const { status, currentStep, totalSteps, currentAction, error } = progress;
  
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const isStopped = status === 'stopped';

  const getStatusColor = () => {
    if (isCompleted) return 'bg-green-500';
    if (isError || isStopped) return 'bg-red-500';
    return 'bg-blue-500';
  };

  const getStatusIcon = () => {
    if (isCompleted) return '✓';
    if (isError) return '✕';
    if (isStopped) return '⏹';
    return null;
  };

  return (
    <div 
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
      style={{
        animation: 'slideUp 0.3s ease-out',
      }}
    >
      <div 
        className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
          isRunning ? 'border-blue-500/30' : isCompleted ? 'border-green-500/30' : 'border-red-500/30'
        }`}
        style={{
          background: 'rgba(20, 20, 20, 0.95)',
          backdropFilter: 'blur(40px)',
          minWidth: '320px',
        }}
      >
        {/* Status indicator */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${getStatusColor()}`}>
          {isRunning ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-white text-sm font-bold">{getStatusIcon()}</span>
          )}
        </div>

        {/* Status text */}
        <div className="flex-1">
          <div className="text-white/90 text-sm font-medium">
            {isRunning && `Step ${currentStep}/${totalSteps}`}
            {isCompleted && 'Completed'}
            {isError && 'Error'}
            {isStopped && 'Stopped'}
          </div>
          <div className="text-white/50 text-xs">
            {isRunning && describeAction(currentAction)}
            {isCompleted && 'All actions executed successfully'}
            {isError && error}
            {isStopped && 'Execution stopped by user'}
          </div>
        </div>

        {/* Progress bar */}
        {isRunning && (
          <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        )}

        {/* Stop button */}
        {isRunning && (
          <button
            onClick={onStop}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-medium transition-all flex items-center gap-1"
          >
            <span>⏹</span>
            <span>STOP</span>
          </button>
        )}

        {/* ESC hint */}
        {isRunning && (
          <span className="text-white/30 text-xs">ESC×2</span>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translate(-50%, 20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>
    </div>
  );
}
