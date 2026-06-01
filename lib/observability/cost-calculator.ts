// 💰 NOOB EXPLAINER: Cost Calculator
// AI models charge per "token" (roughly per word). Different models
// have different prices. This calculator estimates how much each
// humanization costs based on the number of tokens and the model used.
//
// Example costs (approximate, as of 2024):
// - GPT-4: $0.03 per 1K input tokens, $0.06 per 1K output tokens
// - GPT-3.5: $0.0005 per 1K input tokens, $0.0015 per 1K output tokens
// - Claude 3.5: $0.003 per 1K input tokens, $0.015 per 1K output tokens
// - Gemini Pro: $0.00025 per 1K input tokens, $0.0005 per 1K output tokens

import type { TraceEntry, CostRecord } from './types';

// 📊 NOOB EXPLAINER: Pricing table
// These are the per-1K-token prices for each model.
// We update these as providers change their pricing.
const PRICING: Record<string, { inputPer1K: number; outputPer1K: number }> = {
  'gpt-4': { inputPer1K: 0.03, outputPer1K: 0.06 },
  'gpt-4-turbo': { inputPer1K: 0.01, outputPer1K: 0.03 },
  'gpt-4o': { inputPer1K: 0.005, outputPer1K: 0.015 },
  'gpt-4o-mini': { inputPer1K: 0.00015, outputPer1K: 0.0006 },
  'gpt-3.5-turbo': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
  'claude-3-opus': { inputPer1K: 0.015, outputPer1K: 0.075 },
  'claude-3-sonnet': { inputPer1K: 0.003, outputPer1K: 0.015 },
  'claude-3-haiku': { inputPer1K: 0.00025, outputPer1K: 0.00125 },
  'claude-3.5-sonnet': { inputPer1K: 0.003, outputPer1K: 0.015 },
  'gemini-pro': { inputPer1K: 0.00025, outputPer1K: 0.0005 },
  'gemini-1.5-pro': { inputPer1K: 0.00125, outputPer1K: 0.005 },
  'gemini-1.5-flash': { inputPer1K: 0.000075, outputPer1K: 0.0003 },
  'llama-3.3-70b': { inputPer1K: 0.00059, outputPer1K: 0.00079 },
  'mixtral-8x7b': { inputPer1K: 0.00024, outputPer1K: 0.00024 },
  'cohere-command-r': { inputPer1K: 0.0005, outputPer1K: 0.0015 },
  'cohere-command-r-plus': { inputPer1K: 0.003, outputPer1K: 0.015 },
};

// 🏷️ NOOB EXPLAINER: Default pricing
// If we don't know the exact price for a model, we use a default.
// This is intentionally a bit high to avoid underestimating costs.
const DEFAULT_PRICING = { inputPer1K: 0.003, outputPer1K: 0.01 };

export class CostCalculator {
  // 💵 NOOB EXPLAINER: Estimate the cost of one request
  // Takes the provider/model name and token counts, returns the
  // estimated cost in USD.
  estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.getPricing(provider, model);
    const inputCost = (inputTokens / 1000) * pricing.inputPer1K;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1K;
    return inputCost + outputCost;
  }

  // 📊 NOOB EXPLAINER: Summarize costs
  // Groups traces by date and provider, showing total cost per group.
  // This is used for the cost chart in the dashboard.
  summarize(traces: TraceEntry[]): CostRecord[] {
    const groups: Record<string, CostRecord> = {};

    for (const trace of traces) {
      const date = new Date(trace.timestamp).toISOString().slice(0, 10);
      const key = `${date}-${trace.provider}-${trace.model}`;

      if (!groups[key]) {
        groups[key] = {
          date,
          provider: trace.provider,
          model: trace.model,
          totalTokens: 0,
          totalCostUsd: 0,
          requestCount: 0,
        };
      }

      groups[key].totalTokens += trace.inputTokens + trace.outputTokens;
      groups[key].totalCostUsd += trace.estimatedCostUsd;
      groups[key].requestCount += 1;
    }

    return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  }

  // 🔍 NOOB EXPLAINER: Look up pricing
  // Tries to find the pricing for a specific model. Falls back to
  // the provider-level pricing, then to the default.
  private getPricing(provider: string, model: string): { inputPer1K: number; outputPer1K: number } {
    // Try exact model match first
    if (PRICING[model]) return PRICING[model];

    // Try provider-based match
    const providerLower = provider.toLowerCase();
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (key.startsWith(providerLower)) return pricing;
    }

    // Try partial model match
    const modelLower = model.toLowerCase();
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (modelLower.includes(key) || key.includes(modelLower)) return pricing;
    }

    return DEFAULT_PRICING;
  }
}
