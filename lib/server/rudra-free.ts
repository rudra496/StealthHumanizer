/**
 * Rudra's Free Usage Model — server-side proxy to the maintainer's Oracle VPS.
 *
 * The Oracle VM hosts two small HuggingFace models behind nginx with separate
 * API keys (see lib/server/README.md or .env.example):
 *   - amicus-humanizer-v1-onnx     (T5-base, 60M, ONNX INT8)
 *   - fakespot-ai/roberta-base-ai-text-detection-v1 (RoBERTa-base, 125M)
 *
 * Both run on free-tier ARM (Ampere A1) and serve ~1s / ~70ms latency. The
 * public StealthHumanizer deployment on Vercel calls them with API keys stored
 * as Vercel env vars (RUDRA_HUMANIZER_API_KEY / RUDRA_DETECTOR_API_KEY) — keys
 * never reach the browser. Self-hosters can either set the same env vars to
 * reuse the maintainer's VPS (free for everyone) or stand up their own.
 */

const DEFAULT_RUDRA_BASE = 'https://129.159.229.170';
// gemma3:4b on free-tier ARM (Ampere A1) takes ~15s per 100 words of input.
// A 600-word essay can run 60-90s upstream. The Vercel route sets
// maxDuration=120 to match — keep this 10s under that so the fetch fails
// before Vercel kills the function, leaving room for a clean error response.
const HUMANIZE_TIMEOUT_MS = 110_000;
const DETECT_TIMEOUT_MS = 15_000;

function getBaseUrl(): string {
  const v = (process.env.RUDRA_API_BASE_URL || '').trim();
  return v || DEFAULT_RUDRA_BASE;
}

function getHumanizerKey(): string | null {
  const v = (process.env.RUDRA_HUMANIZER_API_KEY || '').trim();
  return v || null;
}

function getDetectorKey(): string | null {
  const v = (process.env.RUDRA_DETECTOR_API_KEY || '').trim();
  return v || null;
}

export function isRudraHumanizerConfigured(): boolean {
  return getHumanizerKey() !== null;
}

export function isRudraDetectorConfigured(): boolean {
  return getDetectorKey() !== null;
}

export interface RudraHumanizeResult {
  text: string;
  model: string;
  elapsedMs: number;
}

export async function humanizeWithRudra(text: string): Promise<RudraHumanizeResult> {
  const key = getHumanizerKey();
  if (!key) {
    throw new Error('Rudra Free model is not configured on the server (RUDRA_HUMANIZER_API_KEY missing).');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUMANIZE_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBaseUrl()}/api/humanize/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ text, temperature: 0.7, num_beams: 4 }),
      signal: controller.signal,
      // Always validate the cert — Oracle VPS serves a real Let's Encrypt cert.
      cache: 'no-store',
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Upstream Rudra humanizer returned ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data?.humanized || typeof data.humanized !== 'string') {
      throw new Error('Malformed response from Rudra humanizer');
    }

    return {
      text: data.humanized,
      model: data.model || 'amicus-humanizer-v1-onnx',
      elapsedMs: Number(data.elapsed_ms) || 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface RudraGrammarResult {
  corrected: string;
  model: string;
  elapsedMs: number;
}

export async function grammarCheckWithRudra(text: string): Promise<RudraGrammarResult> {
  const key = getHumanizerKey();
  if (!key) {
    throw new Error('Rudra Free model is not configured on the server (RUDRA_HUMANIZER_API_KEY missing).');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUMANIZE_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBaseUrl()}/api/grammar/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Upstream Rudra grammar returned ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data?.corrected || typeof data.corrected !== 'string') {
      throw new Error('Malformed response from Rudra grammar');
    }

    return {
      corrected: data.corrected,
      model: data.model || 'gemma3:4b',
      elapsedMs: Number(data.elapsed_ms) || 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface RudraDetectResult {
  label: 'human' | 'ai';
  aiProbability: number;     // 0..1
  humanProbability: number;  // 0..1
  model: string;
  elapsedMs: number;
  source: 'rudra';
}

export async function detectWithRudra(text: string): Promise<RudraDetectResult> {
  const key = getDetectorKey();
  if (!key) {
    throw new Error('Rudra detector is not configured on the server (RUDRA_DETECTOR_API_KEY missing).');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

  try {
    const response = await fetch(`${getBaseUrl()}/api/detect/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Upstream Rudra detector returned ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    if (typeof data?.ai_probability !== 'number' || typeof data?.human_probability !== 'number') {
      throw new Error('Malformed response from Rudra detector');
    }

    return {
      label: data.label === 'human' ? 'human' : 'ai',
      aiProbability: data.ai_probability,
      humanProbability: data.human_probability,
      model: data.model || 'fakespot-ai/roberta-base-ai-text-detection-v1',
      elapsedMs: Number(data.elapsed_ms) || 0,
      source: 'rudra',
    };
  } finally {
    clearTimeout(timeout);
  }
}
