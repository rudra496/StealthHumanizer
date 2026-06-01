import { NextRequest } from 'next/server';
import { RewriteLevel, StylePreset, ModelProvider, TonePreset, TextPurpose } from '@/lib/types';
import { getSystemPrompt, getCorpusAwareSystemPrompt, LEVEL_PARAMS } from '@/lib/prompts';
import { getProvider, isCliOnlyProvider } from '@/lib/providers';
import { generateWithProvider } from '@/lib/server/providers-runtime';
import { detectAI, calibrateWithCorpus } from '@/lib/detector';
import { postprocess, corpusAwarePostprocess } from '@/lib/postprocess';
import { loadStyleModelAsync, loadStyleModel, hasStyleModel } from '@/lib/style-model';
import { checkRateLimit } from '@/lib/rate-limit';
import { countWords, chunkText } from '@/lib/storage';
import { splitIntoSentences } from '@/lib/text-utils';
import { chainModels } from '@/lib/chain';
import { assessSemanticFidelity } from '@/lib/semantic-fidelity';
import { estimateRunCost } from '@/lib/observability';
import { scoreHumanLikeness } from '@/lib/server/model-runtime';
import {
  appendAuditLog,
  applyRewriteRegressionGuard,
  buildConfidenceReport,
  enforceSafetyPolicy,
} from '@/lib/server/humanization-governance';

const encoder = new TextEncoder();

type StreamEvent = 'progress' | 'chunk' | 'result' | 'error' | 'done';

function event(name: StreamEvent, data: unknown): Uint8Array {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function emit(controller: ReadableStreamDefaultController<Uint8Array>, name: StreamEvent, data: unknown): void {
  controller.enqueue(event(name, data));
}

function buildSentenceResults(originalText: string, finalText: string, finalDetection: ReturnType<typeof detectAI>) {
  const originalSentences = splitIntoSentences(originalText);
  const humanizedSentences = splitIntoSentences(finalText);
  const maxLen = Math.max(originalSentences.length, humanizedSentences.length);
  return Array.from({ length: maxLen }, (_, index) => ({
    original: originalSentences[index] || '',
    humanized: humanizedSentences[index] || '',
    alternatives: [],
    index,
    detectionScore: finalDetection.sentences[index]?.score,
  }));
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const body = await request.json().catch(() => null);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        emit(controller, 'progress', { step: 'accepted', message: 'Request accepted' });
        if (!body || typeof body !== 'object') {
          emit(controller, 'error', { error: 'Invalid JSON body.' });
          return;
        }

        const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
        const rateLimit = checkRateLimit(ip);
        if (!rateLimit.allowed) {
          emit(controller, 'error', { error: 'Rate limit exceeded. Please try again later.', status: 429 });
          return;
        }

        const {
          text,
          level = 'medium',
          style = 'humanize',
          tone = 'conversational',
          customTone,
          model,
          apiKey,
          language = 'auto',
          writingSample,
          purpose,
          postprocess: enablePostprocess = true,
          chainModels: chainModelIds = [],
          apiKeys: extraApiKeys = {},
        } = body as Record<string, unknown>;

        if (typeof text !== 'string' || !text.trim() || typeof model !== 'string' || typeof apiKey !== 'string' || !apiKey.trim()) {
          emit(controller, 'error', { error: 'Missing required fields: text, model, apiKey.', status: 400 });
          return;
        }
        const chainIds = Array.isArray(chainModelIds) ? chainModelIds.filter((id): id is string => typeof id === 'string') : [];
        const cliOnlyRequested = [model, ...chainIds].find((id) => isCliOnlyProvider(id as ModelProvider));
        if (cliOnlyRequested) {
          emit(controller, 'error', { error: `Provider "${cliOnlyRequested}" is a local CLI runner and is not available over the web API. Use the stealthhumanizer CLI.`, status: 400 });
          return;
        }
        if (countWords(text) > 10000) {
          emit(controller, 'error', { error: 'Exceeds 10,000 word limit.', status: 400 });
          return;
        }
        const safety = enforceSafetyPolicy(text);
        if (safety.blocked) {
          emit(controller, 'error', { error: 'Request blocked by safety policy.', reasons: safety.reasons, safeUseGuidance: safety.safeUseGuidance, status: 400 });
          return;
        }

        emit(controller, 'progress', { step: 'style-model', message: 'Loading corpus calibration' });
        await loadStyleModelAsync();
        const useCorpus = hasStyleModel();
        if (useCorpus) {
          const styleModel = loadStyleModel();
          if (styleModel) calibrateWithCorpus(styleModel);
        }

        const rewriteLevel = level as RewriteLevel;
        const stylePreset = style as StylePreset;
        const tonePreset = tone as TonePreset;
        const textPurpose = purpose as TextPurpose | undefined;
        const params = LEVEL_PARAMS[rewriteLevel] ?? LEVEL_PARAMS.medium;
        const systemPrompt = useCorpus
          ? getCorpusAwareSystemPrompt(rewriteLevel, stylePreset, tonePreset, customTone as string | undefined, writingSample as string | undefined, undefined, language as string, textPurpose)
          : getSystemPrompt(rewriteLevel, stylePreset, tonePreset, customTone as string | undefined, writingSample as string | undefined, language as string, textPurpose);
        const providerInfo = getProvider(model as ModelProvider);
        const modelId = providerInfo?.defaultModel || model;

        let currentText = '';
        const chunks = chunkText(text, 2500);
        for (let index = 0; index < chunks.length; index++) {
          emit(controller, 'progress', { step: 'rewrite', chunk: index + 1, totalChunks: chunks.length, message: `Rewriting chunk ${index + 1}/${chunks.length}` });
          const chunkPrompt = chunks[index] + ((language && language !== 'en' && language !== 'auto' && language !== 'zh-CN' && language !== 'zh-TW')
            ? '\n\nIMPORTANT: The text is in a language other than English. Rewrite it in the SAME language. Do NOT translate.'
            : '');
          const rewrittenChunk = await generateWithProvider(model as ModelProvider, apiKey, systemPrompt, chunkPrompt, {
            model: modelId,
            temperature: params.temperature,
            topP: params.topP,
          });
          currentText += (index > 0 ? '\n\n' : '') + rewrittenChunk;
          emit(controller, 'chunk', { index, text: rewrittenChunk });
        }

        let passes = 1;
        const rawRewrite = currentText;
        if (useCorpus) currentText = corpusAwarePostprocess(currentText);
        if (enablePostprocess) currentText = postprocess(currentText, { style: stylePreset });

        if (chainIds.length > 0) {
          emit(controller, 'progress', { step: 'chain', message: 'Running configured model chain' });
          const allApiKeys = { ...(extraApiKeys as Record<string, string | undefined>), [model]: apiKey };
          const chainConfig = chainIds
            .filter((id) => allApiKeys[id])
            .map((id) => ({ provider: id as ModelProvider, apiKey: allApiKeys[id] as string }));
          if (chainConfig.length > 0) {
            const chainResult = await chainModels({
              text: currentText,
              chainModels: chainConfig,
              level: rewriteLevel,
              style: stylePreset,
              tone: tonePreset,
              customTone: customTone as string | undefined,
            });
            currentText = chainResult.text;
            passes += chainResult.passes.length;
          }
        }

        if (enablePostprocess) currentText = postprocess(currentText, { light: true });
        emit(controller, 'progress', { step: 'validate', message: 'Scoring semantic fidelity and detector confidence' });
        const guard = applyRewriteRegressionGuard({ originalText: text, candidateText: currentText, fallbackText: rawRewrite });
        const finalText = guard.text;
        const finalDetection = detectAI(finalText);
        const confidenceReport = buildConfidenceReport(finalDetection.score);
        const runtimeModelScore = await scoreHumanLikeness(finalText);
        const semanticFidelity = assessSemanticFidelity(text, finalText);
        const sentences = buildSentenceResults(text, finalText, finalDetection);

        const responsePayload = {
          success: true,
          sentences,
          fullText: finalText,
          model,
          modelName: providerInfo?.name || model,
          wordCount: { input: countWords(text), output: countWords(finalText) },
          timestamp: Date.now(),
          passes,
          finalScore: finalDetection.score,
          options: { level, style, tone, language, purpose },
          confidenceReport,
          runtimeModelScore,
          semanticFidelity,
          observability: {
            latencyMs: Date.now() - startedAt,
            estimatedCostUsd: estimateRunCost(countWords(text), countWords(finalText), model),
            streamingAvailable: true,
            privacyMode: false,
          },
          fallbackBehavior: { used: guard.usedFallback, reason: guard.reason },
          provenanceDisclosure: {
            source: 'user-provided-input',
            policyVersion: 'pr7-safety-governance-v1',
            modelSelection: runtimeModelScore.modelSource,
          },
        };

        await appendAuditLog({
          timestamp: new Date().toISOString(),
          route: '/api/humanize/stream',
          model,
          passes,
          inputWords: countWords(text),
          outputWords: countWords(finalText),
          finalScore: finalDetection.score,
          semanticScore: semanticFidelity.score,
          confidence: confidenceReport.confidence,
          fallbackUsed: guard.usedFallback,
          runtimeModelSource: runtimeModelScore.modelSource,
        });

        emit(controller, 'result', responsePayload);
      } catch (error) {
        emit(controller, 'error', { error: error instanceof Error ? error.message : 'Stream failed' });
      } finally {
        emit(controller, 'done', { ok: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
