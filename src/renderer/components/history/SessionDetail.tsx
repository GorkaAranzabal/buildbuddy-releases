import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Session } from '../../../shared/types';

interface SessionDetailProps {
  session: Session;
  onBack: () => void;
  onExport: (session: Session, format: 'markdown' | 'json') => void;
  onDelete: () => void;
}

export function SessionDetail({ session, onBack, onExport, onDelete }: SessionDetailProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleDelete = () => {
    if (confirm('Delete this session? This cannot be undone.')) {
      onDelete();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-overlay-border">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-2">
          {/* Export button */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="p-1.5 rounded hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Export session"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
            </button>

            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
                <button
                  onClick={() => {
                    onExport(session, 'markdown');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700/50"
                >
                  Copy as Markdown
                </button>
                <button
                  onClick={() => {
                    onExport(session, 'json');
                    setShowExportMenu(false);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700/50"
                >
                  Copy as JSON
                </button>
              </div>
            )}
          </div>

          {/* Delete button */}
          <button
            onClick={handleDelete}
            className="p-1.5 rounded hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-colors"
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Timestamp and metadata */}
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{new Date(session.timestamp).toLocaleString()}</span>
          {session.context?.projectInfo && (
            <>
              <span>•</span>
              <span>{session.context.projectInfo.project_name}</span>
              <span>•</span>
              <span>UE {session.context.projectInfo.engine_version}</span>
            </>
          )}
        </div>

        {/* Question */}
        <div>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
            Question
          </h3>
          <div className="p-3 bg-blue-600/20 border border-blue-600/30 rounded-lg">
            <p className="text-sm text-zinc-100 whitespace-pre-wrap">{session.prompt}</p>
          </div>
        </div>

        {/* Response */}
        <div>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
            Response
          </h3>
          <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg">
            <div className="markdown-content text-sm text-zinc-100">
              <ReactMarkdown>{session.response.raw}</ReactMarkdown>
            </div>
          </div>
        </div>

        {/* Context (if available) */}
        {session.context?.lastError && (
          <div>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
              Error Context
            </h3>
            <div className="p-3 bg-red-900/20 border border-red-900/30 rounded-lg">
              <p className="text-xs text-zinc-400 mb-1">
                Type: {session.context.lastError.error_type}
              </p>
              <pre className="text-xs text-red-300 whitespace-pre-wrap overflow-x-auto">
                {session.context.lastError.raw_block.slice(0, 500)}
                {session.context.lastError.raw_block.length > 500 && '...'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
