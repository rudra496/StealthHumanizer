import { NextRequest, NextResponse } from 'next/server';
import { getProvider, isCliOnlyProvider } from '@/lib/providers';
import { generateWithProvider } from '@/lib/server/providers-runtime';
import { GRAMMAR_CHECK_SYSTEM_PROMPT } from '@/lib/prompts';
import { checkGrammarLocally, normalizeGrammarPayload, parseFirstJsonObject } from '@/lib/grammar';
import { grammarCheckWithRudra, isRudraHumanizerConfigured } from '@/lib/server/rudra-free';
import { ModelProvider } from '@/lib/types';
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

    const { text, model, apiKey } = await request.json();
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
    }
    if (text.length > 50000) {
      return NextResponse.json({ success: false, error: 'Text exceeds 50,000 character limit' }, { status: 400 });
    }

    if (!model || (!apiKey && model !== 'rudra-free')) {
      const local = checkGrammarLocally(text);
      return NextResponse.json({ success: true, ...local, warning: 'No model/API key supplied; used the local grammar fallback.' });
    }

    if (isCliOnlyProvider(model as ModelProvider)) {
      return NextResponse.json({ success: false, error: `Provider "${model}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.` }, { status: 400 });
    }

    // Rudra's Free Usage Model: run the hosted gemma grammar fixer on the VPS
    // (no provider API key needed), falling back to the local checker.
    if (model === 'rudra-free') {
      if (!isRudraHumanizerConfigured()) {
        const local = checkGrammarLocally(text);
        return NextResponse.json({ success: true, ...local, warning: 'Rudra Free model is not configured on the server; used the local grammar fallback.' });
      }
      try {
        const rudra = await grammarCheckWithRudra(text);
        const parsed = normalizeGrammarPayload(null, rudra.corrected, 'llm');
        // The LLM returns the full corrected text, not an issue list — present
        // it as a single phrasing fix so the UI has something to show.
        const correctedText = parsed?.correctedText || rudra.corrected;
        const issues = correctedText.trim() !== text.trim()
          ? [{ type: 'phrasing' as const, original: text.slice(0, 120), suggestion: correctedText.slice(0, 120) + (correctedText.length > 120 ? '…' : ''), explanation: `Grammar-corrected by ${rudra.model}.` }]
          : [];
        return NextResponse.json({ success: true, issues, correctedText, source: 'llm' });
      } catch (err: unknown) {
        const local = checkGrammarLocally(text);
        return NextResponse.json({
          success: true,
          ...local,
          warning: err instanceof Error ? `Rudra grammar check failed; used local fallback. ${err.message}` : 'Rudra grammar check failed; used local fallback.',
        });
      }
    }

    try {
      const providerInfo = getProvider(model as ModelProvider);
      const modelId = providerInfo?.defaultModel || model;
      const result = await generateWithProvider(
        model as ModelProvider,
        apiKey,
        GRAMMAR_CHECK_SYSTEM_PROMPT,
        text,
        { temperature: 0.1, maxTokens: 2048, model: modelId }
      );

      const parsed = normalizeGrammarPayload(parseFirstJsonObject(result), text, 'llm');
      if (parsed) return NextResponse.json({ success: true, ...parsed });
    } catch (err: unknown) {
      const local = checkGrammarLocally(text);
      return NextResponse.json({
        success: true,
        ...local,
        warning: err instanceof Error ? `LLM grammar check failed; used local fallback. ${err.message}` : 'LLM grammar check failed; used local fallback.',
      });
    }

    const local = checkGrammarLocally(text);
    return NextResponse.json({ success: true, ...local, warning: 'Could not parse LLM grammar JSON; used local fallback.' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: process.env.NODE_ENV === 'development' ? message : 'Internal error' }, { status: 500 });
  }
}
