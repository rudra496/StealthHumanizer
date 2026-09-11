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
  'api.gptzero.me', 'api.z.ai',
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

function sanitizeHuggingFaceModel(model: string): string {
  const trimmed = model.trim();
  // Expected HuggingFace model IDs look like "org/model-name".
  // Allow only safe path characters and reject traversal/URL delimiters.
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    throw new Error('Invalid HuggingFace model identifier');
  }
  if (
    trimmed.length === 0 ||
    trimmed.includes('..') ||
    trimmed.startsWith('/') ||
    trimmed.endsWith('/') ||
    trimmed.includes('\\')
  ) {
    throw new Error('Invalid HuggingFace model identifier');
  }
  return trimmed;
}

export async function fetchWithRetry(
  rawUrl: string,
  options: RequestInit = {},
  timeoutMs: number = 30_000,
  maxRetries: number = 1,
): Promise<Response> {
  const url = sanitizeUrl(rawUrl);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // eslint-disable-next-line no-restricted-syntax -- URL validated against provider allowlist above
      const response = await fetch(url, { ...options, signal: controller.signal }); // lgtm[js/request-forgery]
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
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
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
    defaultModel: 'gpt-5-mini',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini'],
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
    defaultModel: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-haiku-4-5', 'claude-3-5-sonnet-20241022'],
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
    models: ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'groq/compound-mini'],
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
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'mistral-nemo'],
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
    defaultModel: 'command-a-03-2025',
    models: ['command-a-03-2025', 'command-r-plus', 'command-r', 'command-light'],
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
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'meta-llama/Llama-3-70b-chat-hf',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
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
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    models: [
      'meta-llama/llama-3.3-70b-instruct',
      'meta-llama/llama-3.1-8b-instruct',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'google/gemini-2.5-flash',
      'openai/gpt-4o',
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
    apiUrl: 'https://opencode.ai/zen/v1/chat/completions',
    getApiKeyUrl: 'https://opencode.ai',
    docsUrl: 'https://opencode.ai',
    defaultModel: 'gemini-3.5-flash',
    models: ['glm-5.1', 'glm-5', 'kimi-k2.6', 'minimax-m2.7', 'gemini-3.5-flash', 'gemini-3.1-pro'],
    placeholder: 'zen_...',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    description: 'Paid/dedicated OpenCode Go gateway.',
    free: false,
    apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
    getApiKeyUrl: 'https://opencode.ai',
    docsUrl: 'https://opencode.ai',
    defaultModel: 'deepseek-v4-flash',
    models: ['glm-5.1', 'mimo-v2-omni', 'qwen3.7-max', 'deepseek-v4-pro', 'deepseek-v4-flash'],
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
    defaultModel: 'meta/llama3-70b-instruct',
    models: ['meta/llama3-70b-instruct'],
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
    defaultModel: 'default',
    models: ['default'],
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
    defaultModel: 'glm-5.1',
    models: ['glm-5.1', 'glm-4.7', 'GLM-4-Plus'],
    placeholder: 'zai_...',
  },
  {
    id: 'google-gemini-oauth',
    name: 'Google Gemini (OAuth)',
    description: 'Standard Google Gemini API gateway utilizing OAuth access token authentication.',
    free: true,
    apiUrl: 'https://cloudcode-pa.googleapis.com/v1internal:generateContent',
    getApiKeyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
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
    models: ['gemma3:4b', 'gemma3:1b', 'qwen2.5:3b', 'qwen2.5:1.5b', 'llama3.3', 'llama3.1', 'mistral', 'phi3', 'deepseek-coder'],
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
    apiUrl: 'https://opencode.ai/zen/v1/messages',
    getApiKeyUrl: 'https://opencode.ai',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-opus-4-1',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-sonnet-4',
      'claude-haiku-4-5',
    ],
    placeholder: 'zen_...',
  },
  {
    id: 'opencode-go-anthropic',
    name: 'OpenCode Go (Anthropic)',
    description: 'Anthropic-compatible paid gateway for OpenCode Go.',
    free: false,
    apiUrl: 'https://opencode.ai/zen/go/v1/messages',
    getApiKeyUrl: 'https://opencode.ai',
    defaultModel: 'minimax-m2.7',
    models: ['minimax-m2.7', 'minimax-m2.5'],
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
  model: string = 'gemini-2.5-flash',
  options: GenerationOptions = {}
): Promise<string> {
  const safeModel = encodeURIComponent(sanitizeGeminiModel(model));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`;

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
  const safeModel = sanitizeHuggingFaceModel(model);
  const url = `https://api-inference.huggingface.co/models/${safeModel}`;

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

// Anthropic-compatible Inference API
async function anthropicCompatibleGenerate(
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
    throw new Error(error.error?.message || `Anthropic-compatible API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = data.content?.find((b: { type?: string; text?: string }) => b.type === 'text');
  return textBlock?.text || '';
}

// Claude API
async function claudeGenerate(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string = 'claude-sonnet-4-20250514',
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
  
  if (options.temperature !== undefined || options.topP !== undefined || options.maxTokens !== undefined) {
    requestBody.generationConfig = {
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.topP !== undefined && { topP: options.topP }),
      ...(options.maxTokens !== undefined && { maxOutputTokens: options.maxTokens }),
    };
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
      // Validate model path segment to prevent path manipulation in URL construction.
      // Allows common provider model ids like "@cf/meta/llama-3.1-8b-instruct" and "llama-3.1-8b".
      if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(model)) {
        throw new Error('Invalid Cloudflare model format.');
      }
      const encodedModel = encodeURIComponent(model);
      return openAICompatibleGenerate(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodedModel}`,
        apiToken, systemPrompt, fullUserPrompt, model, options
      );
    }

    case 'zai':
      return openAICompatibleGenerate(
        'https://api.z.ai/api/paas/v4/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'opencode-zen':
      return openAICompatibleGenerate(
        'https://opencode.ai/zen/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'opencode-go':
      return openAICompatibleGenerate(
        'https://opencode.ai/zen/go/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'crof':
      return openAICompatibleGenerate(
        'https://crof.ai/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'ocenza':
      return openAICompatibleGenerate(
        'https://global.ocenza.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'mimo':
      return openAICompatibleGenerate(
        'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'nvidia-nim':
      return openAICompatibleGenerate(
        'https://integrate.api.nvidia.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'kilo-gateway':
      return openAICompatibleGenerate(
        'https://api.kilo.ai/api/gateway/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'nous-research':
      return openAICompatibleGenerate(
        'https://inference-api.nousresearch.com/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'perplexity':
      return openAICompatibleGenerate(
        'https://api.perplexity.ai/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'fireworks':
      return openAICompatibleGenerate(
        'https://api.fireworks.ai/inference/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'openadapter':
      return openAICompatibleGenerate(
        'https://api.openadapter.in/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'zai-coding':
      return openAICompatibleGenerate(
        'https://api.z.ai/api/coding/paas/v4/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'codebuff':
      return openAICompatibleGenerate(
        'https://www.codebuff.com/api/v1/chat/completions',
        apiKey, systemPrompt, fullUserPrompt, model, options
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
        apiKey || 'ollama', systemPrompt, fullUserPrompt, model, options
      );

    case 'lm-studio':
      return openAICompatibleGenerate(
        'http://127.0.0.1:1234/v1/chat/completions',
        apiKey || 'lm-studio', systemPrompt, fullUserPrompt, model, options
      );

    case 'vllm':
      return openAICompatibleGenerate(
        'http://localhost:8000/v1/chat/completions',
        apiKey || 'vllm', systemPrompt, fullUserPrompt, model, options
      );

    case 'opencode-zen-anthropic':
      return anthropicCompatibleGenerate(
        'https://opencode.ai/zen/v1/messages',
        apiKey, systemPrompt, fullUserPrompt, model, options
      );

    case 'opencode-go-anthropic':
      return anthropicCompatibleGenerate(
        'https://opencode.ai/zen/go/v1/messages',
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
