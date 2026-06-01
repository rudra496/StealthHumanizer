// 📊 NOOB EXPLAINER: What is Observability?
// "Observability" means being able to SEE what's happening inside
// your system. Right now, when the humanizer makes API calls, we
// have NO idea:
// - How much money we're spending on API calls
// - Which providers are fastest/slowest
// - Whether quality is improving or getting worse over time
// - If we're hitting rate limits
//
// This module adds "instrumentation" — like putting a dashboard
// in a car. Instead of driving blind, you can now see:
// - How much each humanization costs ($0.002 vs $0.05)
// - How long each provider takes (2s vs 45s)
// - Quality scores over time (is our humanization getting better?)
// - Usage patterns (which features are most popular?)

export { ObservabilityTracker } from './tracker';
export { CostCalculator } from './cost-calculator';
export { LatencyTracker } from './latency';
export { QualityMetrics } from './quality';
export type { TraceEntry, CostRecord, LatencyRecord, QualityRecord, ObservabilityConfig } from './types';
