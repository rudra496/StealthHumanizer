import { NextRequest, NextResponse } from 'next/server';
import { getRehumanizePrompt } from '@/lib/prompts';
import { getProvider, isCliOnlyProvider } from '@/lib/providers';
import { generateWithProvider } from '@/lib/server/providers-runtime';
import { postprocess } from '@/lib/postprocess';
import { detectAI } from '@/lib/detector';
import { ModelProvider, StylePreset } from '@/lib/types';
import { chooseImprovedRewrite, parseRehumanizedLines, replaceSentencesInText } from '@/lib/rehumanize';

export async function POST(request: NextRequest) {
  try {
    const { flaggedSentences, level, style, tone, customTone, model, apiKey, fullText, purpose } = await request.json();
    if (!Array.isArray(flaggedSentences) || flaggedSentences.length === 0) {
      return NextResponse.json({ success: false, error: 'flaggedSentences is required' }, { status: 400 });
    }
    if (!model || !apiKey) {
      return NextResponse.json({ success: false, error: 'model and apiKey are required for re-humanization' }, { status: 400 });
    }
    if (isCliOnlyProvider(model as ModelProvider)) {
      return NextResponse.json({ success: false, error: `Provider "${model}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.` }, { status: 400 });
    }

    const cleanFlagged = flaggedSentences
      .filter((sentence): sentence is string => typeof sentence === 'string')
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 0)
      .slice(0, 30);

    if (cleanFlagged.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid flagged sentences supplied' }, { status: 400 });
    }

    const providerInfo = getProvider(model as ModelProvider);
    const modelId = providerInfo?.defaultModel || model;
    const beforeDetection = detectAI(fullText || cleanFlagged.join(' '));
    let rawRewrites: string[] = [];
    let usedFallback = false;

    try {
      const rehumanizePrompt = getRehumanizePrompt(cleanFlagged, level || 'ninja', style || 'humanize', tone || 'conversational', customTone, purpose);
      const contextPrompt = fullText
        ? `${rehumanizePrompt}\n\nFULL TEXT CONTEXT (do not rewrite all of this; only rewrite the numbered flagged sentences above):\n"""\n${String(fullText).slice(0, 6000)}\n"""`
        : rehumanizePrompt;
      const result = await generateWithProvider(model as ModelProvider, apiKey, contextPrompt, '', {
        model: modelId,
        temperature: 0.95,
        topP: 0.95,
        maxTokens: Math.min(4096, Math.max(1024, cleanFlagged.join(' ').length * 2)),
      });
      rawRewrites = parseRehumanizedLines(result);
    } catch {
      usedFallback = true;
    }

    const replacements = cleanFlagged.map((original, index) => ({
      original,
      replacement: chooseImprovedRewrite(original, rawRewrites[index], index),
    }));
    usedFallback = usedFallback || replacements.some((item, index) => item.replacement !== rawRewrites[index]);

    // Only replace the flagged spans. Do not post-process the whole document here,
    // because that can rewrite unflagged text and make the score regress.
    const joined = replacements.map(item => item.replacement).join(' ');
    let finalText = fullText ? replaceSentencesInText(fullText, replacements) : postprocess(joined, { style: (style || 'humanize') as StylePreset, light: true });
    let afterDetection = detectAI(finalText);
    let acceptedReplacements = replacements;
    let skippedDueToRegression = false;

    if (fullText && afterDetection.score < beforeDetection.score) {
      const nonRegressing = replacements.filter(({ original, replacement }) => {
        const originalSentenceScore = detectAI(original).sentences[0]?.score ?? detectAI(original).score;
        const replacementSentenceScore = detectAI(replacement).sentences[0]?.score ?? detectAI(replacement).score;
        return replacementSentenceScore >= originalSentenceScore;
      });
      const candidateText = nonRegressing.length > 0 ? replaceSentencesInText(fullText, nonRegressing) : fullText;
      const candidateDetection = detectAI(candidateText);

      if (candidateDetection.score >= beforeDetection.score) {
        finalText = candidateText;
        afterDetection = candidateDetection;
        acceptedReplacements = nonRegressing;
      } else {
        finalText = fullText;
        afterDetection = beforeDetection;
        acceptedReplacements = [];
        skippedDueToRegression = true;
      }
    }

    return NextResponse.json({
      success: true,
      rehumanizedSentences: acceptedReplacements.map(item => item.replacement),
      replacements: acceptedReplacements,
      fullText: finalText,
      scoreBefore: beforeDetection.score,
      scoreAfter: afterDetection.score,
      improved: afterDetection.score > beforeDetection.score,
      fallbackUsed: usedFallback,
      changedOnlyFlaggedSpans: Boolean(fullText),
      skippedDueToRegression,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
