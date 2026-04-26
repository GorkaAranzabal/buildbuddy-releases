import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ReactFlowProvider,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { ParsedGraph } from '../../../shared/blueprints/types';
import { toReactFlow } from './graphAdapter';
import { BlueprintNode } from './nodes/BlueprintNode';
import { CommentNode } from './nodes/CommentNode';

const nodeTypes: NodeTypes = {
  blueprint: BlueprintNode,
  comment: CommentNode,
};

interface GraphPreviewProps {
  graph: ParsedGraph;
  width: number;
  height: number;
}

export function GraphPreview({ graph, width, height }: GraphPreviewProps) {
  const { nodes, edges } = useMemo(() => toReactFlow(graph), [graph]);

  return (
    <div
      className="rounded-xl overflow-hidden border border-white/[0.08]"
      style={{
        width,
        height,
        background: 'rgba(0,0,0,0.35)',
      }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          elevateNodesOnSelect={false}
          minZoom={0.25}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'transparent' }}
        >
          <Background color="rgba(255,255,255,0.06)" gap={24} />
          <Controls
            showInteractive={false}
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
