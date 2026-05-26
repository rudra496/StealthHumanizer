// StealthHumanizer - Multi-Model Chaining (Layer 3)
// Chain rewrites through different LLM models to mix statistical fingerprints.

import { ModelProvider } from './types';
import { getProvider } from './providers';
import { generateWithProvider } from './server/providers-runtime';
import { getSystemPrompt } from './prompts';
import { postprocess } from './postprocess';

interface ChainOptions {
  text: string;
  chainModels: { provider: ModelProvider; apiKey: string }[];
  level: 'light' | 'medium' | 'aggressive' | 'ninja';
  style: 'humanize' | 'academic' | 'casual' | 'professional' | 'creative' | 'technical';
  tone: string;
  customTone?: string;
  onProgress?: (step: string, model: string) => void;
}

interface ChainResult {
  text: string;
  passes: { provider: ModelProvider; modelName: string }[];
}

/**
 * Chain rewrites through multiple LLM models.
 * Each model adds its own statistical fingerprint, making detection much harder.
 */
export async function chainModels(options: ChainOptions): Promise<ChainResult> {
  const { text, chainModels, level, style, tone, customTone, onProgress } = options;
  
  let currentText = text;
  const passes: { provider: ModelProvider; modelName: string }[] = [];

  for (let i = 0; i < chainModels.length; i++) {
    const { provider, apiKey } = chainModels[i];
    const providerInfo = getProvider(provider);
    if (!providerInfo) continue;

    const modelName = providerInfo.name;
    const model = providerInfo.defaultModel;

    onProgress?.(`Step ${i + 1}: Chain through ${modelName}`, modelName);

    // Build a progressively lighter prompt for each chain pass
    // First pass: full rewrite. Later passes: lighter touch to avoid destroying content.
    const chainLevel = i === 0 ? level : 'medium';
    const systemPrompt = getSystemPrompt(chainLevel, style, tone as any, customTone);

    try {
      const result = await generateWithProvider(
        provider,
        apiKey,
        systemPrompt,
        currentText,
        {
          model,
          temperature: 0.85 + (i * 0.05), // Slightly increasing temperature
          topP: 0.92 + (i * 0.02),
        }
      );

      currentText = result;
      passes.push({ provider, modelName });

      // Apply post-processing between chain passes (light version)
      if (i < chainModels.length - 1) {
        currentText = postprocess(currentText, { light: true });
      }
    } catch (err: any) {
      // If one model fails, skip it and continue with others
      console.warn(`Chain pass ${i + 1} (${modelName}) failed: ${err.message}`);
    }
  }

  return { text: currentText, passes };
}
