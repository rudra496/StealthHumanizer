// 🔭 NOOB EXPLAINER: The Observability Tracker
// This is the CENTRAL hub that collects all the data. Think of it
// like a flight data recorder (black box) for your LLM calls.
//
// Every time a humanization happens, the tracker records:
// - How long it took
// - How much it cost
// - What the quality was
// - Whether it succeeded or failed
//
// Then you can query this data to see trends, find problems,
// and optimize your usage.

import type { TraceEntry, ObservabilityConfig, CostRecord, LatencyRecord, QualityRecord } from './types';
import { CostCalculator } from './cost-calculator';
import { LatencyTracker } from './latency';
import { QualityMetrics } from './quality';

const STORAGE_KEY = 'stealthhumanizer_observability_traces';
const DEFAULT_CONFIG: ObservabilityConfig = {
  storage: 'localStorage',
  maxTraces: 1000,
  samplingRate: 1.0,
};

export class ObservabilityTracker {
  private traces: TraceEntry[] = [];
  private config: ObservabilityConfig;
  private costCalculator: CostCalculator;
  private latencyTracker: LatencyTracker;
  private qualityMetrics: QualityMetrics;

  constructor(config?: Partial<ObservabilityConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.costCalculator = new CostCalculator();
    this.latencyTracker = new LatencyTracker();
    this.qualityMetrics = new QualityMetrics();
    this.loadTraces();
  }

  // 📝 NOOB EXPLAINER: Start a new trace
  // Call this when a humanization request starts. It returns a
  // "trace builder" that you can update as the request progresses.
  startTrace(params: {
    provider: string;
    model: string;
    inputTextLength: number;
    level: string;
  }): TraceBuilder {
    // 🎲 NOOB EXPLAINER: Sampling
    // If sampling rate is 0.1, we only record 10% of traces.
    // This is useful for high-traffic apps where recording everything
    // would use too much memory.
    if (Math.random() > this.config.samplingRate) {
      return new NoOpTraceBuilder(); // Discard this trace
    }
    return new TraceBuilder(params, this);
  }

  // 📊 NOOB EXPLAINER: Record a completed trace
  // Called internally when a trace is finished.
  recordTrace(trace: TraceEntry): void {
    this.traces.push(trace);
    
    // 🧹 NOOB EXPLAINER: Auto-cleanup
    // If we have too many traces, remove the oldest ones.
    // This prevents the browser from running out of memory.
    if (this.traces.length > this.config.maxTraces) {
      this.traces = this.traces.slice(-this.config.maxTraces);
    }
    
    this.saveTraces();
  }

  // 💰 NOOB EXPLAINER: Get cost summary
  // Returns cost data grouped by date and provider.
  getCostSummary(days: number = 30): CostRecord[] {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recentTraces = this.traces.filter(t => t.timestamp >= cutoff);
    return this.costCalculator.summarize(recentTraces);
  }

  // ⏱️ NOOB EXPLAINER: Get latency stats
  // Returns speed data grouped by provider and model.
  getLatencyStats(): LatencyRecord[] {
    return this.latencyTracker.computeStats(this.traces);
  }

  // 📈 NOOB EXPLAINER: Get quality trends
  // Returns quality data grouped by date.
  getQualityTrends(days: number = 30): QualityRecord[] {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recentTraces = this.traces.filter(t => t.timestamp >= cutoff && t.success);
    return this.qualityMetrics.computeTrends(recentTraces);
  }

  // 🔢 NOOB EXPLAINER: Get total stats
  // Quick summary numbers for the dashboard header.
  getTotals(): { totalRequests: number; totalCostUsd: number; avgHumanScore: number; avgLatencyMs: number } {
    const successTraces = this.traces.filter(t => t.success);
    return {
      totalRequests: this.traces.length,
      totalCostUsd: this.traces.reduce((sum, t) => sum + t.estimatedCostUsd, 0),
      avgHumanScore: successTraces.length > 0
        ? successTraces.reduce((sum, t) => sum + t.humanScore, 0) / successTraces.length
        : 0,
      avgLatencyMs: successTraces.length > 0
        ? successTraces.reduce((sum, t) => sum + t.totalTimeMs, 0) / successTraces.length
        : 0,
    };
  }

  // 💾 NOOB EXPLAINER: Persistence
  // Save traces to localStorage so they survive page refreshes.
  private saveTraces(): void {
    if (this.config.storage === 'localStorage' && typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.traces));
      } catch {
        // Storage full — clear oldest traces
        this.traces = this.traces.slice(-Math.floor(this.config.maxTraces / 2));
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.traces));
        } catch {
          // Still can't save — give up gracefully
        }
      }
    }
  }

  private loadTraces(): void {
    if (this.config.storage === 'localStorage' && typeof window !== 'undefined') {
      try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
          this.traces = JSON.parse(data);
        }
      } catch {
        this.traces = [];
      }
    }
  }

  // 🗑️ NOOB EXPLAINER: Clear all data
  // Useful for privacy or starting fresh.
  clearAll(): void {
    this.traces = [];
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

// 🏗️ NOOB EXPLAINER: Trace Builder
// This is a helper class that makes it easy to build a trace
// step by step. You call methods on it as the request progresses,
// and it automatically records timing.
export class TraceBuilder {
  private startTime: number;
  private data: Partial<TraceEntry>;
  private tracker: ObservabilityTracker;

  constructor(params: { provider: string; model: string; inputTextLength: number; level: string }, tracker: ObservabilityTracker) {
    this.startTime = Date.now();
    this.tracker = tracker;
    this.data = {
      id: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: this.startTime,
      provider: params.provider,
      model: params.model,
      inputTextLength: params.inputTextLength,
      level: params.level,
      cached: false,
      success: true,
    };
  }

  setTokens(input: number, output: number): this {
    this.data.inputTokens = input;
    this.data.outputTokens = output;
    return this;
  }

  setOutputLength(length: number): this {
    this.data.outputTextLength = length;
    return this;
  }

  setLLMTime(ms: number): this {
    this.data.llmTimeMs = ms;
    return this;
  }

  setPostprocessTime(ms: number): this {
    this.data.postprocessTimeMs = ms;
    return this;
  }

  setDetectionTime(ms: number): this {
    this.data.detectionTimeMs = ms;
    return this;
  }

  setHumanScore(score: number): this {
    this.data.humanScore = score;
    return this;
  }

  setFidelityScore(score: number): this {
    this.data.fidelityScore = score;
    return this;
  }

  setCached(cached: boolean): this {
    this.data.cached = cached;
    return this;
  }

  setError(message: string): this {
    this.data.success = false;
    this.data.errorMessage = message;
    return this;
  }

  // ✅ NOOB EXPLAINER: Finish the trace
  // Call this when the humanization is complete. It calculates
  // the total time and estimated cost, then saves the trace.
  finish(): TraceEntry {
    const totalTimeMs = Date.now() - this.startTime;
    const costCalculator = new CostCalculator();
    const estimatedCostUsd = costCalculator.estimateCost(
      this.data.provider || '',
      this.data.model || '',
      this.data.inputTokens || 0,
      this.data.outputTokens || 0,
    );

    const trace: TraceEntry = {
      id: this.data.id!,
      timestamp: this.data.timestamp!,
      provider: this.data.provider!,
      model: this.data.model!,
      inputTextLength: this.data.inputTextLength!,
      outputTextLength: this.data.outputTextLength || 0,
      totalTimeMs,
      llmTimeMs: this.data.llmTimeMs || 0,
      postprocessTimeMs: this.data.postprocessTimeMs || 0,
      detectionTimeMs: this.data.detectionTimeMs || 0,
      inputTokens: this.data.inputTokens || 0,
      outputTokens: this.data.outputTokens || 0,
      estimatedCostUsd,
      humanScore: this.data.humanScore || 0,
      fidelityScore: this.data.fidelityScore,
      level: this.data.level!,
      cached: this.data.cached || false,
      success: this.data.success !== false,
      errorMessage: this.data.errorMessage,
    };

    this.tracker.recordTrace(trace);
    return trace;
  }
}

// 🚫 NOOB EXPLAINER: No-Op Trace Builder
// When sampling is active and we decide NOT to record a trace,
// we return this instead. It accepts all the same method calls
// but does nothing. This is the "Null Object" pattern — it lets
// calling code work the same way whether or not we're recording.
class NoOpTraceBuilder extends TraceBuilder {
  constructor() {
    // @ts-ignore — we override all methods anyway
    super({}, null as any);
  }
  setTokens() { return this; }
  setOutputLength() { return this; }
  setLLMTime() { return this; }
  setPostprocessTime() { return this; }
  setDetectionTime() { return this; }
  setHumanScore() { return this; }
  setFidelityScore() { return this; }
  setCached() { return this; }
  setError() { return this; }
  finish() { return {} as TraceEntry; }
}
