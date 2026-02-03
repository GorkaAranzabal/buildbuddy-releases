import React from 'react';

interface PermissionModalProps {
  platform: string;
  onClose: () => void;
}

export function PermissionModal({ platform, onClose }: PermissionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative w-[420px] rounded-2xl border border-white/[0.15] overflow-hidden"
        style={{
          background: 'rgba(20, 20, 20, 0.95)',
          backdropFilter: 'blur(40px)',
        }}
      >
        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Icon */}
          <div className="w-16 h-16 mx-auto rounded-2xl bg-yellow-500/20 flex items-center justify-center">
            <span className="text-3xl">🔐</span>
          </div>

          {/* Title */}
          <div className="text-center">
            <h2 className="text-white font-semibold text-lg">Accessibility Permission Required</h2>
            <p className="text-white/60 text-sm mt-1">
              BuildBuddy needs permission to control your {platform === 'macOS' ? 'Mac' : 'computer'}
            </p>
          </div>

          {/* Instructions */}
          {platform === 'macOS' ? (
            <div className="space-y-3 text-sm">
              <p className="text-white/80">To enable "Do it for me" actions:</p>
              <ol className="space-y-2 text-white/70">
                <li className="flex gap-2">
                  <span className="text-white/40 font-mono">1.</span>
                  <span>Open <strong className="text-white/90">System Preferences</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="text-white/40 font-mono">2.</span>
                  <span>Go to <strong className="text-white/90">Security & Privacy → Privacy</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="text-white/40 font-mono">3.</span>
                  <span>Select <strong className="text-white/90">Accessibility</strong> from the sidebar</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-white/40 font-mono">4.</span>
                  <span>Click the <strong className="text-white/90">🔒 lock</strong> to make changes</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-white/40 font-mono">5.</span>
                  <span>Check the box next to <strong className="text-white/90">BuildBuddy</strong></span>
                </li>
              </ol>
            </div>
          ) : (
            <div className="text-sm text-white/70">
              <p>
                This feature requires permission to send mouse and keyboard events.
                Please ensure no security software is blocking automation.
              </p>
            </div>
          )}

          {/* Note */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-blue-200/80 text-xs">
              💡 After granting permission, you may need to restart BuildBuddy for changes to take effect.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.1]">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-white/80 text-sm font-medium transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
