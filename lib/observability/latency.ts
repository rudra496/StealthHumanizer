// ⏱️ NOOB EXPLAINER: Latency Tracker
// "Latency" means how long something takes. This module tracks
// how long each humanization request takes and computes statistics.
//
// Why does this matter?
// - If one provider is consistently slow, users will have a bad experience
// - If latency spikes, something might be wrong
// - If cache hits are instant, we can show users the benefit
//
// We compute percentiles:
// - p50 (median): Half of requests are faster than this
// - p95: 95% of requests are faster than this
// - p99: 99% of requests are faster than this
//
// If p99 is WAY higher than p50, it means some requests are
// very slow — that's worth investigating!

import type { TraceEntry, LatencyRecord } from './types';

export class LatencyTracker {
  // 📊 NOOB EXPLAINER: Compute latency statistics
  // Groups traces by provider and model, then computes stats for each group.
  computeStats(traces: TraceEntry[]): LatencyRecord[] {
    const groups: Record<string, TraceEntry[]> = {};

    for (const trace of traces) {
      if (!trace.success) continue; // Skip failed requests
      const key = `${trace.provider}-${trace.model}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(trace);
    }

    return Object.entries(groups).map(([key, groupTraces]) => {
      const [provider, model] = key.split('-');
      const latencies = groupTraces.map(t => t.totalTimeMs).sort((a, b) => a - b);

      return {
        provider,
        model,
        avgLatencyMs: this.average(latencies),
        p50LatencyMs: this.percentile(latencies, 0.5),
        p95LatencyMs: this.percentile(latencies, 0.95),
        p99LatencyMs: this.percentile(latencies, 0.99),
        sampleSize: latencies.length,
      };
    }).sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
  }

  // 📐 NOOB EXPLAINER: Percentile calculation
  // The p-th percentile is the value below which p% of the data falls.
  // Example: if latencies are [1, 2, 3, 4, 5, 6, 7, 8, 9, 100],
  // p50 = 5.5 (median), p95 = 95.5, p99 = 99.55
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  private average(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((sum, n) => sum + n, 0) / nums.length;
  }
}
