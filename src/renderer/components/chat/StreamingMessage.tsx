import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface StreamingMessageProps {
  content: string;
}

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
      <div className="group relative max-w-[85%] rounded-lg px-3 py-2 bg-zinc-800 text-zinc-100">
        <div className="markdown-content text-sm">
          <ReactMarkdown>{displayContent}</ReactMarkdown>
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
