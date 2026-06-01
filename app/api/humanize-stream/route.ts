// 🌊 NOOB EXPLAINER: What is "Streaming"?
// Normally when you ask an AI to write something, you wait... and wait...
// and then the ENTIRE response appears at once. That's like ordering food
// and getting everything served at the same time — you stare at an empty
// table for 30 minutes.
//
// "Streaming" means the AI sends you text AS IT WRITES IT, one token at a
// time. It's like a chef putting each dish on the table as soon as it's
// ready — you start eating immediately while the rest cooks.
//
// Benefits:
// - Users see text appearing in real-time (feels MUCH faster)
// - Users can read the beginning while the end is still generating
// - Users can CANCEL if they don't like how it's going
// - No more timeout errors for long texts

import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { getSystemPrompt, getCorpusAwareSystemPrompt, LEVEL_PARAMS } from '@/lib/prompts';
import { extractRegions } from '@/lib/protect-regions';
import { hasStyleModel } from '@/lib/style-model';
import type { HumanizationOptions } from '@/lib/types';

// 🔌 NOOB EXPLAINER: What are AI SDK providers?
// Each AI company (OpenAI, Google, Anthropic) has their own API format.
// The Vercel AI SDK gives us a UNIFIED interface — one way to call
// all of them. No more writing separate code for each provider!
function getModel(provider: string, apiKey: string, model?: string) {
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(model || 'gpt-4o');
    case 'claude':
      return createAnthropic({ apiKey })(model || 'claude-sonnet-4-20250514');
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(model || 'gemini-1.5-flash');
    case 'groq':
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.groq.com/openai/v1',
      })(model || 'llama-3.3-70b-versatile');
    case 'openrouter':
      return createOpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
      })(model || 'meta-llama/llama-3.1-70b-instruct');
    case 'together':
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.together.xyz/v1',
      })(model || 'meta-llama/Llama-3-70b-chat-hf');
    case 'cerebras':
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.cerebras.ai/v1',
      })(model || 'llama3.1-70b');
    case 'deepinfra':
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.deepinfra.com/v1/openai',
      })(model || 'meta-llama/Meta-Llama-3-70B-Instruct');
    case 'mistral':
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.mistral.ai/v1',
      })(model || 'mistral-large-latest');
    case 'zai':
      return createOpenAI({
        apiKey,
        baseURL: 'https://api.z.ai/api/paas/v4',
      })(model || 'glm-5');
    default:
      // Fallback to OpenAI-compatible format for unknown providers
      return createOpenAI({ apiKey })(model || provider);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, options, apiKey } = body as {
      text: string;
      options: HumanizationOptions;
      apiKey: string;
    };

    if (!text || !apiKey) {
      return Response.json({ error: 'Missing text or API key' }, { status: 400 });
    }

    // 🛡️ NOOB EXPLAINER: Region Protection
    // Before humanizing, we extract code blocks, URLs, and other
    // "non-text" things and replace them with placeholders.
    // This way the AI doesn't accidentally rewrite your code or URLs!
    const { masked } = extractRegions(text);

    // 📝 NOOB EXPLAINER: System Prompt
    // The "system prompt" is like giving the AI its job description.
    // It tells the AI HOW to write, not WHAT to write.
    const systemPrompt = hasStyleModel()
      ? getCorpusAwareSystemPrompt(
          options.level, options.style, options.tone,
          options.customTone, undefined, options.domain, options.language
        )
      : getSystemPrompt(
          options.level, options.style, options.tone,
          options.customTone, undefined, options.language
        );

    const levelParams = LEVEL_PARAMS[options.level] || LEVEL_PARAMS.medium;
    const model = getModel(options.model, apiKey, options.model);

    // 🌊 NOOB EXPLAINER: streamText() vs regular completion
    // Regular: AI writes everything → sends all at once → you wait
    // Streaming: AI writes → sends each token immediately → you see it live
    const result = streamText({
      model,
      system: systemPrompt,
      prompt: `Text to humanize:\n\n${masked}`,
      temperature: levelParams.temperature,
      topP: levelParams.topP,
      maxTokens: 4096,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error('Streaming humanization error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Streaming failed' },
      { status: 500 }
    );
  }
}
