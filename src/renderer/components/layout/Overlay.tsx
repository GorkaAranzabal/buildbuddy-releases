import React from 'react';

interface OverlayProps {
  children: React.ReactNode;
}

export function Overlay({ children }: OverlayProps) {
  return (
    <div 
      className="w-full h-full overflow-hidden rounded-[20px] border border-white/[0.15] shadow-2xl"
      style={{
        background: 'rgba(255, 255, 255, 0.01)',
        backdropFilter: 'blur(60px) saturate(180%)',
        WebkitBackdropFilter: 'blur(60px) saturate(180%)',
      }}
    >
      {children}
    </div>
  );
}
