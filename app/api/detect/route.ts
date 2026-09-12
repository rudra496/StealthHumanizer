import { NextRequest, NextResponse } from 'next/server';
import { detectWithGPTZero } from '@/lib/gptzero';
import { detectWithRudra, isRudraDetectorConfigured } from '@/lib/server/rudra-free';
import { checkRateLimit } from '@/lib/rate-limit';
import { detectAI } from '@/lib/detector';

// RoBERTa detection is fast (~70ms typical) but allow margin for cold starts.
export const maxDuration = 30;

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

    const { text } = await request.json();

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
    }

    if (text.length > 50000) {
      return NextResponse.json({ success: false, error: 'Text exceeds 50,000 character limit' }, { status: 400 });
    }

    // Prefer the maintainer's hosted detector (free, no key needed from the
    // user) — calibrated with the structural heuristic. Open RoBERTa
    // detectors saturate ~0.99 on ANY polished text (they flag good casual
    // rewrites at 0.6-0.9 while ZeroGPT scores the same text 0%), so the
    // panel blends the ensemble with the 12-metric structural heuristic
    // (burstiness, AI-phrase density, sentence variety), which tracks
    // commercial detectors far better. Weights: 35% ensemble / 65% heuristic.
    if (isRudraDetectorConfigured()) {
      try {
        const r = await detectWithRudra(text);
        const heuristic = detectAI(text); // score: 0-100 (human %)
        const calibrated = 0.35 * r.aiProbability + 0.65 * (1 - heuristic.score / 100);
        const label = calibrated >= 0.5 ? 'ai' : 'human';
        return NextResponse.json({
          success: true,
          data: {
            score: calibrated,
            aiProbability: calibrated,
            humanProbability: 1 - calibrated,
            verdict: label === 'ai' ? 'generated' : 'human',
            label,
            sentences: [],
            source: 'rudra' as const,
            model: `calibrated(${r.model.split('+')[0]} + structural)`,
            elapsedMs: r.elapsedMs,
          },
        });
      } catch {
        // Fall through to GPTZero/local on upstream errors.
      }
    }

    const result = await detectWithGPTZero(text);
    return NextResponse.json({ success: true, data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: process.env.NODE_ENV === 'development' ? message : 'Internal error' }, { status: 500 });
  }
}
