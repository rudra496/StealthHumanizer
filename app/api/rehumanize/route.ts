import { NextRequest, NextResponse } from 'next/server';
import { RewriteLevel, StylePreset, TonePreset, ModelProvider } from '@/lib/types';
import { getRehumanizePrompt } from '@/lib/prompts';
import { generateWithProvider, getProvider } from '@/lib/providers';
import { postprocess } from '@/lib/postprocess';

export async function POST(request: NextRequest) {
  try {
    const { flaggedSentences, level, style, tone, customTone, model, apiKey, fullText, purpose } = await request.json();
    if (!flaggedSentences?.length || !model || !apiKey) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const providerInfo = getProvider(model);
    const modelId = providerInfo?.defaultModel || model;

    const rehumanizePrompt = getRehumanizePrompt(flaggedSentences, level || 'aggressive', style || 'humanize', tone || 'conversational', customTone, purpose);
    
    const result = await generateWithProvider(model, apiKey, rehumanizePrompt, '', { model: modelId, temperature: 0.7, topP: 0.9 });
    const rehumanized = result
      .split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.length > 10);

    // Replace flagged sentences in full text
    if (fullText) {
      let newText = fullText;
      let replacementIdx = 0;
      for (const flagged of flaggedSentences) {
        if (replacementIdx < rehumanized.length) {
          newText = newText.replace(flagged, rehumanized[replacementIdx]);
          replacementIdx++;
        }
      }
      const processedText = postprocess(newText, { style: (style || 'humanize') as any, light: true });
      return NextResponse.json({ success: true, rehumanizedSentences: rehumanized, fullText: processedText });
    }

    return NextResponse.json({ success: true, rehumanizedSentences: rehumanized, fullText: postprocess(rehumanized.join(' '), { style: (style || 'humanize') as any }) });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Internal error' }, { status: 500 });
  }
}
