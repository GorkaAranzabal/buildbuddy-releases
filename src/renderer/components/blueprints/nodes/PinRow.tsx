import React from 'react';
import { Handle, Position } from 'reactflow';
import type { ParsedPin } from '../../../../shared/blueprints/types';
import { pinColor } from '../../../../shared/blueprints/pinTypes';

interface PinRowProps {
  pin: ParsedPin;
  nodeId: string;
}

export function PinRow({ pin, nodeId: _nodeId }: PinRowProps) {
  const isInput = pin.direction === 'input';
  const color = pinColor(pin.type);
  const isExec = pin.isExec;

  const dot = (
    <span
      className="inline-block flex-shrink-0"
      style={{
        width: 10,
        height: 10,
        borderRadius: isExec ? 2 : '50%',
        background: color,
        border: isExec ? '1px solid rgba(0,0,0,0.4)' : 'none',
      }}
    />
  );

  return (
    <div
      className={`flex items-center gap-1.5 text-[10px] text-white/80 ${
        isInput ? 'justify-start' : 'justify-end'
      }`}
      style={{ padding: '2px 8px', minHeight: 16 }}
    >
      <Handle
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        id={pin.id}
        style={{
          width: 8,
          height: 8,
          background: color,
          border: 'none',
          [isInput ? 'left' : 'right']: -4,
        }}
        isConnectable={false}
      />
      {isInput && dot}
      <span className="truncate max-w-[90px]">{pin.name}</span>
      {!isInput && dot}
    </div>
  );
}
