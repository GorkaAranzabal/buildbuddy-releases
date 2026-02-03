import React from 'react';
import type { Session } from '../../../shared/types';

interface SessionCardProps {
  session: Session;
  onClick: () => void;
  onDelete: () => void;
}

export function SessionCard({ session, onClick, onDelete }: SessionCardProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this session?')) {
      onDelete();
    }
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + '...';
  };

  return (
    <div
      onClick={onClick}
      className="group p-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-zinc-700"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Prompt preview */}
          <p className="text-sm text-zinc-200 font-medium truncate">
            {truncateText(session.prompt, 50)}
          </p>

          {/* Response preview */}
          <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
            {truncateText(session.response.raw, 100)}
          </p>

          {/* Metadata */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-zinc-600">{formatDate(session.timestamp)}</span>
            {session.context?.projectInfo && (
              <span className="text-xs text-zinc-600 flex items-center gap-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                {session.context.projectInfo.project_name}
              </span>
            )}
            {session.screenshotPath && (
              <span className="text-xs text-zinc-600 flex items-center gap-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                Screenshot
              </span>
            )}
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={handleDelete}
          className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
          title="Delete session"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
