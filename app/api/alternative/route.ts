import { NextRequest, NextResponse } from 'next/server';
import { generateAlternatives } from '@/lib/server/providers-runtime';
import { isCliOnlyProvider } from '@/lib/providers';
import { getSystemPrompt } from '@/lib/prompts';
import { handleApiError } from '@/lib/api-response';
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

    // Body size guard
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 2_000_000) {
      return NextResponse.json({ success: false, error: 'Request body too large.' }, { status: 413 });
    }

    const { original, current, style, model, apiKey } = await request.json();
    if (!original || !model || !apiKey) return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    if (isCliOnlyProvider(model)) return NextResponse.json({ success: false, error: `Provider "${model}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.` }, { status: 400 });

    const systemPrompt = getSystemPrompt(style);
    const alternatives = await generateAlternatives(model, apiKey, original, current, systemPrompt, 3);
    return NextResponse.json({ success: true, alternatives });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    const isActionable = /timeout|timed out|unreachable|502|503|504|400|401|403|404|429|API error|quota|rate limit|unauthorized|forbidden|invalid api key/i.test(message);
    return NextResponse.json({ success: false, error: isActionable ? message : 'Internal error' }, { status: 500 });
  }
}
