import React, { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { CommentNodeData } from '../graphAdapter';

function CommentNodeComponent({ data }: NodeProps<CommentNodeData>) {
  const { comment } = data;
  return (
    <div
      className="rounded-md"
      style={{
        width: comment.w,
        height: comment.h,
        background: comment.tint,
        border: `1px dashed ${comment.tint.replace('0.18', '0.35')}`,
        color: 'rgba(255,255,255,0.7)',
        fontSize: 11,
        padding: 6,
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      {comment.text}
    </div>
  );
}

export const CommentNode = memo(CommentNodeComponent);
