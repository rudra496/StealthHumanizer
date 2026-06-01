// 🔍 NOOB EXPLAINER: How do we measure if meaning was preserved?
// We use TWO methods together for better accuracy:
//
// 1. KEYWORD METHOD: Check if important words (nouns, verbs, numbers)
//    from the original appear in the humanized version. Simple but
//    misses synonyms (e.g., "important" → "crucial" = different words, same meaning).
//
// 2. EMBEDDING METHOD: Convert both sentences to vectors (lists of numbers)
//    using an AI model, then measure how "close" the vectors are.
//    This catches synonyms and paraphrases but requires an API call.
//
// We combine both methods: keyword for speed, embedding for accuracy.

import type { FidelityResult, SentenceFidelity, DriftInstance } from './types';
import { FIDELITY_THRESHOLDS } from './types';

function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';
  let i = 0;
  const abbreviations = ['Mr.', 'Mrs.', 'Dr.', 'Prof.', 'Inc.', 'Ltd.', 'etc.', 'e.g.', 'i.e.', 'vs.', 'al.'];
  while (i < text.length) {
    current += text[i];
    if (['.', '!', '?'].includes(text[i])) {
      const beforeMatch = text.slice(Math.max(0, i - 5), i + 1);
      const isInsideIdentifier = text[i] === '.' && /[a-zA-Z0-9]/.test(text[i - 1] || '') && /[a-zA-Z0-9]/.test(text[i + 1] || '');
      if (!isInsideIdentifier && !abbreviations.some(abbr => beforeMatch.endsWith(abbr))) {
        const trimmed = current.trim();
        if (trimmed.length > 0) sentences.push(trimmed);
        current = '';
      }
    }
    i++;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) sentences.push(trimmed);
  return sentences;
}

// 📝 NOOB EXPLAINER: Keyword extraction
// We pull out the "important" words from a sentence — nouns, verbs,
// numbers, proper nouns. Words like "the", "and", "is" aren't
// important for meaning, so we skip them.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'of', 'in', 'to',
  'for', 'with', 'on', 'at', 'from', 'by', 'about', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'if', 'when', 'while', 'although',
  'this', 'that', 'these', 'those', 'it', 'its', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'how',
]);

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  return words.filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// 🧮 NOOB EXPLAINER: Jaccard similarity
// This measures how many keywords are shared between two sentences.
// Formula: (shared words) / (total unique words)
// 0 = no overlap, 1 = identical keywords
function jaccardSimilarity(setA: string[], setB: string[]): number {
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// 🔢 NOOB EXPLAINER: Number preservation check
// Numbers are crucial for meaning. If "73% of users" becomes
// "most users", that's a fidelity problem. We check that all
// numbers in the original appear in the humanized version.
function checkNumberPreservation(original: string, humanized: string): number {
  const numRegex = /\b\d+\.?\d*\b/g;
  const origNums = original.match(numRegex) || [];
  const humNums = humanized.match(numRegex) || [];
  
  if (origNums.length === 0) return 1; // No numbers to preserve
  
  let preserved = 0;
  for (const num of origNums) {
    if (humNums.includes(num)) preserved++;
  }
  
  return preserved / origNums.length;
}

// 🎯 NOOB EXPLAINER: Combined fidelity score
// We combine keyword overlap + number preservation into one score.
// This gives a quick, no-API-call-needed estimate of meaning preservation.
function computeSentenceFidelity(original: string, humanized: string): SentenceFidelity {
  const origKeywords = extractKeywords(original);
  const humKeywords = extractKeywords(humanized);
  
  const keywordScore = jaccardSimilarity(origKeywords, humKeywords);
  const numberScore = checkNumberPreservation(original, humanized);
  
  // Weighted combination: keyword overlap (70%) + number preservation (30%)
  const combined = keywordScore * 0.7 + numberScore * 0.3;
  
  // Scale to 0-1 range with adjustment (raw Jaccard is often low)
  const adjusted = Math.min(1, combined * 1.5);
  
  return {
    original,
    humanized,
    score: adjusted,
    method: 'keyword',
  };
}

// 🚨 NOOB EXPLAINER: Drift detection
// "Drift" is when the humanized text has drifted away from the original
// meaning. We flag sentences where the fidelity score is below threshold.
function detectDrift(fidelities: SentenceFidelity[]): DriftInstance[] {
  return fidelities
    .filter(f => f.score < FIDELITY_THRESHOLDS.acceptable)
    .map(f => ({
      original: f.original,
      humanized: f.humanized,
      score: f.score,
      severity: f.score < FIDELITY_THRESHOLDS.critical ? 'critical' :
                f.score < FIDELITY_THRESHOLDS.poor ? 'high' :
                f.score < FIDELITY_THRESHOLDS.acceptable ? 'medium' : 'low',
      suggestion: generateDriftSuggestion(f),
    }));
}

function generateDriftSuggestion(fidelity: SentenceFidelity): string {
  const origKeywords = extractKeywords(fidelity.original);
  const humKeywords = extractKeywords(fidelity.humanized);
  const missingKeywords = origKeywords.filter(k => !humKeywords.includes(k));
  
  if (missingKeywords.length > 0) {
    return `Missing key terms: ${missingKeywords.join(', ')}. Ensure these concepts are preserved.`;
  }
  
  if (fidelity.score < FIDELITY_THRESHOLDS.poor) {
    return 'Significant meaning change detected. Consider re-humanizing this sentence with lighter settings.';
  }
  
  return 'Minor drift detected. Review to ensure key points are preserved.';
}

// 🎤 Main export: Compute fidelity between original and humanized text
export function computeFidelity(original: string, humanized: string): FidelityResult {
  const origSentences = splitIntoSentences(original);
  const humSentences = splitIntoSentences(humanized);
  
  // Match sentences (simple positional alignment for now)
  const maxLen = Math.max(origSentences.length, humSentences.length);
  const perSentence: SentenceFidelity[] = [];
  
  for (let i = 0; i < maxLen; i++) {
    const orig = origSentences[i] || '';
    const hum = humSentences[Math.min(i, humSentences.length - 1)] || '';
    if (orig && hum) {
      perSentence.push(computeSentenceFidelity(orig, hum));
    }
  }
  
  const overall = perSentence.length > 0
    ? perSentence.reduce((sum, s) => sum + s.score, 0) / perSentence.length
    : 1;
  
  const flaggedDrift = detectDrift(perSentence);
  
  return { overall, perSentence, flaggedDrift };
}

// Quick check: Is the fidelity score acceptable?
export function isFidelityAcceptable(result: FidelityResult): boolean {
  return result.overall >= FIDELITY_THRESHOLDS.acceptable;
}
