// 🎣 NOOB EXPLAINER: What is a React Hook?
// A "hook" is a reusable piece of React logic. This hook makes it
// super easy for any component to start a streaming humanization
// and get the results in real-time.
//
// Usage in a component:
//   const { humanizedText, isStreaming, cancel, startHumanize } = useHumanizeStream();
//   
//   // Start humanizing
//   startHumanize({ text: "AI text here...", options, apiKey });
//   
//   // Display streaming text
//   <p>{humanizedText}</p>
//   
//   // Cancel if needed
//   <button onClick={cancel}>Stop</button>

'use client';

import { useState, useCallback, useRef } from 'react';
import type { HumanizationOptions } from '@/lib/types';

interface UseHumanizeStreamReturn {
  humanizedText: string;
  isStreaming: boolean;
  error: string | null;
  progress: number;  // 0-100 estimated progress
  startHumanize: (params: { text: string; options: HumanizationOptions; apiKey: string }) => void;
  cancel: () => void;
  reset: () => void;
}

export function useHumanizeStream(): UseHumanizeStreamReturn {
  const [humanizedText, setHumanizedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startHumanize = useCallback(async ({
    text,
    options,
    apiKey,
  }: {
    text: string;
    options: HumanizationOptions;
    apiKey: string;
  }) => {
    // 🛑 NOOB EXPLAINER: AbortController
    // This lets us CANCEL the streaming request if the user
    // clicks "Stop". It's like hanging up the phone.
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setHumanizedText('');
    setError(null);
    setIsStreaming(true);
    setProgress(10);

    try {
      const response = await fetch('/api/humanize-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, options, apiKey }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      setProgress(30);

      // 📖 NOOB EXPLAINER: Reading the stream
      // The server sends text in small chunks. We read each chunk
      // and add it to the display immediately. This is why you see
      // text appearing word by word instead of all at once.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No readable stream');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        
        // Parse the AI SDK data stream format
        // The stream sends lines like: 0:"token text here"
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('0:')) {
            try {
              const token = JSON.parse(line.slice(2));
              accumulated += token;
              setHumanizedText(accumulated);
            } catch {
              // Skip malformed lines
            }
          }
        }

        // Estimate progress based on accumulated length vs input length
        const inputLen = text.length;
        const currentProgress = Math.min(90, 30 + (accumulated.length / inputLen) * 60);
        setProgress(currentProgress);
      }

      setProgress(100);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled — not an error
      } else {
        setError(err instanceof Error ? err.message : 'Streaming failed');
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    // 🛑 Cancel the ongoing stream
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const reset = useCallback(() => {
    setHumanizedText('');
    setError(null);
    setProgress(0);
    setIsStreaming(false);
  }, []);

  return {
    humanizedText,
    isStreaming,
    error,
    progress,
    startHumanize,
    cancel,
    reset,
  };
}
