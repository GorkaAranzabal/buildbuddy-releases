import React, { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { BlueprintNodeData } from '../graphAdapter';
import { PinRow } from './PinRow';

function BlueprintNodeComponent({ data, id }: NodeProps<BlueprintNodeData>) {
  const { node } = data;
  const execInputs = node.inputs.filter((p) => p.isExec);
  const dataInputs = node.inputs.filter((p) => !p.isExec);
  const execOutputs = node.outputs.filter((p) => p.isExec);
  const dataOutputs = node.outputs.filter((p) => !p.isExec);
  const maxRows = Math.max(
    execInputs.length + dataInputs.length,
    execOutputs.length + dataOutputs.length,
  );

  return (
    <div
      className="rounded-md overflow-hidden shadow-lg"
      style={{
        background: 'rgba(30,30,33,0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        minWidth: 160,
      }}
    >
      <div
        className="px-2 py-1 text-[11px] font-semibold text-white truncate"
        style={{
          background: node.headerColor,
          textShadow: '0 1px 1px rgba(0,0,0,0.5)',
        }}
      >
        {node.collapsed ? '▼ ' : ''}
        {node.title}
      </div>
      <div className="flex" style={{ minHeight: Math.max(24, maxRows * 18) }}>
        <div className="flex flex-col flex-1 py-1">
          {[...execInputs, ...dataInputs].map((p) => (
            <PinRow key={p.id} pin={p} nodeId={id} />
          ))}
        </div>
        <div className="flex flex-col flex-1 py-1">
          {[...execOutputs, ...dataOutputs].map((p) => (
            <PinRow key={p.id} pin={p} nodeId={id} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const BlueprintNode = memo(BlueprintNodeComponent);
