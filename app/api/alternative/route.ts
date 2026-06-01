import { NextRequest, NextResponse } from 'next/server';
import { generateAlternatives } from '@/lib/server/providers-runtime';
import { isCliOnlyProvider } from '@/lib/providers';
import { getSystemPrompt } from '@/lib/prompts';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 },
      );
    }

    const { original, current, level, style, tone, customTone, model, apiKey } = await request.json();
    if (!original || !model || !apiKey) return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    if (isCliOnlyProvider(model)) return NextResponse.json({ success: false, error: `Provider "${model}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.` }, { status: 400 });

    const systemPrompt = getSystemPrompt(level, style, tone, customTone);
    const alternatives = await generateAlternatives(model, apiKey, original, current, systemPrompt, 3);
    return NextResponse.json({ success: true, alternatives });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
