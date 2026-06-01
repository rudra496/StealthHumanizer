// Unified Provider Interface for all AI providers
// StealthHumanizer v2 - Free AI Text Humanizer
//
// Browser-safe: this file is imported by client components (Settings.tsx)
// because they need PROVIDERS metadata and call testApiKey() from the browser
// (API keys go straight from the browser to the provider — no server proxy).
// Therefore NO node: builtins or subprocess imports here. CLI-runner providers
// (claude-code, codex) cannot execute through this file — call sites in
// server-only contexts must use lib/server/providers-runtime instead, which
// wraps this file's generateWithProvider and intercepts the CLI cases.

import { ModelProvider, Provider } from './types';

export type { ModelProvider, Provider };

// ==================== FETCH WITH TIMEOUT + RETRY ====================

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30_000,
  maxRetries: number = 1,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Server error: ${response.status}`);
        continue;
      }
      return response;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeoutMs}ms`);
      } else {
        lastError = err instanceof Error ? err : new Error('Network error');
      }
      if (attempt < maxRetries) continue;
    }
  }

  throw lastError || new Error('Request failed');
}

// ==================== PROVIDER CONFIGURATIONS ====================

export const PROVIDERS: Provider[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Free tier with generous limits. Recommended for most users!',
    free: true,
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    getApiKeyUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/docs',
    defaultModel: 'gemini-1.5-flash',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'],
    placeholder: 'AIza...',
  },
  {
    id: 'openai',
    name: 'OpenAI GPT-4',
    description: 'Industry-leading AI, excellent quality for complex texts',
    free: false,
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://platform.openai.com/docs',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    placeholder: 'sk-...',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    description: 'Excellent for academic and professional writing',
    free: false,
    apiUrl: 'https://api.anthropic.com/v1/messages',
    getApiKeyUrl: 'https://console.anthropic.com/',
    docsUrl: 'https://docs.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'],
    placeholder: 'sk-ant-...',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference with Llama/Mixtral models. FREE tier!',
    free: true,
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    getApiKeyUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    placeholder: 'gsk_...',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'European AI company with excellent open models. Free tier available.',
    free: true,
    apiUrl: 'https://api.mistral.ai/v1/chat/completions',
    getApiKeyUrl: 'https://console.mistral.ai/',
    docsUrl: 'https://docs.mistral.ai',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-medium', 'mistral-small', 'open-mixtral-8x22b'],
    placeholder: '...',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Enterprise-focused AI with strong language understanding. Free tier.',
    free: true,
    apiUrl: 'https://api.cohere.ai/v1/chat',
    getApiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    docsUrl: 'https://docs.cohere.com',
    defaultModel: 'command-r-plus',
    models: ['command-r-plus', 'command-r', 'command', 'command-light'],
    placeholder: '...',
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Access to many open-source models. Free tier available.',
    free: true,
    apiUrl: 'https://api.together.xyz/v1/chat/completions',
    getApiKeyUrl: 'https://api.together.xyz/settings/api-keys',
    docsUrl: 'https://docs.together.ai',
    defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
    models: [
      'meta-llama/Llama-3-70b-chat-hf',
      'meta-llama/Llama-3-8b-chat-hf',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'Qwen/Qwen2-72B-Instruct',
    ],
    placeholder: '...',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API for many models including free ones. Highly recommended!',
    free: true,
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    getApiKeyUrl: 'https://openrouter.ai/keys',
    docsUrl: 'https://openrouter.ai/docs',
    defaultModel: 'meta-llama/llama-3.1-70b-instruct',
    models: [
      'meta-llama/llama-3.1-70b-instruct',
      'meta-llama/llama-3.1-8b-instruct',
      'google/gemini-flash-1.5',
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'mistralai/mistral-large',
    ],
    placeholder: 'sk-or-...',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Ultra-fast inference with Llama models. FREE tier!',
    free: true,
    apiUrl: 'https://api.cerebras.ai/v1/chat/completions',
    getApiKeyUrl: 'https://cloud.cerebras.ai/',
    docsUrl: 'https://inference-docs.cerebras.ai',
    defaultModel: 'llama3.1-70b',
    models: ['llama3.1-70b', 'llama3.1-8b'],
    placeholder: '...',
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    description: 'Cost-effective inference for many models. Free tier available.',
    free: true,
    apiUrl: 'https://api.deepinfra.com/v1/openai/chat/completions',
    getApiKeyUrl: 'https://deepinfra.com/dash/api_keys',
    docsUrl: 'https://deepinfra.com/docs',
    defaultModel: 'meta-llama/Meta-Llama-3-70B-Instruct',
    models: [
      'meta-llama/Meta-Llama-3-70B-Instruct',
      'meta-llama/Meta-Llama-3-8B-Instruct',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'Qwen/Qwen2-72B-Instruct',
    ],
    placeholder: '...',
  },
  {
    id: 'zai',
    name: 'ZAI (GLM-5)',
    description: 'Zhipu AI GLM-5 — powerful LLM with OpenAI-compatible API. Free tier available!',
    free: true,
    apiUrl: 'https://api.z.ai/api/paas/v4/chat/completions',
    getApiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    docsUrl: 'https://docs.z.ai/api-reference/introduction',
    defaultModel: 'glm-5',
    models: ['glm-5', 'glm-5-turbo', 'glm-5-plus'],
    placeholder: '...',
  },
  {
    id: 'huggingface',
    name: 'HuggingFace',
    description: 'Free inference API for open-source models. Rate limited.',
    free: true,
    apiUrl: 'https://api-inference.huggingface.co/models',
    getApiKeyUrl: 'https://huggingface.co/settings/tokens',
    docsUrl: 'https://huggingface.co/docs/api-inference',
    defaultModel: 'meta-llama/Meta-Llama-3-8B-Instruct',
    models: [
      'meta-llama/Meta-Llama-3-8B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'microsoft/Phi-3-mini-4k-instruct',
    ],
    placeholder: 'hf_...',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    description: 'Edge inference with various models. Free tier.',
    free: true,
    apiUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
    getApiKeyUrl: 'https://dash.cloudflare.com/',
    docsUrl: 'https://developers.cloudflare.com/workers-ai',
    defaultModel: '@cf/meta/llama-3-8b-instruct',
    models: [
      '@cf/meta/llama-3-8b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.1',
      '@cf/qwen/qwen1.5-14b-chat-awq',
    ],
    placeholder: '...',
  },
  {
    id: 'claude-code',
    name: 'Claude Code (CLI)',
    description: 'Runs your local Claude Code CLI as a subprocess. Uses your existing Claude subscription — no API key required. CLI/Node only.',
    free: true,
    cliOnly: true,
    apiUrl: '',
    getApiKeyUrl: 'https://docs.claude.com/en/docs/claude-code/overview',
    docsUrl: 'https://docs.claude.com/en/docs/claude-code/cli-reference',
    // 'opus' / 'sonnet' / 'haiku' are aliases the claude CLI resolves to the
    // latest version in each family (currently Opus 4.7, Sonnet 4.6, Haiku 4.5).
    // Prefer aliases so this default stays correct as Anthropic ships new
    // versions without requiring a registry bump.
    defaultModel: 'opus',
    models: ['opus', 'sonnet', 'haiku', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    placeholder: '',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex (CLI)',
    description: 'Runs your local Codex CLI as a subprocess. Uses your existing OpenAI subscription — no API key required. CLI/Node only.',
    free: true,
    cliOnly: true,
    apiUrl: '',
    getApiKeyUrl: 'https://github.com/openai/codex',
    docsUrl: 'https://github.com/openai/codex#readme',
    defaultModel: 'gpt-5.5',
    models: ['gpt-5.5', 'gpt-5-codex', 'gpt-5', 'o4-mini'],
    placeholder: '',
  },
];

// Providers safe to surface in the browser UI. CLI-only runners are excluded:
// they spawn a local subprocess on the server, so they must never be selectable
// from the web client (the API routes also reject them — see isCliOnlyProvider).
export const WEB_PROVIDERS: Provider[] = PROVIDERS.filter((p) => !p.cliOnly);

// ==================== PROVIDER FUNCTIONS ====================

export function getProvider(id: ModelProvider): Provider | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export function getAvailableProvider(keys: Record<string, string | undefined>): ModelProvider | null {
  // Priority order for free providers. CLI-only runners (claude-code, codex)
  // are intentionally omitted — they require a local binary and explicit
  // --model selection, so we never auto-select them.
  const priority: ModelProvider[] = [
    'gemini', 'groq', 'openrouter', 'together', 'cerebras', 'zai',
    'mistral', 'cohere', 'deepinfra', 'huggingface', 'cloudflare',
    'openai', 'claude'
  ];

  for (const provider of priority) {
    if (keys[provider]) return provider;
  }
  return null;
}

export function isCliOnlyProvider(id: ModelProvider): boolean {
  return getProvider(id)?.cliOnly === true;
}

export function getProviderDisplayName(provider: ModelProvider): string {
  const p = getProvider(provider);
  return p?.name || provider;
}

// ==================== GENERATION FUNCTIONS ====================

interface GenerationOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  model?: string;
}

// Generic OpenAI-compatible fetch (used by Groq, Together, OpenRouter, DeepInfra, Cerebras)
async function openAICompatibleGenerate(
  apiUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: GenerationOptions = {}
): Promise<string> {
  const response = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(apiUrl.includes('openrouter') && { 'HTTP-Referer': 'https://stealthhumanizer.app' }),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.9,
      top_p: options.topP ?? 0.95,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// Gemini API (uses SDK pattern but with fetch)
async function geminiGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'gemini-1.5-flash',
  options: GenerationOptions = {}
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
      }],
      generationConfig: {
        temperature: options.temperature ?? 0.9,
        topK: 40,
        topP: options.topP ?? 0.95,
        maxOutputTokens: options.maxTokens ?? 8192,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Cohere API
async function cohereGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'command-r-plus',
  options: GenerationOptions = {}
): Promise<string> {
  const response = await fetchWithRetry('https://api.cohere.ai/v1/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      preamble: systemPrompt,
      message: userPrompt,
      temperature: options.temperature ?? 0.9,
      p: options.topP ?? 0.95,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Cohere API error: ${response.status}`);
  }

  const data = await response.json();
  return data.text || '';
}

// HuggingFace Inference API
async function huggingfaceGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'meta-llama/Meta-Llama-3-8B-Instruct',
  options: GenerationOptions = {}
): Promise<string> {
  const url = `https://api-inference.huggingface.co/models/${model}`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      inputs: `${systemPrompt}\n\n${userPrompt}`,
      parameters: {
        temperature: options.temperature ?? 0.9,
        max_new_tokens: options.maxTokens ?? 2048,
        return_full_text: false,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HuggingFace API error: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data[0]?.generated_text || '' : data.generated_text || '';
}

// Claude API
async function claudeGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'claude-sonnet-4-20250514',
  options: GenerationOptions = {}
): Promise<string> {
  const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.9,
      top_p: options.topP ?? 0.95,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b: { type?: string; text?: string }) => b.type === 'text');
  return textBlock?.text || '';
}

// ==================== MAIN GENERATION FUNCTION ====================

const CLI_RUNTIME_REQUIRED_MESSAGE =
  'CLI-runner providers (claude-code, codex) require the server runtime. ' +
  'Import generateWithProvider from "@/lib/server/providers-runtime" in server-only code.';

export async function generateWithProvider(
  provider: ModelProvider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: GenerationOptions = {}
): Promise<string> {
  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const model = options.model || providerConfig.defaultModel;
  const fullUserPrompt = `Text to humanize:\n\n${userPrompt}`;

  switch (provider) {
    case 'gemini':
      return geminiGenerate(apiKey, systemPrompt, userPrompt, model, options);

    case 'claude':
      return claudeGenerate(apiKey, systemPrompt, fullUserPrompt, model, options);

    case 'cohere':
      return cohereGenerate(apiKey, systemPrompt, fullUserPrompt, model, options);

    case 'huggingface':
      return huggingfaceGenerate(apiKey, systemPrompt, fullUserPrompt, model, options);

    case 'openai':
      return openAICompatibleGenerate(
        'https://api.openai.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'groq':
      return openAICompatibleGenerate(
        'https://api.groq.com/openai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'mistral':
      return openAICompatibleGenerate(
        'https://api.mistral.ai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'together':
      return openAICompatibleGenerate(
        'https://api.together.xyz/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'openrouter':
      return openAICompatibleGenerate(
        'https://openrouter.ai/api/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'cerebras':
      return openAICompatibleGenerate(
        'https://api.cerebras.ai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'deepinfra':
      return openAICompatibleGenerate(
        'https://api.deepinfra.com/v1/openai/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'cloudflare': {
      const accountId = apiKey.split(':')[0];
      const apiToken = apiKey.split(':')[1] || apiKey;
      // Validate accountId format to prevent SSRF
      if (!/^[a-f0-9]{32}$/i.test(accountId)) {
        throw new Error('Invalid Cloudflare account ID format. Expected 32-character hexadecimal string.');
      }
      return openAICompatibleGenerate(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        apiToken, systemPrompt, fullUserPrompt, model, options
      );
    }

    case 'zai':
      return openAICompatibleGenerate(
        'https://api.z.ai/api/paas/v4/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'claude-code':
    case 'codex':
      throw new Error(CLI_RUNTIME_REQUIRED_MESSAGE);

    default:
      throw new Error(`Provider ${provider} not implemented`);
  }
}

// ==================== ALTERNATIVE GENERATION ====================

export async function generateAlternatives(
  provider: ModelProvider,
  apiKey: string,
  originalSentence: string,
  currentHumanized: string,
  systemPrompt: string,
  count: number = 3
): Promise<string[]> {
  const altPrompt = `${systemPrompt}

ORIGINAL SENTENCE: "${originalSentence}"
CURRENT HUMANIZED VERSION: "${currentHumanized}"

Provide ${count} DIFFERENT alternative humanizations of the original sentence. Make each one noticeably different from the current version and from each other while still preserving meaning.

Return ONLY the ${count} alternative sentences, one per line. No numbering, no explanations.`;

  const result = await generateWithProvider(provider, apiKey, altPrompt, '', { temperature: 1.0, maxTokens: 1024 });

  return result
    .split('\n')
    .map(line => line.replace(/^[\d\-\*\.]+\s*/, '').trim())
    .filter(line => line.length > 10 && line !== currentHumanized)
    .slice(0, count);
}

// ==================== TEST API KEY ====================

export async function testApiKey(provider: ModelProvider, apiKey: string): Promise<boolean> {
  // CLI-runner providers don't have API keys to test from the browser. The
  // server-side equivalent is testCliProvider() in lib/server/providers-runtime.
  if (isCliOnlyProvider(provider)) return false;
  try {
    await generateWithProvider(provider, apiKey, 'You are a test assistant.', 'Say "ok" and nothing else.', { maxTokens: 10 });
    return true;
  } catch {
    return false;
  }
}
