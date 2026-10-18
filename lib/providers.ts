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

const ALLOWED_HOSTS = new Set([
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
  'api.mistral.ai', 'api.cohere.ai', 'api.groq.com', 'api.together.xyz',
  'openrouter.ai', 'api.deepinfra.com', 'api.cloudflare.com',
  'api.gptzero.me', 'api.z.ai', 'router.huggingface.co', 'api.cerebras.ai',
  'opencode.ai', 'crof.ai', 'global.ocenza.com', 'token-plan-sgp.xiaomimimo.com',
  'integrate.api.nvidia.com', 'api.kilo.ai', 'inference-api.nousresearch.com',
  'api.perplexity.ai', 'api.fireworks.ai', 'api.openadapter.in',
  'www.codebuff.com', 'api.commandcode.ai', 'cloudcode-pa.googleapis.com',
]);

// Local inference endpoints (Ollama, LM Studio, vLLM) listen on plain http over
// loopback. Loopback addresses can never reach an external network, so allowing
// them does not weaken the SSRF protection that the HTTPS + allowlist rule
// provides for remote providers.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

function sanitizeUrl(input: string): string {
  const parsed = new URL(input);
  if (LOOPBACK_HOSTS.has(parsed.hostname)) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Loopback URL must be http or https, got: ${parsed.protocol}`);
    }
    return parsed.href;
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Only HTTPS is allowed, got: ${parsed.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host not in allowlist: ${parsed.hostname}`);
  }
  return parsed.href;
}

function sanitizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  // Gemini model IDs are expected to be simple identifiers like "gemini-1.5-flash".
  // Restrict to safe characters so user input cannot alter URL structure.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error('Invalid Gemini model identifier');
  }
  return trimmed;
}

export async function fetchWithRetry(
  rawUrl: string,
  options: RequestInit = {},
  // 45s single attempt: LLM generations (thinking models especially) routinely
  // exceed 30s, and a 30s × 2-retry budget (60s+) overruns the Vercel Hobby
  // function clamp — the function gets killed mid-flight and the browser shows
  // a bare "Failed to fetch". One 45s attempt keeps the worst case inside the
  // function budget so callers always get a real JSON error they can display.
  timeoutMs: number = 45_000,
  maxRetries: number = 0,
): Promise<Response> {
  const url = sanitizeUrl(rawUrl);

  const defaultHeaders: Record<string, string> =
    typeof window === 'undefined'
      ? { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      : {};

  const mergedHeaders = {
    ...defaultHeaders,
    ...(options.headers as Record<string, string> || {}),
  };

  const finalOptions: RequestInit = {
    ...options,
    headers: mergedHeaders,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // eslint-disable-next-line no-restricted-syntax -- URL validated against provider allowlist above
      const response = await fetch(url, { ...finalOptions, signal: controller.signal }); // lgtm[js/request-forgery]
      clearTimeout(timeout);

      if (response.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Server error: ${response.status}`);
        continue;
      }
      return response;
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error(
          `The provider took over ${Math.round(timeoutMs / 1000)}s to respond and was stopped to avoid a gateway timeout. Try a shorter text, a faster model, or Rudra's Free Usage Model.`
        );
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
    id: 'rudra-free',
    name: "Rudra's Free Usage Model",
    description: 'Free pre-configured model hosted on the maintainer’s Oracle Cloud ARM VPS. No API key needed — just click Humanize. Powered by amicus-humanizer-v1 (ONNX INT8, 60M). Default for all new users.',
    free: true,
    apiUrl: '',
    getApiKeyUrl: '',
    docsUrl: 'https://github.com/rudra496/StealthHumanizer#rudras-free-usage-model',
    defaultModel: 'amicus-humanizer-v1-onnx',
    models: ['amicus-humanizer-v1-onnx'],
    placeholder: 'pre-configured',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Free tier with generous limits. Recommended for most users!',
    free: true,
    apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    getApiKeyUrl: 'https://aistudio.google.com/apikey',
    docsUrl: 'https://ai.google.dev/docs',
    defaultModel: 'gemini-3.5-flash-lite',
    models: [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-4-argon',
      'gemini-2.5-flash',
    ],
    placeholder: 'AIza...',
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    description: 'Industry-leading AI, excellent quality for complex texts',
    free: false,
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    getApiKeyUrl: 'https://platform.openai.com/api-keys',
    docsUrl: 'https://developers.openai.com/api/docs/models',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5-mini', 'gpt-4o'],
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
    defaultModel: 'claude-sonnet-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    placeholder: 'sk-ant-...',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference with Qwen, GPT-OSS and Compound models. FREE tier!',
    free: true,
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    getApiKeyUrl: 'https://console.groq.com/keys',
    docsUrl: 'https://console.groq.com/docs',
    defaultModel: 'qwen/qwen3.8-27b',
    models: [
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
    ],
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
    defaultModel: 'mistral-small-latest',
    models: [
      'mistral-large-4-0',
      'mistral-medium-latest',
      'mistral-large-latest',
      'mistral-small-latest',
      'ministral-3-14b-25-12',
      'ministral-3-8b-25-12',
    ],
    placeholder: '...',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Enterprise-focused AI with strong language understanding. Free tier.',
    free: true,
    apiUrl: 'https://api.cohere.ai/v2/chat',
    getApiKeyUrl: 'https://dashboard.cohere.com/api-keys',
    docsUrl: 'https://docs.cohere.com',
    defaultModel: 'command-a-03-2025',
    models: [
      'command-a-03-2025',
      'command-a-plus-05-2026',
      'command-a-reasoning-08-2025',
      'command-r-plus-08-2024',
      'command-r-08-2024',
      'command-r7b-12-2024',
    ],
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
    defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash',
    models: [
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'meta-models/Muse-Glimmer-30B',
      'zai-org/GLM-5.3-Flash',
      'openai/gpt-oss-120b',
      'Qwen/Qwen3.8-Flash',
      'Qwen/Qwen3.5-9B',
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
    defaultModel: 'deepseek/deepseek-v4.1-flash',
    models: [
      'deepseek/deepseek-v4.1-flash',
      'meta-llama/llama-3.3-70b-instruct',
      'mistralai/mistral-small-3.2-24b-instruct',
      'google/gemini-3.1-flash-lite',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3.5-lightning:free',
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
    defaultModel: 'qwen-3.8-27b',
    models: [
      'qwen-3.8-27b',
      'gpt-oss-120b',
    ],
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
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'google/gemma-4-31B-it',
      'deepseek-ai/DeepSeek-V3.2',
      'mistralai/Mistral-Small-3.2-24B-Instruct-2506',
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
    defaultModel: 'glm-5.3-flash',
    models: [
      'glm-5.3-flash',
      'glm-5.3',
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'glm-4.7',
    ],
    placeholder: '...',
  },
  {
    id: 'huggingface',
    name: 'HuggingFace',
    description: 'Free inference API for open-source models. Rate limited.',
    free: true,
    apiUrl: 'https://router.huggingface.co/v1/chat/completions',
    getApiKeyUrl: 'https://huggingface.co/settings/tokens',
    docsUrl: 'https://huggingface.co/docs/inference-providers',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct',
      'google/gemma-4-26B-A4B-it',
      'Qwen/Qwen3-4B-Instruct-2507',
      'meta-llama/Llama-3.1-8B-Instruct',
      'openai/gpt-oss-20b',
    ],
    placeholder: 'hf_...',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    description: 'Edge inference with various models. Free tier.',
    free: true,
    apiUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions',
    getApiKeyUrl: 'https://dash.cloudflare.com/',
    docsUrl: 'https://developers.cloudflare.com/workers-ai',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    models: [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      '@cf/meta/llama-3.2-3b-instruct',
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
    // latest version in each family (currently Opus 5.5, Sonnet 5.5, Haiku 5.5).
    // Prefer aliases so this default stays correct as Anthropic ships new
    // versions without requiring a registry bump.
    defaultModel: 'opus',
    models: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    placeholder: '',
  },
  {
    id: 'codebuff',
    name: 'Codebuff (Freebuff)',
    description: 'Access free AI models like DeepSeek V4 and Kimi K2.6 via Codebuff integration.',
    free: true,
    apiUrl: 'https://www.codebuff.com/api/v1/chat/completions',
    getApiKeyUrl: 'https://www.codebuff.com',
    docsUrl: 'https://www.codebuff.com',
    defaultModel: 'deepseek/deepseek-v4-flash',
    models: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro', 'moonshotai/kimi-k2.6', 'minimax/minimax-m2.7'],
    placeholder: 'cb_...',
  },
  {
    id: 'command-code',
    name: 'Command Code',
    description: 'Use the Command Code /alpha/generate engine for custom agentic humanization.',
    free: false,
    apiUrl: 'https://api.commandcode.ai/alpha/generate',
    getApiKeyUrl: 'https://api.commandcode.ai',
    docsUrl: 'https://api.commandcode.ai',
    defaultModel: 'deepseek/deepseek-v4-flash',
    models: [
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'moonshotai/Kimi-K2.6',
      'zai-org/GLM-5.1',
      'MiniMaxAI/MiniMax-M2.7',
      'Qwen/Qwen3.6-Plus',
    ],
    placeholder: 'cc_...',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    description: 'Free AI model inference via OpenCode Zen gateway.',
    free: true,
    apiUrl: 'https://opencode.ai/inference/openai/v1/chat/completions',
    getApiKeyUrl: 'https://opencode.ai',
    docsUrl: 'https://opencode.ai',
    defaultModel: 'glm-5.3-flash',
    models: [
      'glm-5.3-flash',
      'glm-5.3',
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'kimi-k3',
      'minimax-m3',
      'mistral-large-4',
      'qwen3.8-max',
    ],
    placeholder: 'zen_...',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: 'Paid/dedicated OpenCode Go gateway.',
    free: false,
    apiUrl: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
    getApiKeyUrl: 'https://opencode.ai',
    docsUrl: 'https://opencode.ai',
    defaultModel: 'glm-5.3-flash',
    models: [
      'glm-5.3-flash',
      'glm-5.3',
      'deepseek-v4.1-flash',
      'deepseek-v4-pro',
      'kimi-k3',
      'mimo-v2.6-flash',
      'mimo-v2.6-pro',
    ],
    placeholder: 'go_...',
  },
  {
    id: 'crof',
    name: 'Crof.ai',
    description: 'Enterprise AI assistant gateway via Crof.ai.',
    free: false,
    apiUrl: 'https://crof.ai/v1/chat/completions',
    getApiKeyUrl: 'https://crof.ai',
    docsUrl: 'https://crof.ai',
    defaultModel: 'default',
    models: ['default'],
    placeholder: 'crof_...',
  },
  {
    id: 'ocenza',
    name: 'Ocenza',
    description: 'High-capacity AI orchestration platform.',
    free: false,
    apiUrl: 'https://global.ocenza.com/v1/chat/completions',
    getApiKeyUrl: 'https://global.ocenza.com',
    docsUrl: 'https://global.ocenza.com',
    defaultModel: 'gpt-oss-120b',
    models: ['gpt-oss-120b', 'mimo-v2-pro', 'mimo-v2.5', 'mimo-v2.5-pro'],
    placeholder: 'oc_...',
  },
  {
    id: 'mimo',
    name: 'MiMo (Xiaomi)',
    description: 'Edge inference platform by Xiaomi MiMo.',
    free: false,
    apiUrl: 'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    getApiKeyUrl: 'https://xiaomimimo.com',
    docsUrl: 'https://xiaomimimo.com',
    defaultModel: 'mimo-v2-omni',
    models: ['mimo-v2-omni', 'mimo-v2-pro', 'mimo-v2.5', 'mimo-v2.5-pro'],
    placeholder: 'mimo_...',
  },
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    description: 'High-performance NVIDIA NIM inference API.',
    free: false,
    apiUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    getApiKeyUrl: 'https://integrate.api.nvidia.com',
    docsUrl: 'https://integrate.api.nvidia.com',
    defaultModel: 'google/gemma-4-31b-it',
    models: [
      'google/gemma-4-31b-it',
      'deepseek-ai/deepseek-v4.1-flash',
      'openai/gpt-oss-20b',
    ],
    placeholder: 'nv_...',
  },
  {
    id: 'kilo-gateway',
    name: 'Kilo.ai Gateway',
    description: 'Developer-focused AI gateway from Kilo.ai.',
    free: false,
    apiUrl: 'https://api.kilo.ai/api/gateway/chat/completions',
    getApiKeyUrl: 'https://api.kilo.ai',
    docsUrl: 'https://api.kilo.ai',
    defaultModel: 'default',
    models: ['default'],
    placeholder: 'kilo_...',
  },
  {
    id: 'nous-research',
    name: 'Nous Research',
    description: 'State-of-the-art open-source models from Nous Research.',
    free: true,
    apiUrl: 'https://inference-api.nousresearch.com/v1/chat/completions',
    getApiKeyUrl: 'https://nousresearch.com',
    docsUrl: 'https://nousresearch.com',
    defaultModel: 'stepfun/step-3.7-flash:free',
    models: ['stepfun/step-3.7-flash:free'],
    placeholder: 'nous_...',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Conversational search and language models from Perplexity.',
    free: false,
    apiUrl: 'https://api.perplexity.ai/chat/completions',
    getApiKeyUrl: 'https://api.perplexity.ai',
    docsUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
    placeholder: 'pplx_...',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Ultra-fast inference platform for open models.',
    free: false,
    apiUrl: 'https://api.fireworks.ai/inference/v1/chat/completions',
    getApiKeyUrl: 'https://api.fireworks.ai',
    docsUrl: 'https://api.fireworks.ai',
    defaultModel: 'accounts/fireworks/models/glm-5p3-flash',
    models: [
      'accounts/fireworks/models/glm-5p3-flash',
      'accounts/fireworks/models/kimi-k3',
    ],
    placeholder: 'fw_...',
  },
  {
    id: 'openadapter',
    name: 'OpenAdapter',
    description: 'Multi-model unified inference API from OpenAdapter.',
    free: true,
    apiUrl: 'https://api.openadapter.in/v1/chat/completions',
    getApiKeyUrl: 'https://api.openadapter.in',
    docsUrl: 'https://api.openadapter.in',
    defaultModel: '0G-DeepSeek-v4-Pro',
    models: ['0G-DeepSeek-V3', '0G-DeepSeek-v4-Pro', '0G-GLM-5.1', '0G-Qwen3.6'],
    placeholder: 'oa_...',
  },
  {
    id: 'zai-coding',
    name: 'Z.ai Coding',
    description: 'Z.ai Coding API for advanced programming assistants.',
    free: false,
    apiUrl: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    getApiKeyUrl: 'https://z.ai',
    docsUrl: 'https://z.ai',
    defaultModel: 'glm-5.3-flash',
    models: [
      'glm-5.3-flash',
      'glm-5.3',
    ],
    placeholder: 'zai_...',
  },
  {
    id: 'google-gemini-oauth',
    name: 'Google Gemini (OAuth)',
    description: 'Standard Google Gemini API gateway utilizing OAuth access token authentication.',
    free: true,
    apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal:generateContent',
    getApiKeyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.1-flash-lite',
    models: [
      'gemini-3.1-flash-lite',
      'gemini-3-flash',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ],
    placeholder: 'ya29....',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Local Ollama instance (http://localhost:11434/v1). No API key needed on the server — the humanizer runs server-side and reaches Ollama over loopback. Default model: gemma3:4b.',
    free: true,
    apiUrl: 'http://localhost:11434/v1/chat/completions',
    getApiKeyUrl: 'http://localhost:11434',
    defaultModel: 'gemma3:4b',
    models: [
      'gemma3:4b',
      'gemma4:e4b',
      'gemma4:e2b',
      'qwen3.5:4b',
      'qwen3.5:9b',
      'llama3.2:3b',
      'ministral-3:8b',
      'phi4-mini:3.8b',
      'gemma3:1b',
    ],
    placeholder: 'ollama',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio (Local)',
    description: 'Standard local LM Studio instance (default: http://127.0.0.1:1234/v1).',
    free: true,
    apiUrl: 'http://127.0.0.1:1234/v1/chat/completions',
    getApiKeyUrl: 'http://127.0.0.1:1234',
    defaultModel: 'default',
    models: ['default'],
    placeholder: 'lm-studio',
  },
  {
    id: 'vllm',
    name: 'vLLM (Local/Self-hosted)',
    description: 'Standard self-hosted vLLM or OpenAI-compatible instance (default: http://localhost:8000/v1).',
    free: true,
    apiUrl: 'http://localhost:8000/v1/chat/completions',
    getApiKeyUrl: 'http://localhost:8000',
    defaultModel: 'default',
    models: ['default'],
    placeholder: 'vllm',
  },
  {
    id: 'opencode-zen-anthropic',
    name: 'OpenCode Zen (Anthropic)',
    description: 'Anthropic-compatible endpoint for OpenCode Zen.',
    free: true,
    apiUrl: 'https://opencode.ai/inference/anthropic/v1/messages',
    getApiKeyUrl: 'https://opencode.ai',
    defaultModel: 'claude-haiku-5-5',
    models: [
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'qwen3.8-flash',
    ],
    placeholder: 'zen_...',
  },
  {
    id: 'opencode-go-anthropic',
    name: 'OpenCode Go (Anthropic)',
    description: 'Anthropic-compatible paid gateway for OpenCode Go.',
    free: false,
    apiUrl: 'https://opencode.ai/inference/go/anthropic/v1/messages',
    getApiKeyUrl: 'https://opencode.ai',
    defaultModel: 'minimax-m3',
    models: [
      'minimax-m3',
      'claude-haiku-5-5',
      'qwen3.8-max',
      'qwen3.8-flash',
    ],
    placeholder: 'go_...',
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
    // GPT-5.5 retired from Codex for ChatGPT sign-in on 2026-10-14.
    defaultModel: 'gpt-6.1-sol',
    models: ['gpt-6.1-sol', 'gpt-6-luna'],
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
    'rudra-free',
    'gemini', 'groq', 'openrouter', 'together', 'cerebras', 'zai',
    'mistral', 'cohere', 'deepinfra', 'huggingface', 'cloudflare',
    'codebuff', 'command-code',
    'opencode-zen', 'opencode-go', 'crof', 'ocenza', 'mimo',
    'nvidia-nim', 'kilo-gateway', 'nous-research', 'perplexity',
    'fireworks', 'openadapter', 'zai-coding',
    'google-gemini-oauth', 'ollama', 'lm-studio',
    'vllm', 'opencode-zen-anthropic', 'opencode-go-anthropic',
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

// OpenAI's GPT-5+ and o-series are reasoning models. Pick the lightest effort
// each one accepts — humanization is a single-pass rewrite. Returns null for
// non-reasoning models (gpt-4o etc.), which take no reasoning_effort.
// "none" is documented for the GPT-6 family (except Astra and 6.1 Sol); the
// GPT-5 family's lowest documented effort is "minimal".
function openAIReasoningEffort(model: string): 'none' | 'minimal' | 'low' | null {
  if (/^gpt-6-astra|^gpt-6\.1-sol/.test(model)) return 'low';
  if (/^gpt-6/.test(model)) return 'none';
  if (/^gpt-5/.test(model)) return 'minimal';
  if (/^o\d/.test(model)) return 'low';
  return null;
}

interface RequestExtras {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  // Set when reasoning can't be fully turned off: reasoning tokens count
  // against the output limit, so the request needs extra room for them.
  reasoningHeadroom?: boolean;
}

// Most current open-weight models (Qwen 3.x, DeepSeek V4, GLM 5, gpt-oss,
// Gemma 4) reason by default. Humanization is a single-pass rewrite, so turn
// reasoning off where the host allows it, or down to its lowest level where it
// can't be disabled. Each host spells this differently.
function hostReasoningParams(provider: ModelProvider, model: string): RequestExtras {
  const lowGptOss = { body: { reasoning_effort: 'low' }, reasoningHeadroom: true };
  const lowGlm53 = { body: { reasoning_effort: 'low' }, reasoningHeadroom: true };
  switch (provider) {
    case 'groq':
      if (/gpt-oss/.test(model)) return { body: { reasoning_effort: 'low', include_reasoning: false }, reasoningHeadroom: true };
      if (/qwen3/.test(model)) return { body: { reasoning_effort: 'none' } };
      return {};
    case 'cerebras':
      if (/gpt-oss/.test(model)) return lowGptOss;
      if (/qwen/.test(model)) return { body: { reasoning_effort: 'none' } };
      return {};
    case 'mistral':
      // Small 4, Medium 3.5 and Large 4 are hybrid reasoning models.
      return /^mistral-(small|medium)|^mistral-large-4/.test(model) ? { body: { reasoning_effort: 'none' } } : {};
    case 'together':
      if (/gpt-oss/.test(model)) return lowGptOss;
      if (/GLM-5\.3/i.test(model)) return lowGlm53;
      if (/DeepSeek-V4|Qwen3\.5/i.test(model)) return { body: { reasoning: { enabled: false } } };
      return {};
    case 'openrouter':
      return /^(deepseek|qwen)\//.test(model) ? { body: { reasoning: { effort: 'none' } } } : {};
    case 'fireworks':
      if (/gpt-oss/.test(model)) return lowGptOss;
      if (/glm-5p3/.test(model)) return lowGlm53;
      if (/deepseek/.test(model)) return { body: { reasoning_effort: 'none' } };
      return {};
    case 'nvidia-nim':
      return /glm-5\.3/.test(model) ? lowGlm53 : {};
    case 'zai':
    case 'zai-coding':
      // GLM-5.3 thinking can't be disabled; older GLM models can turn it off.
      return /^glm-5\.3/.test(model) ? lowGlm53 : { body: { thinking: { type: 'disabled' } } };
    case 'ollama':
      return /^(gemma4|qwen3)/.test(model) ? { body: { reasoning_effort: 'none' } } : {};
    default:
      return {};
  }
}

// Generic OpenAI-compatible fetch (used by Groq, Together, OpenRouter, DeepInfra, Cerebras)
// Exact-host checks only: substring matching like apiUrl.includes('groq.com')
// accepts attacker-shaped URLs where "groq.com" appears anywhere
// (CodeQL js/incomplete-url-substring-sanitization).
function apiUrlHost(apiUrl: string): string {
  try {
    return new URL(apiUrl).hostname;
  } catch {
    return '';
  }
}

async function openAICompatibleGenerate(
  apiUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: GenerationOptions = {},
  extras: RequestExtras = {}
): Promise<string> {
  const apiHost = apiUrlHost(apiUrl);
  const isGroq = apiHost === 'api.groq.com';
  const estimatedInputTokens = Math.ceil((userPrompt.length + systemPrompt.length) / 3);

  // Groq free tier enforces a strict 1000 Output Tokens Per Minute (OTPM) limit per request.
  // When max_tokens exceeds 950, Groq immediately returns a 400 limit error.
  // Cap Groq at 900 tokens maximum, with headroom proportional to expected output.
  let maxTokens = options.maxTokens;
  if (isGroq) {
    if (!maxTokens || maxTokens > 900) {
      maxTokens = Math.min(900, Math.max(250, Math.ceil(estimatedInputTokens * 1.5) + 100));
    }
  } else if (!maxTokens) {
    maxTokens = 4096;
  }

  // OpenAI reasoning models reject max_tokens, and reject temperature/top_p
  // unless reasoning effort is 'none'. Reasoning tokens also count against
  // max_completion_tokens, so give non-'none' efforts headroom to avoid an
  // empty reply cut off at finish_reason "length".
  const effort = apiHost === 'api.openai.com' ? openAIReasoningEffort(model) : null;
  const allowSampling = effort === null || effort === 'none';
  if (!allowSampling || extras.reasoningHeadroom) {
    maxTokens += isGroq ? 1024 : 4096;
  }
  // Cerebras also wants max_completion_tokens.
  const tokenParams = apiHost === 'api.openai.com' || apiHost === 'api.cerebras.ai'
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };

  const response = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(apiHost === 'openrouter.ai' && { 'HTTP-Referer': 'https://stealthhumanizer.app' }),
      ...extras.headers,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(allowSampling && {
        temperature: options.temperature ?? 0.9,
        top_p: options.topP ?? 0.95,
      }),
      ...(effort && { reasoning_effort: effort }),
      ...extras.body,
      ...tokenParams,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const detail = error.error?.message || error.message || `API error: ${response.status}`;
    throw new Error(detail);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  // Hybrid reasoning models (e.g. Mistral) can return content as a list of
  // thinking + text chunks instead of a string.
  if (Array.isArray(content)) {
    return content
      .filter((c: { type?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text || '')
      .join('');
  }
  return content || '';
}

// Gemini 2.5 models are "thinking" models: with the default reasoning budget
// they can spend 30-60s+ thinking before the first output token, which blows
// through the fetch timeout and the Vercel function clamp. Humanization is a
// single-pass rewrite — no multi-step reasoning needed — so keep thinking as
// low as each model allows. 2.5 Flash/Flash-Lite take thinkingBudget 0 (2.5 Pro
// can't disable thinking). Gemini 3.x and 4 can't turn thinking off and take
// thinkingLevel instead; 3.8 Flash, 4 and the 3.1 Pro preview reject 'minimal'.
// Sending thinkingBudget and thinkingLevel together is a 400.
function geminiThinkingConfig(model: string): Record<string, unknown> | undefined {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-(4|3\.8)|^gemini-3\.1-pro/.test(model)) return { thinkingLevel: 'low' };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'minimal' };
  return undefined;
}

// Gemini 3 and later ignore temperature/topP/topK (deprecated, slated to become
// a 400), so only send sampling params to Gemini 2.x.
function geminiSamplingConfig(model: string, options: GenerationOptions): Record<string, unknown> {
  if (!/^gemini-2\./.test(model)) return {};
  return {
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.topP !== undefined && { topP: options.topP }),
  };
}

// Gemini API (uses SDK pattern but with fetch)
async function geminiGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'gemini-2.5-flash',
  options: GenerationOptions = {}
): Promise<string> {
  const safeModel = encodeURIComponent(sanitizeGeminiModel(model));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`;

  const thinkingConfig = geminiThinkingConfig(safeModel);
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        role: "user",
        parts: [{ text: userPrompt }]
      }],
      generationConfig: {
        ...geminiSamplingConfig(safeModel, {
          temperature: options.temperature ?? 0.9,
          topP: options.topP ?? 0.95,
        }),
        ...(/^gemini-2\./.test(safeModel) && { topK: 40 }),
        maxOutputTokens: options.maxTokens ?? 8192,
        ...(thinkingConfig && { thinkingConfig }),
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  // Join non-thought text parts (thinking models can emit separate thought
  // parts); an empty text with a finishReason means the model produced nothing
  // usable — surface that instead of silently returning ''.
  const text = (candidate?.content?.parts || [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  if (!text) {
    throw new Error(
      `Gemini returned an empty response (finishReason: ${candidate?.finishReason || 'unknown'}). Try a different Gemini model or a shorter text.`
    );
  }
  return text;
}

// Cohere API
// Cohere Chat v2. Command A+ and Command A Reasoning think by default; v2 is
// the only version that can turn that off.
async function cohereGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'command-a-03-2025',
  options: GenerationOptions = {}
): Promise<string> {
  const isReasoningModel = /^command-a-(plus|reasoning)/.test(model);
  const response = await fetchWithRetry('https://api.cohere.ai/v2/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.9,
      p: Math.min(options.topP ?? 0.95, 0.99),
      max_tokens: options.maxTokens ?? 4096,
      ...(isReasoningModel && { thinking: { type: 'disabled' } }),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Cohere API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = data.message?.content?.find((c: { type?: string; text?: string }) => c.type === 'text');
  return textBlock?.text || '';
}

// Anthropic-compatible Inference API
async function anthropicCompatibleGenerate(
  apiUrl: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: GenerationOptions = {},
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  // Claude Opus 4.7+, Sonnet 5+, Haiku 5+ and Fable reject temperature/top_p,
  // and some run thinking that can't be turned off — use low effort instead,
  // with max_tokens headroom since thinking counts against it. Older Claude
  // models reject temperature and top_p together, so send temperature only.
  // Non-Claude models behind Anthropic-compatible proxies keep both.
  const maxTokens = options.maxTokens ?? 4096;
  const isClaude = model.startsWith('claude-');
  const isModernClaude = /^claude-(opus-4-[78]|opus-5|sonnet-5|haiku-5|fable|mythos)/.test(model);
  const samplingParams = isModernClaude
    ? { output_config: { effort: 'low' } }
    : isClaude
      ? { temperature: options.temperature ?? 0.9 }
      : { temperature: options.temperature ?? 0.9, top_p: options.topP ?? 0.95 };

  const response = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      max_tokens: isModernClaude ? maxTokens + 4096 : maxTokens,
      ...samplingParams,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Anthropic-compatible API error: ${response.status}`);
  }

  const data = await response.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('The model declined this request (stop_reason: refusal).');
  }
  const textBlock = data.content?.find((b: { type?: string; text?: string }) => b.type === 'text');
  return textBlock?.text || '';
}

// Claude API
async function claudeGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'claude-sonnet-5-5',
  options: GenerationOptions = {}
): Promise<string> {
  return anthropicCompatibleGenerate('https://api.anthropic.com/v1/messages', apiKey, systemPrompt, userPrompt, model, options);
}

// Google Gemini OAuth API
async function googleOAuthGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: GenerationOptions = {}
): Promise<string> {
  const url = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
  
  const contents = [
    {
      role: 'user',
      parts: [{ text: userPrompt }]
    }
  ];
  
  const systemInstruction = {
    parts: [{ text: systemPrompt }]
  };
  
  const requestBody: any = {
    contents,
    systemInstruction,
  };
  
  const thinkingConfig = geminiThinkingConfig(model);
  const generationConfig = {
    ...geminiSamplingConfig(model, options),
    ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
    ...(thinkingConfig && { thinkingConfig }),
  };
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generationConfig = generationConfig;
  }
  
  const wrapped: any = {
    model,
    request: requestBody,
  };
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': 'google-api-nodejs-client/9.15.1',
    'X-Goog-Api-Client': 'gl-node/22.17.0',
    'Client-Metadata': 'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
  };

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(wrapped),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Google OAuth API error: ${response.status}`);
  }

  const data = await response.json();
  const candidates = data.response?.candidates || data.candidates;
  return candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Command Code custom generation using /alpha/generate
async function commandCodeGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'deepseek/deepseek-v4-flash',
  options: GenerationOptions = {}
): Promise<string> {
  const url = 'https://api.commandcode.ai/alpha/generate';
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-command-code-version': '0.26.8',
    },
    body: JSON.stringify({
      config: {},
      memory: '',
      taste: '',
      skills: '',
      params: {
        stream: false,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.3,
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
        ],
        model,
        tools: [],
      },
      threadId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Command Code API error: ${response.status}`);
  }

  const rawText = await response.text();
  let text = '';
  const lines = rawText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let dataStr = trimmed;
    if (trimmed.startsWith('data: ')) {
      dataStr = trimmed.slice(6);
    } else if (trimmed.startsWith('data:')) {
      dataStr = trimmed.slice(5);
    }
    if (dataStr === '[DONE]') continue;
    try {
      const d = JSON.parse(dataStr);
      if (d.type === 'text-delta' && d.text) {
        text += d.text;
      }
    } catch {}
  }
  return text;
}

// ==================== MAIN GENERATION FUNCTION ====================

const CLI_RUNTIME_REQUIRED_MESSAGE =
  'CLI-runner providers (claude-code, codex) require the server runtime. ' +
  'Import generateWithProvider from "@/lib/server/providers-runtime" in server-only code.';

// OpenCode Go rejects requests without a per-conversation session id
// (400 MissingSessionID). Each humanize call is its own conversation.
function openCodeGoHeaders(): Record<string, string> {
  return { 'x-opencode-session': globalThis.crypto.randomUUID() };
}

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
  const extras = hostReasoningParams(provider, model);

  switch (provider) {
    case 'gemini':
      return geminiGenerate(apiKey, systemPrompt, userPrompt, model, options);

    case 'claude':
      return claudeGenerate(apiKey, systemPrompt, fullUserPrompt, model, options);

    case 'cohere':
      return cohereGenerate(apiKey, systemPrompt, fullUserPrompt, model, options);

    case 'huggingface':
      return openAICompatibleGenerate(
        'https://router.huggingface.co/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'openai':
      return openAICompatibleGenerate(
        'https://api.openai.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'groq':
      return openAICompatibleGenerate(
        'https://api.groq.com/openai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'mistral':
      return openAICompatibleGenerate(
        'https://api.mistral.ai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'together':
      return openAICompatibleGenerate(
        'https://api.together.xyz/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'openrouter':
      return openAICompatibleGenerate(
        'https://openrouter.ai/api/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'cerebras':
      return openAICompatibleGenerate(
        'https://api.cerebras.ai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'deepinfra':
      return openAICompatibleGenerate(
        'https://api.deepinfra.com/v1/openai/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'cloudflare': {
      const accountId = apiKey.split(':')[0];
      const apiToken = apiKey.split(':')[1] || apiKey;
      // Validate accountId format to prevent SSRF
      if (!/^[a-f0-9]{32}$/i.test(accountId)) {
        throw new Error('Invalid Cloudflare account ID format. Expected 32-character hexadecimal string.');
      }
      // Model ids look like "@cf/meta/llama-3.3-70b-instruct-fp8-fast".
      if (!/^@?[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(model)) {
        throw new Error('Invalid Cloudflare model format.');
      }
      return openAICompatibleGenerate(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
        apiToken, systemPrompt, fullUserPrompt, model, options, extras
      );
    }

    case 'zai':
      return openAICompatibleGenerate(
        'https://api.z.ai/api/paas/v4/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'opencode-zen':
      return openAICompatibleGenerate(
        'https://opencode.ai/inference/openai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'opencode-go':
      return openAICompatibleGenerate(
        'https://opencode.ai/inference/go/openai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options,
        { ...extras, headers: openCodeGoHeaders() }
      );

    case 'crof':
      return openAICompatibleGenerate(
        'https://crof.ai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'ocenza':
      return openAICompatibleGenerate(
        'https://global.ocenza.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'mimo':
      return openAICompatibleGenerate(
        'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'nvidia-nim':
      return openAICompatibleGenerate(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'kilo-gateway':
      return openAICompatibleGenerate(
        'https://api.kilo.ai/api/gateway/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'nous-research':
      return openAICompatibleGenerate(
        'https://inference-api.nousresearch.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'perplexity':
      return openAICompatibleGenerate(
        'https://api.perplexity.ai/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'fireworks':
      return openAICompatibleGenerate(
        'https://api.fireworks.ai/inference/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'openadapter':
      return openAICompatibleGenerate(
        'https://api.openadapter.in/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'zai-coding':
      return openAICompatibleGenerate(
        'https://api.z.ai/api/coding/paas/v4/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'codebuff':
      return openAICompatibleGenerate(
        'https://www.codebuff.com/api/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'command-code':
      return commandCodeGenerate(
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'google-gemini-oauth':
      return googleOAuthGenerate(
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'ollama':
      return openAICompatibleGenerate(
        'http://localhost:11434/v1/chat/completions',
        apiKey || 'ollama', systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'lm-studio':
      return openAICompatibleGenerate(
        'http://127.0.0.1:1234/v1/chat/completions',
        apiKey || 'lm-studio', systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'vllm':
      return openAICompatibleGenerate(
        'http://localhost:8000/v1/chat/completions',
        apiKey || 'vllm', systemPrompt, fullUserPrompt, model, options, extras
      );

    case 'opencode-zen-anthropic':
      return anthropicCompatibleGenerate(
        'https://opencode.ai/inference/anthropic/v1/messages',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'opencode-go-anthropic':
      return anthropicCompatibleGenerate(
        'https://opencode.ai/inference/go/anthropic/v1/messages',
        apiKey, systemPrompt, fullUserPrompt, model, options, openCodeGoHeaders()
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

  const altMaxTokens = provider === 'groq' ? 400 : 1024;
  const result = await generateWithProvider(provider, apiKey, altPrompt, '', { temperature: 1.0, maxTokens: altMaxTokens });

  return result
    .split('\n')
    .map(line => line.replace(/^[\d\-\*\.]+\s*/, '').trim())
    .filter(line => line.length > 10 && line !== currentHumanized)
    .slice(0, count);
}

// ==================== TEST API KEY ====================

export async function validateApiKey(provider: ModelProvider, apiKey: string): Promise<{ valid: boolean; error?: string }> {
  // CLI-runner providers don't have API keys to test from the browser. The
  // server-side equivalent is testCliProvider() in lib/server/providers-runtime.
  if (isCliOnlyProvider(provider)) return { valid: false, error: 'CLI-only provider cannot be tested in browser' };
  try {
    await generateWithProvider(provider, apiKey, 'You are a test assistant.', 'Say "ok" and nothing else.', { maxTokens: 10 });
    return { valid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: msg };
  }
}

export async function testApiKey(provider: ModelProvider, apiKey: string): Promise<boolean> {
  const res = await validateApiKey(provider, apiKey);
  return res.valid;
}
