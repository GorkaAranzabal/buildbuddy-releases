import React from 'react';
import type { ActionPlan, AgentAction } from '../../../shared/types';

interface ActionPlanModalProps {
  plan: ActionPlan;
  onApprove: () => void;
  onCancel: () => void;
}

function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'focus_window':
      return `Focus window: "${action.titleIncludes}"`;
    case 'click':
      return `Click at (${action.x}, ${action.y})`;
    case 'double_click':
      return `Double-click at (${action.x}, ${action.y})`;
    case 'right_click':
      return `Right-click at (${action.x}, ${action.y})`;
    case 'type_text':
      return `Type: "${action.text.substring(0, 40)}${action.text.length > 40 ? '...' : ''}"`;
    case 'key_press':
      return `Press: ${action.keys}`;
    case 'wait':
      return `Wait ${action.ms}ms`;
    case 'done':
      return `Done: ${action.reason}`;
    default:
      return 'Unknown action';
  }
}

function getActionIcon(action: AgentAction): string {
  switch (action.type) {
    case 'focus_window': return '🪟';
    case 'click': return '👆';
    case 'double_click': return '👆👆';
    case 'right_click': return '👆';
    case 'type_text': return '⌨️';
    case 'key_press': return '⌨️';
    case 'wait': return '⏳';
    case 'done': return '✅';
    default: return '❓';
  }
}

export function ActionPlanModal({ plan, onApprove, onCancel }: ActionPlanModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      
      {/* Modal */}
      <div 
        className="relative w-[480px] max-h-[80vh] rounded-2xl border border-white/[0.15] overflow-hidden flex flex-col"
        style={{
          background: 'rgba(20, 20, 20, 0.95)',
          backdropFilter: 'blur(40px)',
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.1]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <span className="text-xl">🤖</span>
            </div>
            <div>
              <h2 className="text-white font-semibold">Action Plan Preview</h2>
              <p className="text-white/60 text-sm">Review before executing</p>
            </div>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Goal */}
          <div>
            <h3 className="text-white/50 text-xs uppercase tracking-wide mb-1">Goal</h3>
            <p className="text-white/90 text-sm">{plan.goal}</p>
          </div>

          {/* Assumptions */}
          {plan.assumptions.length > 0 && (
            <div>
              <h3 className="text-white/50 text-xs uppercase tracking-wide mb-2">Assumptions</h3>
              <ul className="space-y-1">
                {plan.assumptions.map((assumption, i) => (
                  <li key={i} className="text-white/70 text-sm flex items-start gap-2">
                    <span className="text-white/40">•</span>
                    <span>{assumption}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div>
            <h3 className="text-white/50 text-xs uppercase tracking-wide mb-2">
              Actions ({plan.actions.length})
            </h3>
            <div className="space-y-2">
              {plan.actions.map((action, i) => (
                <div 
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08]"
                >
                  <span className="text-white/40 text-xs font-mono w-6">{i + 1}.</span>
                  <span className="text-base">{getActionIcon(action)}</span>
                  <span className="text-white/80 text-sm flex-1">{describeAction(action)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Safety Notes */}
          {plan.safety_notes.length > 0 && (
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <h3 className="text-yellow-400/80 text-xs uppercase tracking-wide mb-2 flex items-center gap-1">
                <span>⚠️</span> Safety Notes
              </h3>
              <ul className="space-y-1">
                {plan.safety_notes.map((note, i) => (
                  <li key={i} className="text-yellow-200/70 text-sm">{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.1] flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white/80 text-sm font-medium transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onApprove}
            className="flex-1 px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
          >
            <span>✓</span>
            <span>Approve & Execute</span>
          </button>
        </div>

        {/* ESC hint */}
        <div className="absolute top-4 right-4">
          <span className="text-white/30 text-xs">ESC to cancel</span>
        </div>
      </div>
    </div>
  );
}
