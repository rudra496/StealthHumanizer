export interface ObservabilityEvent {
  id: string;
  timestamp: number;
  type: 'humanize' | 'stream' | 'privacy' | 'benchmark' | 'api';
  provider: string;
  model?: string;
  inputWords: number;
  outputWords: number;
  latencyMs: number;
  costUsd: number;
  finalScore?: number;
  semanticScore?: number;
  success: boolean;
}

export interface ObservabilitySummary {
  runs: number;
  successRate: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgHumanScore: number;
  avgSemanticScore: number;
  totalWords: number;
  costPerThousandWords: number;
}

export interface ProviderBreakdown {
  provider: string;
  runs: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  avgHumanScore: number;
  avgSemanticScore: number;
}

export interface DailyObservabilityPoint {
  date: string;
  runs: number;
  costUsd: number;
  avgLatencyMs: number;
  avgHumanScore: number;
  avgSemanticScore: number;
}

const OBSERVABILITY_KEY = 'stealthhumanizer_observability_events';

function safeArray(value: unknown): ObservabilityEvent[] {
  return Array.isArray(value) ? value.filter((event): event is ObservabilityEvent => Boolean(event && typeof event === 'object' && 'provider' in event)) : [];
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

export function getObservabilityEvents(): ObservabilityEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    return safeArray(JSON.parse(localStorage.getItem(OBSERVABILITY_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function addObservabilityEvent(event: Omit<ObservabilityEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void {
  if (typeof window === 'undefined') return;
  const events = getObservabilityEvents();
  events.push({
    id: event.id ?? crypto.randomUUID(),
    timestamp: event.timestamp ?? Date.now(),
    type: event.type,
    provider: event.provider,
    model: event.model,
    inputWords: event.inputWords,
    outputWords: event.outputWords,
    latencyMs: event.latencyMs,
    costUsd: event.costUsd,
    finalScore: event.finalScore,
    semanticScore: event.semanticScore,
    success: event.success,
  });
  localStorage.setItem(OBSERVABILITY_KEY, JSON.stringify(events.slice(-500)));
}

export function clearObservabilityEvents(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(OBSERVABILITY_KEY);
}

export function summarizeObservability(events = getObservabilityEvents()): ObservabilitySummary {
  const runs = events.length;
  if (runs === 0) {
    return { runs: 0, successRate: 0, totalCostUsd: 0, avgLatencyMs: 0, p95LatencyMs: 0, avgHumanScore: 0, avgSemanticScore: 0, totalWords: 0, costPerThousandWords: 0 };
  }
  const successes = events.filter(event => event.success).length;
  const humanScores = events.map(event => event.finalScore).filter((score): score is number => typeof score === 'number');
  const semanticScores = events.map(event => event.semanticScore).filter((score): score is number => typeof score === 'number');
  const totalCostUsd = Number(events.reduce((sum, event) => sum + event.costUsd, 0).toFixed(5));
  const totalWords = events.reduce((sum, event) => sum + event.inputWords + event.outputWords, 0);
  return {
    runs,
    successRate: Math.round((successes / runs) * 100),
    totalCostUsd,
    avgLatencyMs: average(events.map(event => event.latencyMs)),
    p95LatencyMs: percentile(events.map(event => event.latencyMs), 95),
    avgHumanScore: average(humanScores),
    avgSemanticScore: average(semanticScores),
    totalWords,
    costPerThousandWords: totalWords > 0 ? Number(((totalCostUsd / totalWords) * 1000).toFixed(5)) : 0,
  };
}

export function getProviderBreakdown(events = getObservabilityEvents()): ProviderBreakdown[] {
  const byProvider = new Map<string, ObservabilityEvent[]>();
  for (const event of events) byProvider.set(event.provider, [...(byProvider.get(event.provider) ?? []), event]);
  return [...byProvider.entries()]
    .map(([provider, providerEvents]) => ({
      provider,
      runs: providerEvents.length,
      totalCostUsd: Number(providerEvents.reduce((sum, event) => sum + event.costUsd, 0).toFixed(5)),
      avgLatencyMs: average(providerEvents.map(event => event.latencyMs)),
      avgHumanScore: average(providerEvents.map(event => event.finalScore).filter((score): score is number => typeof score === 'number')),
      avgSemanticScore: average(providerEvents.map(event => event.semanticScore).filter((score): score is number => typeof score === 'number')),
    }))
    .sort((a, b) => b.runs - a.runs || b.totalCostUsd - a.totalCostUsd);
}

export function getDailyObservability(days = 14, events = getObservabilityEvents()): DailyObservabilityPoint[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const byDate = new Map<string, ObservabilityEvent[]>();
  for (const event of events) {
    if (event.timestamp < cutoff) continue;
    const date = new Date(event.timestamp).toISOString().slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayEvents]) => ({
    date,
    runs: dayEvents.length,
    costUsd: Number(dayEvents.reduce((sum, event) => sum + event.costUsd, 0).toFixed(5)),
    avgLatencyMs: average(dayEvents.map(event => event.latencyMs)),
    avgHumanScore: average(dayEvents.map(event => event.finalScore).filter((score): score is number => typeof score === 'number')),
    avgSemanticScore: average(dayEvents.map(event => event.semanticScore).filter((score): score is number => typeof score === 'number')),
  }));
}

export function estimateRunCost(inputWords: number, outputWords: number, provider: string): number {
  if (provider === 'local-privacy') return 0;
  const tokens = Math.ceil((inputWords + outputWords) * 1.35);
  const normalized = provider.toLowerCase();
  const costPerThousandTokens = normalized.includes('gpt') || normalized.includes('openai')
    ? 0.005
    : normalized.includes('claude') || normalized.includes('anthropic')
      ? 0.006
      : normalized.includes('gemini')
        ? 0.001
        : 0.0015;
  return Number(((tokens / 1000) * costPerThousandTokens).toFixed(5));
}
