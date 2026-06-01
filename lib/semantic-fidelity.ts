import { splitIntoSentences } from '@/lib/text-utils';
import { countWords } from '@/lib/storage';

export interface SemanticFidelityReport {
  score: number;
  verdict: 'preserved' | 'review' | 'drift';
  lexicalOverlap: number;
  keywordRecall: number;
  lengthRatio: number;
  sentenceAlignment: number;
  warnings: string[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to',
  'was', 'were', 'will', 'with', 'you', 'your', 'we', 'our', 'they', 'them', 'i', 'me',
]);

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length > 2 && !STOP_WORDS.has(token)) ?? [];
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (const value of a.values()) aMag += value * value;
  for (const value of b.values()) bMag += value * value;
  for (const [key, value] of a) dot += value * (b.get(key) ?? 0);
  if (aMag === 0 || bMag === 0) return 0;
  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

function vectorize(tokens: string[], ngramSize = 1): Map<string, number> {
  const vector = new Map<string, number>();
  for (let i = 0; i <= tokens.length - ngramSize; i++) {
    const gram = tokens.slice(i, i + ngramSize).join(' ');
    vector.set(gram, (vector.get(gram) ?? 0) + 1);
  }
  return vector;
}

function topKeywords(tokens: string[], limit = 24): string[] {
  const counts = vectorize(tokens);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([token]) => token);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function assessSemanticFidelity(original: string, rewritten: string): SemanticFidelityReport {
  const originalTokens = normalizeTokens(original);
  const rewrittenTokens = normalizeTokens(rewritten);
  const unigramCosine = cosineSimilarity(vectorize(originalTokens), vectorize(rewrittenTokens));
  const bigramCosine = cosineSimilarity(vectorize(originalTokens, 2), vectorize(rewrittenTokens, 2));
  const keywords = topKeywords(originalTokens);
  const rewrittenSet = new Set(rewrittenTokens);
  const keywordRecall = keywords.length === 0
    ? 1
    : keywords.filter(keyword => rewrittenSet.has(keyword)).length / keywords.length;

  const inputWords = Math.max(1, countWords(original));
  const outputWords = Math.max(1, countWords(rewritten));
  const lengthRatioRaw = Math.min(inputWords, outputWords) / Math.max(inputWords, outputWords);
  const originalSentences = Math.max(1, splitIntoSentences(original).length);
  const rewrittenSentences = Math.max(1, splitIntoSentences(rewritten).length);
  const sentenceAlignment = Math.min(originalSentences, rewrittenSentences) / Math.max(originalSentences, rewrittenSentences);

  const weightedScore = (unigramCosine * 0.36) + (bigramCosine * 0.18) + (keywordRecall * 0.28) + (lengthRatioRaw * 0.10) + (sentenceAlignment * 0.08);
  const warnings: string[] = [];
  if (keywordRecall < 0.55) warnings.push('Important keywords may have been dropped.');
  if (lengthRatioRaw < 0.55) warnings.push('Output length changed substantially; review for omissions or additions.');
  if (sentenceAlignment < 0.5) warnings.push('Sentence structure changed substantially; verify meaning manually.');
  if (bigramCosine < 0.15 && inputWords > 30) warnings.push('Phrase-level overlap is low; check for semantic drift.');

  const score = clampPercent(weightedScore);
  return {
    score,
    verdict: score >= 74 ? 'preserved' : score >= 58 ? 'review' : 'drift',
    lexicalOverlap: clampPercent(unigramCosine),
    keywordRecall: clampPercent(keywordRecall),
    lengthRatio: clampPercent(lengthRatioRaw),
    sentenceAlignment: clampPercent(sentenceAlignment),
    warnings,
  };
}
