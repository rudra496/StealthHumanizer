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

// The VPS backend is reached through a Cloudflare quick tunnel (the instance's
// direct inbound ports are blocked at the OCI firewall level, and sslip.io TLS
// can lapse). Quick-tunnel URLs rotate when the cloudflared container restarts,
// so the VPS publishes its CURRENT URL to a secret gist (updated by cron every
// minute). Resolution order: RUDRA_API_BASE_URL env (self-hosters) → in-memory
// cached broker URL → last-known tunnel constant. On a connection-level
// failure the broker is consulted once and the request retried (self-healing).
const KNOWN_TUNNEL_BASE = 'https://cargo-banners-features-near.trycloudflare.com';
const TUNNEL_BROKER_URL =
  'https://gist.githubusercontent.com/rudra496/7862809786c361280d1b6dc3534c6fe3/raw/sh_url.txt';

let cachedBase: { url: string; at: number } | null = null;

// gemma3:4b on free-tier ARM (Ampere A1) takes ~15s per 100 words of input.
// A 600-word essay can run 60-90s upstream. The Vercel route sets
// maxDuration=120 to match — keep this 10s under that so the fetch fails
// before Vercel kills the function, leaving room for a clean error response.
const HUMANIZE_TIMEOUT_MS = 110_000;
const DETECT_TIMEOUT_MS = 15_000;

function primaryBase(): string {
  const env = (process.env.RUDRA_API_BASE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  if (cachedBase && Date.now() - cachedBase.at < 5 * 60_000) return cachedBase.url;
  return KNOWN_TUNNEL_BASE;
}

async function fetchTunnelBaseFromBroker(): Promise<string | null> {
  try {
    const res = await fetch(`${TUNNEL_BROKER_URL}?cb=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const url = (await res.text()).trim().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return null;
    return url;
  } catch {
    return null;
  }
}

async function doRudraFetch(base: string, path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      // Cloudflare tunnel serves a real Cloudflare edge cert — always validate.
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the Rudra VPS backend with automatic tunnel-URL recovery.
 * Throws the original connection error if the broker also fails.
 */
export async function rudraFetch(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const base = primaryBase();
  try {
    return await doRudraFetch(base, path, init, timeoutMs);
  } catch (err) {
    if (process.env.RUDRA_API_BASE_URL) throw err; // explicit override = no failover
    const fresh = await fetchTunnelBaseFromBroker();
    if (!fresh || fresh === base) throw err;
    cachedBase = { url: fresh, at: Date.now() };
    return await doRudraFetch(fresh, path, init, timeoutMs);
  }
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

  const response = await rudraFetch('/api/humanize/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ text, temperature: 0.7, num_beams: 4 }),
  }, HUMANIZE_TIMEOUT_MS);

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

  const response = await rudraFetch('/api/grammar/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ text }),
  }, HUMANIZE_TIMEOUT_MS);

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

  const response = await rudraFetch('/api/detect/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ text }),
  }, DETECT_TIMEOUT_MS);

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
}
