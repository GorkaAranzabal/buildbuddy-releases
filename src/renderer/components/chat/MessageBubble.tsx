import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage, DocImage } from '../../../shared/types';
import { parseContentParts } from './contentParser';
import { DocImageEmbed } from './DocImageEmbed';
import { useAppStore } from '../../store';

/** Extract numbered-list steps from an assistant message, returns [] if none found. */
function extractSteps(content: string): string[] {
  const lines = content.split('\n');
  const steps: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s+(.+)/);
    if (match) steps.push(match[1].trim());
  }
  return steps;
}

interface MessageBubbleProps {
  message: ChatMessage;
}

// YouTube thumbnail component
const YouTubeThumbnail = ({ videoId, title }: { videoId: string; title: string }) => {
  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const handleClick = () => {
    window.open(videoUrl, '_blank');
  };

  return (
    <div
      onClick={handleClick}
      className="my-3 cursor-pointer group rounded-xl overflow-hidden border border-white/[0.15] hover:border-purple-400/50 transition-all"
      style={{ maxWidth: '320px' }}
    >
      <div className="relative">
        <img
          src={thumbnailUrl}
          alt={title}
          className="w-full h-auto"
          style={{ aspectRatio: '16/9', objectFit: 'cover' }}
        />
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-all">
          <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {/* Gorka Games badge */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-purple-600/90 text-white text-xs font-medium">
          Gorka Games
        </div>
      </div>
      <div className="p-2.5 bg-white/[0.05]">
        <p className="text-sm text-white/90 font-medium line-clamp-2">{title}</p>
        <p className="text-xs text-white/50 mt-1">YouTube Tutorial</p>
      </div>
    </div>
  );
};

// Custom component for highlighted keywords (rendered from backticks/code)
const HighlightedKeyword = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md bg-blue-500/20 text-[#60a5fa] font-semibold border border-blue-400/40">
    {children}
  </span>
);

// Custom components for ReactMarkdown to style code/keywords as blue highlights
const markdownComponents = {
  code: ({ children, className }: { children: React.ReactNode; className?: string }) => {
    // If it's an inline code block (no className means not a code fence), highlight it
    if (!className) {
      return <HighlightedKeyword>{children}</HighlightedKeyword>;
    }
    // For code blocks with language, render normally
    return <code className={className}>{children}</code>;
  },
  // Also highlight strong/bold text in blue for emphasis
  strong: ({ children }: { children: React.ReactNode }) => (
    <span className="font-semibold text-blue-300">{children}</span>
  ),
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [cachedDocImages, setCachedDocImages] = useState<Record<string, DocImage[]>>(
    message.docImages ?? {}
  );
  const { enterGuidedMode, guidedSteps } = useAppStore();
  const isUser = message.role === 'user';

  // Detect numbered steps in assistant messages so we can offer guided mode
  const steps = useMemo(() => {
    if (isUser) return [];
    return extractSteps(message.content);
  }, [isUser, message.content]);

  const handleWalkThrough = () => {
    if (steps.length === 0) return;
    enterGuidedMode(steps, message.id, message.content);
  };

  const handleDocImagesLoaded = (query: string, images: DocImage[]) => {
    setCachedDocImages((prev) => ({ ...prev, [query]: images }));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-white/[0.12] text-white border border-white/[0.15]'
            : 'bg-white/[0.08] text-white/95 border border-white/[0.12]'
        }`}
      >
        {/* Message content */}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="markdown-content text-sm">
            {(() => {
              const parts = parseContentParts(message.content);
              return parts.map((part, index) => {
                if (part.type === 'youtube') {
                  return <YouTubeThumbnail key={index} videoId={part.videoId} title={part.title} />;
                }
                if (part.type === 'docimage') {
                  return (
                    <DocImageEmbed
                      key={index}
                      query={part.query}
                      prefetchedImages={cachedDocImages[part.query]}
                      onImagesLoaded={handleDocImagesLoaded}
                    />
                  );
                }
                return <ReactMarkdown key={index} components={markdownComponents}>{part.content}</ReactMarkdown>;
              });
            })()}
          </div>
        )}

        {/* Badges: remote control order + screenshot */}
        {(message.isOrder || message.attachedScreenshot) && (
          <div className="mt-1.5 flex items-center justify-end gap-2.5 flex-wrap">
            {message.isOrder && (
              <div className="flex items-center gap-1 text-xs text-purple-300/70">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Remote control</span>
              </div>
            )}
            {message.attachedScreenshot && (
              <div className="flex items-center gap-1 text-xs text-white/50">
                <span>Sent with screenshot</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            )}
          </div>
        )}


        {/* "Walk me through this" guided mode button — shown on assistant messages with numbered steps */}
        {!isUser && steps.length >= 2 && !guidedSteps && (
          <button
            onClick={handleWalkThrough}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/25 text-blue-300 text-xs font-medium transition-all"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Walk me through this
          </button>
        )}

        {/* Copy button (assistant messages only) */}
        {!isUser && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200 bg-white/[0.1] hover:bg-white/[0.18] text-white/50 hover:text-white/80"
            title="Copy to clipboard"
          >
            {copied ? (
              <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )}
          </button>
        )}

        {/* Timestamp */}
        <div
          className={`text-xs mt-1.5 ${
            isUser ? 'text-white/50' : 'text-white/40'
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}
