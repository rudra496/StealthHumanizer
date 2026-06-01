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
  avgHumanScore: number;
  avgSemanticScore: number;
  totalWords: number;
}

const OBSERVABILITY_KEY = 'stealthhumanizer_observability_events';

export function getObservabilityEvents(): ObservabilityEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(OBSERVABILITY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
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
  if (runs === 0) return { runs: 0, successRate: 0, totalCostUsd: 0, avgLatencyMs: 0, avgHumanScore: 0, avgSemanticScore: 0, totalWords: 0 };
  const successes = events.filter(event => event.success).length;
  const humanScores = events.map(event => event.finalScore).filter((score): score is number => typeof score === 'number');
  const semanticScores = events.map(event => event.semanticScore).filter((score): score is number => typeof score === 'number');
  return {
    runs,
    successRate: Math.round((successes / runs) * 100),
    totalCostUsd: Number(events.reduce((sum, event) => sum + event.costUsd, 0).toFixed(5)),
    avgLatencyMs: Math.round(events.reduce((sum, event) => sum + event.latencyMs, 0) / runs),
    avgHumanScore: humanScores.length ? Math.round(humanScores.reduce((sum, score) => sum + score, 0) / humanScores.length) : 0,
    avgSemanticScore: semanticScores.length ? Math.round(semanticScores.reduce((sum, score) => sum + score, 0) / semanticScores.length) : 0,
    totalWords: events.reduce((sum, event) => sum + event.inputWords + event.outputWords, 0),
  };
}

export function estimateRunCost(inputWords: number, outputWords: number, provider: string): number {
  if (provider === 'local-privacy') return 0;
  const tokens = Math.ceil((inputWords + outputWords) * 1.35);
  const costPerThousandTokens = provider.includes('gpt') || provider.includes('openai') ? 0.005 : 0.0015;
  return Number(((tokens / 1000) * costPerThousandTokens).toFixed(5));
}
