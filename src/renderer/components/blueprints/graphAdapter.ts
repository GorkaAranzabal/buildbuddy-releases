import type { Edge, Node } from 'reactflow';
import type { ParsedGraph, ParsedNode, ParsedComment, PinType } from '../../../shared/blueprints/types';
import { pinColor } from '../../../shared/blueprints/pinTypes';

export interface BlueprintNodeData {
  node: ParsedNode;
}

export interface CommentNodeData {
  comment: ParsedComment;
}

export function toReactFlow(graph: ParsedGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];

  for (const c of graph.comments) {
    nodes.push({
      id: c.id,
      type: 'comment',
      position: { x: c.x, y: c.y },
      data: { comment: c } as CommentNodeData,
      selectable: false,
      draggable: false,
      style: { width: c.w, height: c.h, zIndex: -1 },
      zIndex: -1,
    });
  }

  for (const n of graph.nodes) {
    nodes.push({
      id: n.id,
      type: 'blueprint',
      position: { x: n.x, y: n.y },
      data: { node: n } as BlueprintNodeData,
      zIndex: 1,
    });
  }

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourcePin,
    targetHandle: e.targetPin,
    type: 'default',
    animated: false,
    style: {
      stroke: pinColor(e.pinType),
      strokeWidth: e.pinType === 'exec' ? 2.5 : 1.5,
    },
  }));

  return { nodes, edges };
}

export function edgeColor(type: PinType): string {
  return pinColor(type);
}
