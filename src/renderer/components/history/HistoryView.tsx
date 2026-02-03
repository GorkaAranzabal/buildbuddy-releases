import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { SessionCard } from './SessionCard';
import { SessionDetail } from './SessionDetail';
import type { Session } from '../../../shared/types';

export function HistoryView() {
  const sessions = useAppStore((state) => state.sessions);
  const setSessions = useAppStore((state) => state.setSessions);
  const removeSession = useAppStore((state) => state.removeSession);

  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const loadedSessions = await window.electronAPI.storage.getSessions();
        setSessions(loadedSessions);
      } catch (error) {
        console.error('Failed to load sessions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSessions();
  }, [setSessions]);

  const handleDeleteSession = async (id: string) => {
    try {
      await window.electronAPI.storage.deleteSession(id);
      removeSession(id);
      if (selectedSession?.id === id) {
        setSelectedSession(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleExport = async (session: Session, format: 'markdown' | 'json') => {
    try {
      const content = format === 'markdown'
        ? formatAsMarkdown(session)
        : JSON.stringify(session, null, 2);

      await navigator.clipboard.writeText(content);
      alert(`Session copied to clipboard as ${format.toUpperCase()}`);
    } catch (error) {
      console.error('Failed to export session:', error);
    }
  };

  if (selectedSession) {
    return (
      <SessionDetail
        session={selectedSession}
        onBack={() => setSelectedSession(null)}
        onExport={handleExport}
        onDelete={() => handleDeleteSession(selectedSession.id)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-overlay-border">
        <h2 className="text-sm font-medium text-zinc-200">Session History</h2>
        <span className="text-xs text-zinc-500">{sessions.length} sessions</span>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-zinc-500 text-sm">Loading sessions...</div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-zinc-500 px-4">
            <svg
              className="w-12 h-12 mb-3 text-zinc-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm font-medium mb-1">No session history</p>
            <p className="text-xs text-zinc-600">
              Your conversations will appear here after you ask questions.
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onClick={() => setSelectedSession(session)}
              onDelete={() => handleDeleteSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function formatAsMarkdown(session: Session): string {
  const lines: string[] = [
    `# Gorka Copilot Session`,
    ``,
    `**Date:** ${new Date(session.timestamp).toLocaleString()}`,
    ``,
    `## Question`,
    ``,
    session.prompt,
    ``,
    `## Response`,
    ``,
    session.response.raw,
    ``,
  ];

  if (session.context?.projectInfo) {
    lines.push(`## Context`);
    lines.push(``);
    lines.push(`- Project: ${session.context.projectInfo.project_name}`);
    lines.push(`- Engine: UE ${session.context.projectInfo.engine_version}`);
    lines.push(``);
  }

  return lines.join('\n');
}
