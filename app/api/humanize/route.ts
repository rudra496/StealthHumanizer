import { NextRequest, NextResponse } from 'next/server';
import { RewriteLevel, StylePreset, ModelProvider } from '@/lib/types';
import { getSystemPrompt, getSelfCheckPrompt, getCorpusAwareSystemPrompt, LEVEL_PARAMS } from '@/lib/prompts';
import { getProvider, isCliOnlyProvider } from '@/lib/providers';
import { generateWithProvider } from '@/lib/server/providers-runtime';
import { detectAI } from '@/lib/detector';
import { postprocess, corpusAwarePostprocess } from '@/lib/postprocess';
import { loadStyleModelAsync, loadStyleModel, hasStyleModel } from '@/lib/style-model';
import { calibrateWithCorpus } from '@/lib/detector';
import { chainModels } from '@/lib/chain';
import {
  appendAuditLog,
  applyRewriteRegressionGuard,
  buildConfidenceReport,
  enforceSafetyPolicy,
} from '@/lib/server/humanization-governance';
import { scoreHumanLikeness } from '@/lib/server/model-runtime';
import { asyncMapConcurrent } from '@/lib/batch';
import { checkRateLimit } from '@/lib/rate-limit';
import { countWords, chunkText } from '@/lib/storage';

const MAX_BATCH_SIZE = 20;

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+[\s]*/g)?.map(s => s.trim()).filter(s => s.length > 0) || [text.trim()];
}

async function llmSelfCheck(
  provider: ModelProvider,
  apiKey: string,
  text: string
): Promise<{ score: number; issues: string[]; flaggedSentences: string[] }> {
  try {
    const prompt = getSelfCheckPrompt().replace('{TEXT}', text.slice(0, 3000));
    const providerInfo = getProvider(provider);
    const result = await generateWithProvider(provider, apiKey, prompt, '', {
      model: providerInfo?.defaultModel,
      temperature: 0.3,
      topP: 0.9,
      maxTokens: 1024,
    });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(100, Math.max(0, Number(parsed.score) || 50)),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        flaggedSentences: Array.isArray(parsed.flaggedSentences) ? parsed.flaggedSentences : [],
      };
    }
  } catch {}
  return { score: 50, issues: [], flaggedSentences: [] };
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 },
      );
    }

    const {
      text, level, style, tone, customTone, model, apiKey,
      targetScore, language, writingSample,
      purpose,
      // New pipeline parameters
      postprocess: enablePostprocess = true,
      chainModels: chainModelIds = [],
      apiKeys: extraApiKeys = {},
      batchTexts = [],
    } = await request.json();

    if (!text || !model || !apiKey) return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    // Reject CLI-only runners on the primary model AND anywhere in the chain —
    // chainModels flows through lib/chain into the CLI-capable runtime, so an
    // unguarded chain entry would otherwise spawn the server's local CLI.
    const cliOnlyRequested = [model, ...(Array.isArray(chainModelIds) ? chainModelIds : [])]
      .find((id) => isCliOnlyProvider(id as ModelProvider));
    if (cliOnlyRequested) return NextResponse.json({ success: false, error: `Provider "${cliOnlyRequested}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.` }, { status: 400 });
    if (countWords(text) > 10000) return NextResponse.json({ success: false, error: 'Exceeds 10,000 word limit' }, { status: 400 });
    if (Array.isArray(batchTexts) && batchTexts.length > MAX_BATCH_SIZE) {
      return NextResponse.json({ success: false, error: `Batch size exceeds limit (${MAX_BATCH_SIZE}).` }, { status: 400 });
    }

    const safety = enforceSafetyPolicy(text);
    if (safety.blocked) {
      return NextResponse.json(
        {
          success: false,
          error: 'Request blocked by safety policy.',
          reasons: safety.reasons,
          safeUseGuidance: safety.safeUseGuidance,
        },
        { status: 400 }
      );
    }

    // Load corpus style model
    await loadStyleModelAsync();
    const useCorpus = hasStyleModel();

    // Calibrate detector with corpus
    if (useCorpus) {
      const styleModel = loadStyleModel();
      if (styleModel) calibrateWithCorpus(styleModel);
    }

    const params = LEVEL_PARAMS[level as RewriteLevel];
    const systemPrompt = useCorpus
      ? getCorpusAwareSystemPrompt(level, style, tone, customTone, writingSample, undefined, language, purpose)
      : getSystemPrompt(level, style, tone, customTone, writingSample, language, purpose);
    const providerInfo = getProvider(model);
    const modelId = providerInfo?.defaultModel || model;

    if (Array.isArray(batchTexts) && batchTexts.length > 0) {
      const selected = batchTexts.slice(0, MAX_BATCH_SIZE).filter((item: unknown) => typeof item === 'string' && item.trim().length > 0);
      // Use concurrency-limited batch processing
      const batchResults = await asyncMapConcurrent(
        selected,
        async (batchInput: string, i: number) => {
          const chunks = chunkText(batchInput, 2500);
          let rewritten = '';
          for (let j = 0; j < chunks.length; j++) {
            const out = await generateWithProvider(model, apiKey, systemPrompt, chunks[j], {
              model: modelId,
              temperature: params.temperature,
              topP: params.topP,
            });
            rewritten += (j > 0 ? '\n\n' : '') + out;
          }
          const final = enablePostprocess ? postprocess(rewritten, { light: true, style: style as any }) : rewritten;
          const detection = detectAI(final);
          const confidenceReport = buildConfidenceReport(detection.score);
          const runtimeModelScore = await scoreHumanLikeness(final);
          return { index: i, fullText: final, finalScore: detection.score, confidenceReport, runtimeModelScore };
        },
        3,
      );

      await appendAuditLog({
        timestamp: new Date().toISOString(),
        route: '/api/humanize',
        model,
        mode: 'batch',
        batchCount: batchResults.length,
      });

      return NextResponse.json({
        success: true, mode: 'batch',
        count: batchResults.length,
        results: batchResults,
        model,
        modelName: providerInfo?.name || model,
      });
    }

    const maxPasses = level === 'ninja' ? 3 : level === 'aggressive' ? 2 : level === 'medium' ? 2 : 1;
    const target = targetScore || 80;
    const chunks = chunkText(text, 2500);

    // Language note for non-English/non-Chinese text (Chinese is handled by getSystemPrompt)
    let langNote = '';
    if (language && language !== 'en' && language !== 'auto' && language !== 'zh-CN' && language !== 'zh-TW') {
      langNote = '\n\nIMPORTANT: The text is in a language other than English. Rewrite it in the SAME language. Do NOT translate.';
    }

    // ==================== LAYER 1: LLM Rewrite ====================
    let humanizedText = '';
    for (let i = 0; i < chunks.length; i++) {
      const chunkPrompt = chunks[i] + langNote;
      const result = await generateWithProvider(model, apiKey, systemPrompt, chunkPrompt, {
        model: modelId,
        temperature: params.temperature,
        topP: params.topP,
      });
      humanizedText += (i > 0 ? '\n\n' : '') + result;
    }

    let passes = 1;
    let currentText = humanizedText;

    // ==================== LAYER 2: Post-Processing ====================
    // Always apply corpus-aware post-processing if model is loaded
    if (useCorpus) {
      currentText = corpusAwarePostprocess(currentText);
    }
    // Also apply regular post-processing if toggled on
    if (enablePostprocess) {
      currentText = postprocess(currentText, { style: style as any });
    }

    // ==================== LAYER 3: Multi-Model Chain ====================
    if (chainModelIds && chainModelIds.length > 0) {
      // Build chain config from provided model IDs and API keys
      const allApiKeys = { ...extraApiKeys, [model]: apiKey };
      const chainConfig = chainModelIds
        .filter((id: string) => allApiKeys[id])
        .map((id: string) => ({
          provider: id as ModelProvider,
          apiKey: allApiKeys[id],
        }));

      if (chainConfig.length > 0) {
        const chainResult = await chainModels({
          text: currentText,
          chainModels: chainConfig,
          level: level as RewriteLevel,
          style: style as StylePreset,
          tone,
          customTone,
        });
        currentText = chainResult.text;
        passes += chainResult.passes.length;
      }
    }

    // ==================== LAYER 4: Final Polish ====================
    if (enablePostprocess) {
      // Light post-process pass after chain
      currentText = postprocess(currentText, { light: true });
    }

    // NOTE: Self-check loop disabled — multi-pass LLM self-checking adds more AI fingerprints
    // with each pass, making text MORE detectable, not less. Single-pass rewrite is more effective.
    // The code below is preserved but skipped.
    /*
    if (chainModelIds.length === 0) {
      for (let pass = 2; pass <= maxPasses; pass++) {
        const check = await llmSelfCheck(model, apiKey, currentText);
        if (check.score >= target) break;

        const allIssues = [...check.issues, ...check.flaggedSentences];
        if (allIssues.length === 0) break;

        try {
          const fixPrompt = getFixPrompt(allIssues);
          const fullFixPrompt = `${fixPrompt}\n\nORIGINAL TEXT TO FIX (rewrite the entire text with these fixes applied):\n\n${currentText}`;
          const result = await generateWithProvider(model, apiKey, fixPrompt, currentText, {
            model: modelId,
            temperature: params.temperature,
            topP: params.topP,
          });
          currentText = result;
          passes = pass;

          // Apply light post-processing after each self-check fix
          if (enablePostprocess) {
            currentText = postprocess(currentText, { light: true, style: style as any });
          }
        } catch { break; }
      }
    }
    */

    const guard = applyRewriteRegressionGuard({
      originalText: text,
      candidateText: currentText,
      fallbackText: humanizedText,
    });
    const finalText = guard.text;
    const finalDetection = detectAI(finalText);
    const confidenceReport = buildConfidenceReport(finalDetection.score);
    const runtimeModelScore = await scoreHumanLikeness(finalText);
    const origSentences = splitSentences(text);
    const humanizedSentences = splitSentences(finalText);
    const maxLen = Math.max(origSentences.length, humanizedSentences.length);

    const sentences = [];
    for (let i = 0; i < maxLen; i++) {
      sentences.push({
        original: origSentences[i] || '',
        humanized: humanizedSentences[i] || '',
        alternatives: [],
        index: i,
        detectionScore: finalDetection.sentences[i]?.score,
      });
    }

    const responsePayload = {
      sentences, fullText: finalText, model, modelName: providerInfo?.name || model,
      wordCount: { input: countWords(text), output: countWords(finalText) },
      timestamp: Date.now(), passes, finalScore: finalDetection.score,
      options: { level, style, tone, language, purpose },
      confidenceReport,
      runtimeModelScore,
      fallbackBehavior: {
        used: guard.usedFallback,
        reason: guard.reason,
      },
      provenanceDisclosure: {
        source: 'user-provided-input',
        policyVersion: 'pr7-safety-governance-v1',
        modelSelection: runtimeModelScore.modelSource,
      },
    };

    await appendAuditLog({
      timestamp: new Date().toISOString(),
      route: '/api/humanize',
      model,
      passes,
      inputWords: countWords(text),
      outputWords: countWords(finalText),
      finalScore: finalDetection.score,
      confidence: confidenceReport.confidence,
      fallbackUsed: guard.usedFallback,
      runtimeModelSource: runtimeModelScore.modelSource,
      batchCount: Array.isArray(batchTexts) ? batchTexts.length : 0,
    });

    return NextResponse.json({ success: true, ...responsePayload });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Internal error' }, { status: 500 });
  }
}
