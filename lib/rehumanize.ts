import { detectAI } from './detector';
import { applyHumanizeTransforms } from './humanize-transforms';

// Conservative AI-phrase replacements for the offline re-humanize fallback.
// Each maps to a clean, grammatical replacement (never an empty string, which
// left dangling commas / lowercase sentence starts). Word-boundary safe.
//
// 2026-11-05: entries that fabricated context ("particularly in data
// workflows", "achieving measurably stronger outcomes"), remapped verbs
// ("has enabled" -> "accelerates"), or corrupted technical meaning
// ("accuracy" -> "precision") were removed — nominalization inversions now
// live in lib/humanize-transforms.ts, position-aware and verb-preserving.
const AI_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bFurthermore,?\s*/gi, 'Also, '],
  [/\bMoreover,?\s*/gi, 'Additionally, '],
  [/\bAdditionally,?\s*/gi, 'Also, '],
  [/\bConsequently,?\s*/gi, 'So '],
  [/\bTherefore,?\s*/gi, 'So '],
  [/\bIn conclusion,?\s*/gi, 'Overall, '],
  [/\bIt is important to note that\s*/gi, 'Notably, '],
  [/\bIt is worth noting that\s*/gi, 'Notably, '],
  [/\bplays? a (?:crucial|vital|significant|key) role in\b/gi, 'matters for'],
  [/\bfacilitates?\b/gi, 'helps'],
  [/\butilizes?\b/gi, 'uses'],
  [/\bleverages?\b/gi, 'uses'],
  [/\bleveraging\b/gi, 'using'],
  [/\boptimi[sz]e[ds]?\b/gi, 'refine'],
  [/\bcomprehensive\b/gi, 'thorough'],
  // "statistically significant" is a technical term — never swap it.
  [/\b(?<!statistically )significant(?:ly)?\b/gi, 'notable'],
  [/\bsubstantial(?:ly)?\b/gi, 'considerable'],
  [/\bvarious\b/gi, 'different'],
  [/\bnumerous\b/gi, 'many'],
  [/\brealm of\b/gi, 'area of'],
  [/\bdomain of\b/gi, 'area of'],
  [/\bwith remarkable efficiency\b/gi, 'efficiently'],
  [/\bhas demonstrated\b/gi, 'has shown'],
  [/\bare able to\b/gi, 'can'],
  [/\bdemonstrates?\b/gi, 'shows'],
  [/\bin the modern era\b/gi, 'today'],
  [/\bAI implementations\b/gi, 'AI deployments'],
];

export function splitIntoSentencesStable(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+[\s]*/g)?.map(s => s.trim()).filter(Boolean) || (text.trim() ? [text.trim()] : []);
}

export function parseRehumanizedLines(raw: string): string[] {
  // Strip markdown code fences that some LLMs wrap JSON in
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Try JSON array first
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const results = parsed.map(String).map(s => s.trim()).filter(s => s.length > 8);
        if (results.length > 0) return results;
      }
    } catch {}
  }

  // Fallback: numbered lines (1. sentence / 1) sentence / 1: sentence)
  const numberedLines = cleaned
    .split('\n')
    .map(line => line
      .replace(/^\s*(?:[-*•]|\d+[.):,]|["']?sentence\s*\d+["']?\s*[:.)-])\s*/i, '')
      .replace(/^["']|["']\s*,?$/g, '')
      .trim())
    .filter(line => line.length > 8 && !/^here (?:are|is)\b/i.test(line) && !/^(?:sure|okay|certainly)/i.test(line));

  return numberedLines;
}

function preserveEnding(original: string, rewritten: string): string {
  const end = original.trim().match(/[.!?]$/)?.[0] || '.';
  const clean = rewritten.trim().replace(/[.!?]+$/, '');
  return `${clean}${end}`;
}

// Capitalize the first alphabetic character of a sentence.
function capitalizeStart(s: string): string {
  return s.replace(/^\s*([a-z])/, (_, c: string) => c.toUpperCase());
}

// Split an overly long sentence at a natural conjunction boundary. Never
// injects openers; capitalizes the new sentence correctly.
function splitLongSentence(sentence: string): string {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 28) return sentence;
  const joined = sentence.trim();
  const match = joined.match(/^(.{60,}?)[,;]\s+(and|but|while|whereas|which|so|because|therefore)\s+(.{20,})$/i);
  if (!match) return sentence;
  const first = match[1].replace(/[,;:]$/, '').trim();
  const tail = match[3].trim();
  return `${first}. ${capitalizeStart(tail)}`;
}

export function localRehumanizeSentence(sentence: string, _index = 0, opts?: { style?: string }): string {
  let rewritten = sentence.trim();
  for (const [pattern, replacement] of AI_PHRASE_REPLACEMENTS) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  rewritten = rewritten
    .replace(/\bThis (?:capability|development|approach|process)\b/gi, 'This')
    .replace(/\bThe (?:implementation|utilization|integration) of\b/gi, 'using')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/,\s+([.!?])/g, '$1')
    .trim();

  // Shared register-aware pass: adds contractions only for non-formal styles,
  // and (when nothing above changed the sentence) applies a bounded
  // adverb-only variation instead of the old random synonym roulette.
  rewritten = applyHumanizeTransforms(rewritten, { style: opts?.style, maxAdverbSwaps: 1 });

  rewritten = splitLongSentence(rewritten);
  rewritten = capitalizeStart(rewritten);

  // If sentence has 12-22 words and ends with period and has no em-dash or parentheses,
  // insert a natural cadence em-dash or rhythm adjustment if it splits cleanly.
  const words = rewritten.split(/\s+/);
  if (words.length >= 12 && words.length <= 22 && !/[—()\[\]]/.test(rewritten)) {
    if (/,\s*(?:allowing|helping|especially|particularly)\b/i.test(rewritten)) {
      rewritten = rewritten.replace(/,\s*(allowing|helping|especially|particularly)\b/i, ' — $1');
    }
  }

  // Fragment guard: if the rewrite collapsed to something too short or empty,
  // fall back to the original sentence rather than emit a broken one.
  if (rewritten.split(/\s+/).filter(Boolean).length < 4) {
    return preserveEnding(sentence, sentence);
  }
  return preserveEnding(sentence, rewritten);
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function scoreSentence(text: string): number {
  return detectAI(text).sentences[0]?.score ?? detectAI(text).score;
}

/**
 * Choose the better of the LLM rewrite and the local fallback for a sentence.
 * Prefers the LLM rewrite on near-ties (it reads more naturally), and never
 * returns a candidate that is identical to the original or a fragment.
 */
export function chooseImprovedRewrite(
  original: string,
  llmRewrite: string | undefined,
  index = 0,
  style?: string
): string {
  const fallback = localRehumanizeSentence(original, index, { style });
  const originalScore = scoreSentence(original);

  // Completeness check: candidate must have ending punctuation and 4+ words
  function isComplete(text: string): boolean {
    const t = text.trim();
    if (!t) return false;
    if (!/[.!?]$/.test(t)) return false;
    if (t.split(/\s+/).filter(Boolean).length < 4) return false;
    return true;
  }

  const candidates = [llmRewrite, fallback]
    .filter((candidate): candidate is string => Boolean(candidate && candidate.trim().length > 8))
    .filter(candidate => isComplete(candidate))
    .map(candidate => preserveEnding(original, candidate.trim()))
    .filter(candidate => normalized(candidate).toLowerCase() !== normalized(original).toLowerCase());

  if (candidates.length === 0) return fallback;

  const scored = candidates.map(candidate => ({ candidate, score: scoreSentence(candidate) }));
  scored.sort((a, b) => {
    const aGain = a.score - originalScore;
    const bGain = b.score - originalScore;
    if (bGain !== aGain) return bGain - aGain;
    // Tie-break: prefer the candidate that is NOT the local fallback (i.e. the
    // LLM rewrite), which reads more naturally and avoids heuristic-driven
    // over-rewriting.
    return a.candidate === fallback ? 1 : b.candidate === fallback ? -1 : b.score - a.score;
  });

  return scored[0].candidate;
}

export function replaceSentencesInText(fullText: string, replacements: Array<{ original: string; replacement: string }>): string {
  let output = fullText;
  for (const { original, replacement } of replacements) {
    if (!original || !replacement) continue;
    if (output.includes(original)) {
      output = output.replace(original, replacement);
      continue;
    }

    const escaped = original.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    output = output.replace(new RegExp(escaped), replacement);
  }
  return output;
}
