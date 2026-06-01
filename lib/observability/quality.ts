// 📈 NOOB EXPLAINER: Quality Metrics
// This tracks how good our humanization is over time.
// We measure two things:
//
// 1. "Human Score" — How human-like does the output sound? (0-100)
//    Higher is better. We want >55% to pass most detectors.
//
// 2. "Fidelity Score" — Did we preserve the original meaning? (0-1)
//    Higher is better. We want >0.80 to avoid meaning drift.
//
// By tracking these over time, we can see if updates to the
// humanization algorithm are actually improving quality or not.

import type { TraceEntry, QualityRecord } from './types';

export class QualityMetrics {
  // 📊 NOOB EXPLAINER: Compute quality trends
  // Groups successful traces by date and computes average scores.
  computeTrends(traces: TraceEntry[]): QualityRecord[] {
    const groups: Record<string, TraceEntry[]> = {};

    for (const trace of traces) {
      const date = new Date(trace.timestamp).toISOString().slice(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push(trace);
    }

    return Object.entries(groups)
      .map(([date, dayTraces]) => {
        const humanScores = dayTraces.map(t => t.humanScore).filter(s => s > 0);
        const fidelityScores = dayTraces.map(t => t.fidelityScore).filter((s): s is number => s !== undefined && s > 0);
        const passing = dayTraces.filter(t => t.humanScore >= 55);

        return {
          date,
          avgHumanScore: humanScores.length > 0
            ? humanScores.reduce((a, b) => a + b, 0) / humanScores.length
            : 0,
          avgFidelityScore: fidelityScores.length > 0
            ? fidelityScores.reduce((a, b) => a + b, 0) / fidelityScores.length
            : 0,
          sampleSize: dayTraces.length,
          passRate: dayTraces.length > 0 ? passing.length / dayTraces.length : 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
