import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { ContextChips } from './ContextChips';
import { MessageBubble } from './MessageBubble';
import { StreamingMessage } from './StreamingMessage';
import { InputArea } from './InputArea';
import type { ChatMessage } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

export function ChatView() {
  const {
    messages,
    isLoading,
    streamingResponse,
    attachedScreenshot,
    currentContext,
    addMessage,
    setLoading,
    setStreamingResponse,
    appendStreamingResponse,
    setAttachedScreenshot,
  } = useAppStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingResponse]);

  // Set up AI response listeners
  useEffect(() => {
    const unsubscribeStream = window.electronAPI.ai.onStream((chunk) => {
      appendStreamingResponse(chunk);
    });

    const unsubscribeComplete = window.electronAPI.ai.onComplete(() => {
      // Finalize the message
      if (streamingResponse) {
        const assistantMessage: ChatMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: streamingResponse,
          timestamp: Date.now(),
        };
        addMessage(assistantMessage);
        setStreamingResponse('');
      }
      setLoading(false);
    });

    const unsubscribeError = window.electronAPI.ai.onError((error) => {
      console.error('AI error:', error.message);
      setLoading(false);
      setStreamingResponse('');
      // Add error message
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
    });

    return () => {
      unsubscribeStream();
      unsubscribeComplete();
      unsubscribeError();
    };
  }, [addMessage, appendStreamingResponse, setLoading, setStreamingResponse, streamingResponse]);

  // Set up screenshot capture listener
  useEffect(() => {
    const unsubscribe = window.electronAPI.capture.onResult((result) => {
      setAttachedScreenshot(result);
    });

    return () => {
      unsubscribe();
    };
  }, [setAttachedScreenshot]);

  const handleSend = (prompt: string) => {
    if (!prompt.trim() || isLoading) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      attachedContext: currentContext || undefined,
      attachedScreenshot: attachedScreenshot
        ? { id: attachedScreenshot.id, thumbnailPath: attachedScreenshot.imagePath }
        : undefined,
    };
    addMessage(userMessage);

    // Clear streaming response and start loading
    setStreamingResponse('');
    setLoading(true);

    // Send to AI
    window.electronAPI.ai.ask({
      prompt,
      context: currentContext,
      screenshot: attachedScreenshot,
      mode: 'general',
    });

    // Clear attached screenshot after sending
    setAttachedScreenshot(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Context chips */}
      <ContextChips />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && !streamingResponse && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg
              className="w-12 h-12 mb-3 text-white/30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-sm font-medium mb-1 text-white/70">Ask me anything about Unreal Engine</p>
            <p className="text-xs text-white/40">
              I can help with packaging errors, compile issues, blueprints, and more.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {streamingResponse && <StreamingMessage content={streamingResponse} />}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <InputArea onSend={handleSend} isLoading={isLoading} />
    </div>
  );
}
