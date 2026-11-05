/**
 * Style Model — Loads corpus style statistics and provides calibrated
 * constraints for the humanizer engine.
 *
 * Client-safe: loads the model via fetch() from the public directory.
 * Falls back to Node.js fs on the server side if the public file isn't available.
 */

// ==================== TYPES ====================

export interface SentenceLengthDistribution {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
}

export interface BurstinessProfile {
  mean: number;
  stddev: number;
}

export interface StyleRange {
  mean: number;
  stddev: number;
  min?: number;
  max?: number;
}

export interface PunctuationStats {
  emDashPer1000: StyleRange;
  semicolonPer1000: StyleRange;
  exclamationPer1000: StyleRange;
}

export interface CorpusStyleModel {
  generatedAt: string;
  paperCount: number;
  global: {
    avgSentenceLength: number;
    avgBurstiness: number;
    avgVocabularyDiversity: number;
    avgContractionFrequency: number;
    avgPassiveVoiceRatio: number;
    avgFirstPersonPronouns: number;
    avgHedgingFrequency: number;
    avgWordsPerParagraph: number;
  };
  byDomain: Record<string, {
    paperCount: number;
    sentenceLengthMean: number;
    burstinessMean: number;
    vocabularyDiversityMean: number;
    passiveVoiceMean: number;
  }>;
  sentenceLengthDistribution: SentenceLengthDistribution;
  burstinessProfile: BurstinessProfile;
  vocabularyDiversityRange: { min: number; max: number; mean: number };
  transitionWordFrequency: Record<string, number>;
  aiPhraseFrequency: Record<string, number>;
  contractionFrequency: StyleRange;
  passiveVoiceRatio: StyleRange;
  sentenceStarters: Record<string, number>;
  humanWritingExamples: string[];
  punctuation: PunctuationStats;
}

export interface StyleConstraints {
  sentenceLengthRange: { min: number; max: number; idealMean: number };
  burstinessTarget: number;
  vocabularyDiversityTarget: number;
  transitionWordBudget: number; // per 1000 words
  contractionTarget: number; // per 1000 words
  passiveVoiceTarget: number; // percentage
  firstPersonPronounTarget: number; // per 1000 words
  hedgingBudget: number; // per 1000 words
}

export interface CalibratedThresholds {
  humanScoreMin: number;
  humanScoreMax: number;
  humanScoreMedian: number;
  targetScore: number;
  burstinessFloor: number;
  vocabularyFloor: number;
  transitionCeiling: number;
}

// ==================== LOADING ====================

let cachedModel: CorpusStyleModel | null = null;
let fetchPromise: Promise<CorpusStyleModel | null> | null = null;

/**
 * Load the style model. Safe to call from both client and server.
 *
 * - Client/browser: fetches from /corpus-style-model.json (public dir)
 * - Server/SSR: reads from data/models/corpus-style-model.json via fs
 *
 * Results are cached after first load.
 */
export async function loadStyleModelAsync(): Promise<CorpusStyleModel | null> {
  if (cachedModel) return cachedModel;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    // Strategy 1: Fetch from public directory — BROWSER ONLY. Server-side
    // loading goes through the filesystem strategies below: an environment-
    // provided base URL must never flow into fetch (SSRF surface).
    try {
      if (typeof window !== 'undefined') {
        const baseUrl = window.location.origin;
        const res = await fetch(`${baseUrl}/corpus-style-model.json`);
        if (res.ok) {
          cachedModel = await res.json();
          return cachedModel;
        }
      }
    } catch {
      // fetch failed, try fs
    }

    // Strategy 2: Node.js fs (server-only, build-time, scripts)
    try {
      // Dynamic import that bundlers won't statically analyze
      const mod = await Function('return import("node:fs")')() as typeof import('node:fs');
      const pathMod = await Function('return import("node:path")')() as typeof import('node:path');
      const candidates = [
        pathMod.resolve('data/models/corpus-style-model.json'),
        pathMod.resolve(__dirname, '../../data/models/corpus-style-model.json'),
      ];
      for (const p of candidates) {
        if (mod.existsSync(p)) {
          const raw = mod.readFileSync(p, 'utf-8');
          cachedModel = JSON.parse(raw);
          return cachedModel;
        }
      }
    } catch {
      // not in Node.js
    }

    return null;
  })();

  return fetchPromise;
}

/**
 * Synchronous load — only works on the server.
 * Returns null on client (use loadStyleModelAsync instead).
 */
export function loadStyleModel(): CorpusStyleModel | null {
  return cachedModel;
}

/** Set the model manually (e.g., from an API route that preloads it). */
export function setStyleModel(model: CorpusStyleModel | null): void {
  cachedModel = model;
  fetchPromise = null;
}

/** Whether the model has been loaded (sync check). */
export function hasStyleModel(): boolean {
  return cachedModel !== null;
}

// ==================== STYLE CONSTRAINTS ====================

/**
 * Get style constraints for a given domain (or global defaults).
 * Returns defaults if no model is loaded yet.
 */
export function getStyleConstraints(domain?: string, model?: CorpusStyleModel | null): StyleConstraints {
  const m = model ?? cachedModel;
  if (!m) {
    return getDefaultConstraints();
  }

  const domainData = domain && m.byDomain[domain]
    ? m.byDomain[domain]
    : null;

  const slDist = m.sentenceLengthDistribution;
  const burst = m.burstinessProfile;
  const vocab = m.vocabularyDiversityRange;

  const totalTransitions = Object.values(m.transitionWordFrequency)
    .reduce((sum, v) => sum + v, 0);

  return {
    sentenceLengthRange: {
      min: Math.max(4, slDist.p10),
      max: slDist.p90 + 5,
      idealMean: domainData?.sentenceLengthMean ?? slDist.mean,
    },
    burstinessTarget: domainData?.burstinessMean ?? burst.mean,
    vocabularyDiversityTarget: domainData?.vocabularyDiversityMean ?? vocab.mean,
    transitionWordBudget: totalTransitions,
    contractionTarget: m.contractionFrequency.mean,
    passiveVoiceTarget: domainData?.passiveVoiceMean ?? m.passiveVoiceRatio.mean,
    firstPersonPronounTarget: m.global.avgFirstPersonPronouns,
    hedgingBudget: m.global.avgHedgingFrequency,
  };
}

function getDefaultConstraints(): StyleConstraints {
  return {
    sentenceLengthRange: { min: 6, max: 35, idealMean: 20 },
    burstinessTarget: 0.35,
    vocabularyDiversityTarget: 0.55,
    transitionWordBudget: 3.5,
    contractionTarget: 1.0,
    passiveVoiceTarget: 15,
    firstPersonPronounTarget: 5,
    hedgingBudget: 8,
  };
}

// ==================== PROMPT BUILDER ====================

/**
 * Build a prompt section with corpus-calibrated style targets.
 */
export function buildStyleInjectionPrompt(domain?: string, model?: CorpusStyleModel | null): string {
  const m = model ?? cachedModel;
  const constraints = getStyleConstraints(domain, m);

  if (!m) {
    return '';
  }

  const sl = constraints.sentenceLengthRange;
  const examples = m.humanWritingExamples.slice(0, 5);

  const topStarters = Object.entries(m.sentenceStarters)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  return `

=== CORPUS-CALIBRATED STYLE TARGETS ===
Based on analysis of ${m.paperCount.toLocaleString()} published papers, match these exact patterns:

1. SENTENCE LENGTH: Average ${sl.idealMean} words. Have sentences as short as ${sl.min} and as long as ${sl.max}. The burstiness coefficient (length variation) should be around ${constraints.burstinessTarget.toFixed(2)}.

2. VOCABULARY: Aim for ${Math.round(constraints.vocabularyDiversityTarget * 100)}% unique word ratio. Don't repeat the same words — use synonyms and rephrase.

3. TRANSITIONS: Use no more than ${constraints.transitionWordBudget.toFixed(1)} transition words per 1000 words total. That means roughly 1 transition per paragraph max. The corpus shows humans rarely chain transitions.

4. PASSIVE VOICE: Keep passive constructions around ${constraints.passiveVoiceTarget}% of sentences — not zero, but not dominant either.

5. CONTRACTIONS: Use contractions at roughly ${constraints.contractionTarget.toFixed(1)} per 1000 words — natural, not forced.

6. HEDGING: Hedging phrases at ${constraints.hedgingBudget.toFixed(1)} per 1000 words — use them, but don't overdo it.

7. COMMON SENTENCE STARTERS in this domain: ${topStarters.join(', ')}. Feel free to start sentences with these or with "And", "But", "So".

EXAMPLE sentences from real papers showing natural patterns:
${examples.map((e, i) => `${i + 1}. "${e}"`).join('\n')}
=== END STYLE TARGETS ===`;
}

// ==================== CALIBRATED THRESHOLDS ====================

/**
 * Get detection thresholds calibrated against real human writing.
 */
export function getCorpusCalibratedThresholds(model?: CorpusStyleModel | null): CalibratedThresholds {
  const m = model ?? cachedModel;
  if (!m) {
    return {
      humanScoreMin: 50,
      humanScoreMax: 90,
      humanScoreMedian: 70,
      targetScore: 75,
      burstinessFloor: 20,
      vocabularyFloor: 50,
      transitionCeiling: 15,
    };
  }

  const burstinessFloor = Math.round(m.burstinessProfile.mean * 50);
  const vocabularyFloor = Math.round(m.vocabularyDiversityRange.mean * 85);

  const totalTransitions = Object.values(m.transitionWordFrequency)
    .reduce((sum, v) => sum + v, 0);
  const transitionCeiling = Math.round(totalTransitions * 200);

  return {
    humanScoreMin: 45,
    humanScoreMax: 95,
    humanScoreMedian: 70,
    targetScore: 75,
    burstinessFloor,
    vocabularyFloor,
    transitionCeiling,
  };
}

// ==================== UTILITY ====================

export function getStyleModelInfo(): { loaded: boolean; paperCount?: number; generatedAt?: string } {
  const model = cachedModel;
  if (!model) return { loaded: false };
  return { loaded: true, paperCount: model.paperCount, generatedAt: model.generatedAt };
}
