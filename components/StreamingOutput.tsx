// 📺 NOOB EXPLAINER: What is this component?
// This component shows the humanized text as it's being generated.
// Instead of a boring loading spinner, users see text appearing
// in real-time, like watching someone type.
//
// It also shows:
// - A blinking cursor while generating
// - A progress bar
// - A "Cancel" button to stop generation
// - The final detection score when done

'use client';

import { useHumanizeStream } from '@/lib/hooks/useHumanizeStream';

interface StreamingOutputProps {
  /** Optional class name for the outer wrapper */
  className?: string;
}

export function StreamingOutput({ className }: StreamingOutputProps) {
  const { humanizedText, isStreaming, error, progress, startHumanize, cancel, reset } = useHumanizeStream();
  
  return (
    <div className={`space-y-4 ${className ?? ''}`}>
      {/* 📊 NOOB EXPLAINER: Progress Bar
          This bar fills up as the AI generates text. It gives users
          visual feedback so they know something is happening, even
          before any text appears. */}
      {isStreaming && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      
      {/* 💬 NOOB EXPLAINER: Streaming Text Display
          This is where the magic happens. As the AI generates text,
          it appears here one token at a time. The blinking cursor
          shows that generation is still in progress. */}
      <div className="relative min-h-[200px] p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border">
        {humanizedText ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {humanizedText}
            {/* 🔴 Blinking cursor — shows the AI is still typing */}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-emerald-500 animate-pulse ml-0.5" />
            )}
          </pre>
        ) : isStreaming ? (
          <div className="flex items-center gap-2 text-gray-400">
            <div className="w-2 h-4 bg-emerald-500 animate-pulse" />
            <span>Generating...</span>
          </div>
        ) : (
          <p className="text-gray-400 italic">Humanized text will appear here...</p>
        )}
      </div>
      
      {/* ❌ Error Display — shows if something went wrong */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}
      
      {/* 🛑 Cancel Button — lets users stop generation mid-stream */}
      {isStreaming && (
        <button
          onClick={cancel}
          className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <rect x="6" y="6" width="8" height="8" rx="1" />
          </svg>
          Cancel Generation
        </button>
      )}
    </div>
  );
}
