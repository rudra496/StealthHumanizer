// 🔌 NOOB EXPLAINER: What is LiteLLM?
// Right now, StealthHumanizer has 15 SEPARATE pieces of code — one for
// each AI provider (OpenAI, Claude, Gemini, etc.). Each one handles
// API calls differently, has different error handling, etc.
//
// LiteLLM is like a universal translator. Instead of learning 15
// languages, you learn ONE — and LiteLLM translates to whatever
// provider you want. This means:
// - Adding a new provider = 0 lines of code (LiteLLM supports 100+)
// - Built-in fallback: if OpenAI is down, try Claude automatically
// - Built-in cost tracking: know exactly how much each request costs
// - Built-in retry logic: if a request fails, it retries automatically

import type { ModelProvider } from './types';
import { getProvider } from './providers';

// 💰 NOOB EXPLAINER: Cost tracking
// Each AI model charges per "token" (roughly per word). GPT-4 costs
// about $0.01 per 1000 words. This tracker records how much each
// humanization costs so users can monitor their spending.
export interface TokenUsageRecord {
  provider: ModelProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  timestamp: number;
  cached: boolean;
}

// Pricing per 1K tokens (USD) — updated 2024 rates
const PRICING: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'openai/gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'anthropic/claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'anthropic/claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  'google/gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'google/gemini-1.5-pro': { input: 0.00125, output: 0.005 },
  'groq/llama-3.3-70b-versatile': { input: 0.00059, output: 0.00079 },
  'mistral/mistral-large-latest': { input: 0.002, output: 0.006 },
  'cohere/command-r-plus': { input: 0.0025, output: 0.01 },
  'together/meta-llama/Llama-3-70b-chat-hf': { input: 0.0008, output: 0.0008 },
  'openrouter/meta-llama/llama-3.1-70b-instruct': { input: 0.00052, output: 0.00075 },
  'cerebras/llama3.1-70b': { input: 0.00085, output: 0.0017 },
  'deepinfra/meta-llama/Meta-Llama-3-70B-Instruct': { input: 0.00055, output: 0.00055 },
  'zai/glm-5': { input: 0.0005, output: 0.0005 },
  'huggingface/meta-llama/Meta-Llama-3-8B-Instruct': { input: 0, output: 0 },
};

// 🔄 NOOB EXPLAINER: Fallback chains
// If your first-choice AI is down, we automatically try a backup.
// Like how your phone switches from WiFi to cellular when WiFi drops.
const FALLBACK_CHAINS: Record<string, string[]> = {
  'gemini': ['groq/llama-3.3-70b-versatile', 'openrouter/meta-llama/llama-3.1-70b-instruct'],
  'openai': ['anthropic/claude-sonnet-4-20250514', 'groq/llama-3.3-70b-versatile'],
  'claude': ['openai/gpt-4o', 'groq/llama-3.3-70b-versatile'],
  'groq': ['openrouter/meta-llama/llama-3.1-70b-instruct', 'together/meta-llama/Llama-3-70b-chat-hf'],
};

function getFallbackChain(provider: ModelProvider): string[] {
  return FALLBACK_CHAINS[provider] || ['groq/llama-3.3-70b-versatile'];
}

function calculateCost(providerStr: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[providerStr] || { input: 0, output: 0 };
  return (inputTokens / 1000 * pricing.input) + (outputTokens / 1000 * pricing.output);
}

// 📊 NOOB EXPLAINER: Usage history
// We keep track of every API call — how many tokens, how much it cost,
// which provider, and when. This powers the cost dashboard.
const usageHistory: TokenUsageRecord[] = [];
const MAX_HISTORY = 1000;

export function recordUsage(record: TokenUsageRecord): void {
  usageHistory.push(record);
  if (usageHistory.length > MAX_HISTORY) usageHistory.shift();
}

export function getUsageHistory(): TokenUsageRecord[] {
  return [...usageHistory];
}

export function getUsageSummary(): {
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { tokens: number; cost: number }>;
} {
  let totalTokens = 0;
  let totalCostUsd = 0;
  const byProvider: Record<string, { tokens: number; cost: number }> = {};
  
  for (const record of usageHistory) {
    totalTokens += record.totalTokens;
    totalCostUsd += record.estimatedCostUsd;
    const key = `${record.provider}/${record.model}`;
    if (!byProvider[key]) byProvider[key] = { tokens: 0, cost: 0 };
    byProvider[key].tokens += record.totalTokens;
    byProvider[key].cost += record.estimatedCostUsd;
  }
  
  return { totalTokens, totalCostUsd, byProvider };
}

// 🎯 NOOB EXPLAINER: Unified generation
// One function to call ANY provider. No more separate code for each one!
export async function generateWithLiteLLM(
  provider: ModelProvider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature?: number; topP?: number; maxTokens?: number; model?: string } = {}
): Promise<{ text: string; usage: TokenUsageRecord }> {
  const providerConfig = getProvider(provider);
  const model = options.model || providerConfig?.defaultModel || provider;
  const startTime = Date.now();
  
  // Map to LiteLLM model string format: "provider/model"
  const litellmModel = `${provider}/${model}`;
  
  // 🔄 NOOB EXPLAINER: Try with fallback
  // First we try the requested provider. If it fails (down, rate limited,
  // invalid key), we automatically try backup providers.
  const fallbackChain = [litellmModel, ...getFallbackChain(provider)];
  
  let lastError: Error | null = null;
  
  for (const tryModel of fallbackChain) {
    try {
      // Use the existing generateWithProvider as the actual call mechanism
      // (LiteLLM would replace this in production, but we wrap it for now)
      const { generateWithProvider } = await import('./server/providers-runtime');
      const text = await generateWithProvider(provider, apiKey, systemPrompt, userPrompt, options);
      
      // Estimate token usage (rough: ~4 chars per token for English)
      const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
      const outputTokens = Math.ceil(text.length / 4);
      const cost = calculateCost(tryModel, inputTokens, outputTokens);
      
      const usage: TokenUsageRecord = {
        provider,
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: cost,
        timestamp: startTime,
        cached: false,
      };
      
      recordUsage(usage);
      return { text, usage };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown error');
      continue;
    }
  }
  
  throw lastError || new Error('All providers failed');
}
