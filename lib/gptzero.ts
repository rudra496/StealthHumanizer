import { detectAI } from './detector';

const GPTZERO_API_URL = 'https://api.gptzero.me/v2/predict/text';

export interface GPTZeroResult {
  /** AI probability from 0 to 1 when source is GPTZero or local fallback. */
  score: number | null;
  verdict: string | null;
  sentences: unknown[];
  source: 'gptzero' | 'local-fallback';
  message?: string;
}

function localFallback(text: string, message: string): GPTZeroResult {
  const local = detectAI(text);
  return {
    score: Math.max(0, Math.min(1, (100 - local.score) / 100)),
    verdict: local.overallVerdict === 'ai' ? 'generated' : local.overallVerdict,
    sentences: local.sentences.map(sentence => ({
      text: sentence.text,
      generated_prob: Math.max(0, Math.min(1, (100 - sentence.score) / 100)),
      classification: sentence.classification,
      issues: sentence.issues,
    })),
    source: 'local-fallback',
    message,
  };
}

export async function detectWithGPTZero(text: string): Promise<GPTZeroResult> {
  const apiKey = process.env.GPTZERO_API_KEY?.trim();
  if (!apiKey) {
    return localFallback(text, 'GPTZero API key is not configured. Using the local detector fallback instead.');
  }

  let lastError: Error | null = null;
  const maxRetries = 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(GPTZERO_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ document: text.trim() }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text();
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = new Error(`GPTZero API error: ${response.status}`);
          continue;
        }
        throw new Error(`GPTZero API error: ${response.status} — ${errorBody}`);
      }

      const data = await response.json();
      const doc = data?.documents?.[0] ?? data;

      return {
        score: doc.completely_generated_prob ?? doc.average_generated_prob ?? null,
        verdict: doc.predicted_class ?? null,
        sentences: doc.sentences ?? [],
        source: 'gptzero',
      };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error('GPTZero API request timed out (15s)');
      } else {
        lastError = err instanceof Error ? err : new Error('Unknown error');
      }
      if (attempt < maxRetries) continue;
    }
  }

  return localFallback(text, lastError?.message ? `GPTZero request failed; using local fallback. ${lastError.message}` : 'GPTZero request failed; using local fallback.');
}
