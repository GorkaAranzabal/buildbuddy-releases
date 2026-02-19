import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseContentParts } from './contentParser';
import { DocImageEmbed } from './DocImageEmbed';

interface StreamingMessageProps {
  content: string;
}

// YouTube thumbnail component (compact version for streaming)
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-all">
          <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center group-hover:scale-110 transition-transform">
            <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
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

export function StreamingMessage({ content }: StreamingMessageProps) {
  const [displayContent, setDisplayContent] = useState('');
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Batch updates to reduce re-renders (update at 20fps max)
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (contentRef.current !== displayContent) {
        setDisplayContent(contentRef.current);
      }
    }, 50);

    return () => clearInterval(intervalId);
  }, [displayContent]);

  return (
    <div className="flex justify-start">
      <div className="group relative max-w-[85%] rounded-2xl px-4 py-2.5 bg-white/[0.08] text-white/95 border border-white/[0.12]">
        <div className="markdown-content text-sm">
          {(() => {
            const parts = parseContentParts(displayContent);
            return parts.map((part, index) => {
              if (part.type === 'youtube') {
                return <YouTubeThumbnail key={index} videoId={part.videoId} title={part.title} />;
              }
              if (part.type === 'docimage') {
                return <DocImageEmbed key={index} query={part.query} />;
              }
              return <ReactMarkdown key={index} components={markdownComponents}>{part.content}</ReactMarkdown>;
            });
          })()}
        </div>

        {/* Typing indicator */}
        <div className="flex items-center gap-1 mt-2">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
          <span
            className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"
            style={{ animationDelay: '0.2s' }}
          />
          <span
            className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"
            style={{ animationDelay: '0.4s' }}
          />
        </div>
      </div>
    </div>
  );
}
