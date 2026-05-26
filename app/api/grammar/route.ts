import { NextRequest, NextResponse } from 'next/server';
import { getProvider, isCliOnlyProvider } from '@/lib/providers';
import { generateWithProvider } from '@/lib/server/providers-runtime';
import { GRAMMAR_CHECK_SYSTEM_PROMPT } from '@/lib/prompts';

export async function POST(request: NextRequest) {
  try {
    const { text, model, apiKey } = await request.json();
    if (!text || !model || !apiKey) return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    if (isCliOnlyProvider(model)) return NextResponse.json({ success: false, error: `Provider "${model}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.` }, { status: 400 });

    const providerInfo = getProvider(model);
    const modelId = providerInfo?.defaultModel || model;

    const result = await generateWithProvider(
      model, apiKey,
      GRAMMAR_CHECK_SYSTEM_PROMPT,
      text,
      { temperature: 0.2, maxTokens: 2048, model: modelId }
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return NextResponse.json({ success: true,
        issues: parsed.issues || [],
        correctedText: parsed.correctedText || text,
      });
    }

    return NextResponse.json({ success: false, error: 'Failed to parse grammar check results' }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Internal error' }, { status: 500 });
  }
}
