// 📋 NOOB EXPLAINER: Data types for the observability system
// These define the "shapes" of data we collect and display.

// 🔍 NOOB EXPLAINER: What is a "Trace"?
// A "trace" is a record of ONE complete humanization request.
// It captures everything that happened from start to finish,
// like a receipt for your API call.
export interface TraceEntry {
  id: string;                        // Unique trace ID
  timestamp: number;                 // When it started
  provider: string;                  // Which AI provider (openai, claude, etc.)
  model: string;                     // Which model (gpt-4, claude-3, etc.)
  inputTextLength: number;           // How many characters of input
  outputTextLength: number;          // How many characters of output
  
  // ⏱️ NOOB EXPLAINER: Timing breakdown
  // We track WHERE time is spent so we can optimize:
  totalTimeMs: number;               // Total time from request to result
  llmTimeMs: number;                 // Time waiting for the LLM
  postprocessTimeMs: number;         // Time spent on post-processing
  detectionTimeMs: number;           // Time spent on AI detection
  
  // 💰 NOOB EXPLAINER: Cost tracking
  // We estimate how much each request costs based on token usage
  // and the provider's pricing.
  inputTokens: number;               // Tokens sent to the LLM
  outputTokens: number;              // Tokens received from the LLM
  estimatedCostUsd: number;          // Estimated cost in USD
  
  // 📊 NOOB EXPLAINER: Quality metrics
  // We track quality scores so we can see trends over time.
  humanScore: number;                // How "human" the output sounds (0-100)
  fidelityScore?: number;            // How much meaning was preserved (0-1)
  
  // 🏷️ NOOB EXPLAINER: Metadata
  // Extra info that helps us filter and analyze traces.
  level: string;                     // Humanization level used
  cached: boolean;                   // Was this served from cache?
  success: boolean;                  // Did it complete successfully?
  errorMessage?: string;             // If it failed, why?
}

// 💰 NOOB EXPLAINER: Cost record
// A simplified record focused on cost, used for the cost dashboard.
export interface CostRecord {
  date: string;                      // YYYY-MM-DD format
  provider: string;
  model: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

// ⏱️ NOOB EXPLAINER: Latency record
// A simplified record focused on speed, used for performance monitoring.
export interface LatencyRecord {
  provider: string;
  model: string;
  avgLatencyMs: number;
  p50LatencyMs: number;              // 50th percentile (median)
  p95LatencyMs: number;              // 95th percentile (slowest 5%)
  p99LatencyMs: number;              // 99th percentile (slowest 1%)
  sampleSize: number;
}

// 📊 NOOB EXPLAINER: Quality record
// Tracks quality metrics over time so we can see trends.
export interface QualityRecord {
  date: string;
  avgHumanScore: number;
  avgFidelityScore: number;
  sampleSize: number;
  passRate: number;                  // % of humanizations that pass detection
}

// ⚙️ NOOB EXPLAINER: Configuration
// Settings for the observability system.
export interface ObservabilityConfig {
  // 📦 NOOB EXPLAINER: Storage
  // Where to store the traces. 'localStorage' is the default and
  // works entirely in the browser. 'api' would send traces to a
  // Langfuse-compatible server for team-wide dashboards.
  storage: 'localStorage' | 'api';
  
  // 🔢 NOOB EXPLAINER: Max traces
  // How many traces to keep in memory. Older traces are automatically
  // deleted when we hit this limit. Think of it like a rolling log.
  maxTraces: number;                 // Default: 1000
  
  // 🎯 NOOB EXPLAINER: Sampling rate
  // What fraction of traces to record. 1.0 = record everything.
  // 0.1 = record 1 in 10 (useful for high-traffic apps).
  samplingRate: number;              // 0-1, default: 1.0
  
  // 🌐 NOOB EXPLAINER: API endpoint
  // If storage is 'api', this is where traces are sent.
  apiEndpoint?: string;
  
  // 🔑 NOOB EXPLAINER: API key
  // If storage is 'api', you'll need an API key for authentication.
  apiKey?: string;
}
