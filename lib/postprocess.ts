// StealthHumanizer - Non-LLM Post-Processing Engine (Layer 2)
// This is the most important layer — pure deterministic transformations that
// break AI statistical fingerprints without any LLM involvement.

import { getRandomSafeSynonym } from './synonyms';
import { applyCollocation, applyRandomCollocation } from './collocations';
import type { CorpusStyleModel } from './style-model';
import { loadStyleModel } from './style-model';
import { calculateReadability } from './readability';
import type { StylePreset } from './types';

// ==================== HELPERS ====================

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(probability: number): boolean {
  return Math.random() < probability;
}

function splitSentences(text: string): string[] {
  // Protect periods inside identifiers, file extensions, domains, decimals, version
  // numbers, and IPs (e.g., "Llama 3.x", "0.5", "192.168.1.1", "file.ext",
  // "docs.example.com", "tailwind.config.js") so they aren't treated as sentence
  // boundaries. Match alnum-period-alnum with no whitespace on either side.
  const PERIOD_PLACEHOLDER = '';
  const protectedText = text.replace(/([a-zA-Z0-9])\.(?=[a-zA-Z0-9])/g, `$1${PERIOD_PLACEHOLDER}`);
  return protectedText.match(/[^.!?]*[.!?]+[\s]*/g)
    ?.map(s => s.trim().replace(new RegExp(PERIOD_PLACEHOLDER, 'g'), '.'))
    .filter(s => s.length > 0) || [text.trim()];
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
}

function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.join('\n\n');
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Detect if a word looks like a proper noun (starts with uppercase mid-sentence)
function looksLikeProperNoun(word: string, position: number, sentence: string): boolean {
  if (position === 0) return false; // First word of sentence is always capitalized
  if (!/^[A-Z]/.test(word)) return false;
  // Check if it's at the start of the sentence text
  const trimmed = sentence.trim();
  if (trimmed.startsWith(word)) return false;
  return true;
}

function isInQuotes(text: string, index: number): boolean {
  let inQuote = false;
  for (let i = 0; i < index; i++) {
    if (text[i] === '"') inQuote = !inQuote;
    if (text[i] === "'" && (i === 0 || text[i-1] !== 's') && (i === text.length-1 || text[i+1] !== 's')) inQuote = !inQuote;
  }
  return inQuote;
}

// ==================== 2a. SYNONYM SWAPPING ====================

function swapSynonyms(text: string): string {
  // Only swap the safest single-word synonyms at low probability.
  // No context-blind replacements — only words where all synonyms
  // preserve meaning and grammatical role.
  const words = text.split(/(\s+)/);
  const result: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Skip whitespace, punctuation, numbers, short words, words in quotes
    if (!word || /^\s+$/.test(word) || /^[^a-zA-Z]+$/.test(word) || word.length < 4) {
      result.push(word);
      continue;
    }

    // Skip all-caps words
    if (word === word.toUpperCase()) {
      result.push(word);
      continue;
    }

    // Check if in quotes
    const fullTextSoFar = words.slice(0, i).join('');
    if (isInQuotes(text, fullTextSoFar.length)) {
      result.push(word);
      continue;
    }

    // Check if looks like proper noun (capitalized mid-sentence)
    const sentenceContext = words.slice(Math.max(0, i - 20), i + 20).join('');
    if (looksLikeProperNoun(word, i, sentenceContext)) {
      result.push(word);
      continue;
    }

    // 25% chance to swap
    if (chance(0.25)) {
      const synonym = getRandomSafeSynonym(word);
      if (synonym) {
        // Preserve capitalization
        if (/^[A-Z]/.test(word) && /^[a-z]/.test(synonym)) {
          result.push(synonym.charAt(0).toUpperCase() + synonym.slice(1));
        } else {
          result.push(synonym);
        }
        continue;
      }
    }

    result.push(word);
  }

  return result.join('');
}

// ==================== TYPOGRAPHIC VARIATION (Safe) ====================

function addTypographicVariation(text: string): string {
  let result = text;
  // Occasionally replace straight quotes with smart quotes (not in code-like contexts)
  if (chance(0.15)) {
    // Replace "word" with "word" (opening/closing smart quotes)
    const quoted = Array.from(result.matchAll(/"([^"]{2,})"/g));
    if (quoted.length > 0) {
      const q = randomPick(quoted);
      if (q.index !== undefined) {
        const word = q[1];
        result = result.replace(q[0], `\u201C${word}\u201D`);
      }
    }
  }
  // Occasionally use en-dash for number ranges (e.g., 10-15 \u2192 10\u201315)
  if (chance(0.20)) {
    result = result.replace(/(\d)\s*[-\u2013]\s*(\d)/g, (match, a, b) => {
      if (chance(0.3)) return `${a}\u2013${b}`;
      return match;
    });
  }
  return result;
}

// ==================== 2b. SENTENCE REORDERING ====================

function reorderSentences(paragraph: string): string {
  const sentences = splitSentences(paragraph);
  if (sentences.length <= 2) return paragraph; // Too short to reorder

  const pronounPattern = /\b(he|she|it|they|this|that|these|those|his|her|its|their)\b/i;

  // Keep first and last in place, swap 20-30% of middle sentences
  const middle = sentences.slice(1, -1);
  if (middle.length <= 1) return paragraph;

  const swapCount = Math.max(1, Math.floor(middle.length * (0.2 + Math.random() * 0.1)));
  const result = [...middle];

  for (let s = 0; s < swapCount; s++) {
    const i = Math.floor(Math.random() * result.length);
    let j = Math.floor(Math.random() * result.length);
    // Avoid swapping with self
    while (j === i && result.length > 1) j = Math.floor(Math.random() * result.length);
    if (i === j) continue;

    // Check if swapping would break pronoun references
    const afterI = result.slice(Math.min(i, j) + 1).join(' ');
    const sentenceI = result[i];
    const sentenceJ = result[j];

    // If either sentence starts with a pronoun that might reference the other, skip
    if (pronounPattern.test(sentenceI.split(' ')[0]) || pronounPattern.test(sentenceJ.split(' ')[0])) {
      // 50% chance to skip pronoun-sensitive swaps
      if (chance(0.5)) continue;
    }

    [result[i], result[j]] = [result[j], result[i]];
  }

  return [sentences[0], ...result, sentences[sentences.length - 1]].join(' ');
}

// ==================== 2b'. STRIP AI EM-DASHES ====================

// Em-dashes (—) and prose-style en-dashes (–) are one of the strongest AI tells.
// Replace them with commas. Numeric ranges like "2020–2025" or "9–10 AM" are preserved.
function stripAIDashes(text: string): string {
  const RANGE_PLACEHOLDER = 'RANGE';
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, `$1${RANGE_PLACEHOLDER}$2`)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(new RegExp(RANGE_PLACEHOLDER, 'g'), '–');
}

// ==================== 2c. PUNCTUATION & FORMATTING NOISE ====================

const CONTRACTIONS: [string, string][] = [
  ["don't", "do not"], ["can't", "cannot"], ["won't", "will not"],
  ["isn't", "is not"], ["aren't", "are not"], ["wasn't", "was not"],
  ["weren't", "were not"], ["hasn't", "has not"], ["haven't", "have not"],
  ["hadn't", "had not"], ["doesn't", "does not"], ["didn't", "did not"],
  ["shouldn't", "should not"], ["wouldn't", "would not"], ["couldn't", "could not"],
  ["I'm", "I am"], ["you're", "you are"], ["he's", "he is"],
  ["she's", "she is"], ["it's", "it is"], ["we're", "we are"],
  ["they're", "they are"], ["I've", "I have"], ["you've", "you have"],
  ["we've", "we have"], ["they've", "they have"], ["I'll", "I will"],
  ["you'll", "you will"], ["he'll", "he will"], ["she'll", "she will"],
  ["we'll", "we will"], ["they'll", "they will"], ["I'd", "I would"],
  ["you'd", "you would"], ["he'd", "he would"], ["she'd", "she would"],
  ["let's", "let us"], ["that's", "that is"], ["there's", "there is"],
  ["here's", "here is"], ["what's", "what is"], ["who's", "who is"],
];

function addPunctuationNoise(text: string): string {
  let result = text;

  // 10% chance: double space between some sentences
  if (chance(0.10)) {
    const sentenceEnds = result.match(/([.!?])\s+/g);
    if (sentenceEnds) {
      const idx = Math.floor(Math.random() * sentenceEnds.length);
      const match = sentenceEnds[idx];
      result = result.replace(match, match[0] + '  ');
    }
  }

  // 5% chance: semicolon between related sentences (replace ". " with "; ")
  if (chance(0.05)) {
    const periodSpaces = Array.from(result.matchAll(/\.\s+(?=[A-Z])/g));
    if (periodSpaces.length > 0) {
      const p = randomPick(periodSpaces);
      if (p.index !== undefined && p.index > 0) {
        const before = result.slice(0, p.index);
        const after = result.slice(p.index + p[0].length);
        result = before + '; ' + after.charAt(0).toLowerCase() + after.slice(1);
      }
    }
  }

  // Contractions expansion/randomization
  if (chance(0.15)) {
    const contraction = randomPick(CONTRACTIONS);
    const [short, expanded] = contraction;
    // Randomly go either direction
    if (chance(0.5)) {
      // Expand contraction
      result = result.replace(new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), expanded);
    } else {
      // Contract (only if expanded form exists)
      result = result.replace(new RegExp(`\\b${expanded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), short);
    }
  }

  return result;
}

// ==================== 2d. SENTENCE LENGTH MANIPULATION ====================

const FILLER_PHRASES = [
  'in my experience,',
  'from what I\'ve seen,',
  'I\'d argue that',
  'honestly,',
  'the way I see it,',
  'from my perspective,',
  'if you think about it,',
  'interestingly,',
  'to be fair,',
  'in practice,',
  'at least in my view,',
  'one thing that stands out is',
  'what strikes me is',
  'it\'s worth pointing out that',
  'as far as I can tell,',
];

function manipulateSentenceLengths(text: string): string {
  const sentences = splitSentences(text);
  const result: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const words = sentence.trim().split(/\s+/);
    const wc = words.length;

    // Merge two consecutive short sentences (both < 8 words) with 20% chance
    if (
      wc < 8 && i < sentences.length - 1 &&
      sentences[i + 1].trim().split(/\s+/).length < 8 &&
      chance(0.20)
    ) {
      const next = sentences[i + 1].trim();
      const conjunction = randomPick(['and', 'but', 'while', 'whereas']);
      const merged = sentence.trim().replace(/[.!?]+$/, '') + ', ' + conjunction + ' ' +
        next.charAt(0).toLowerCase() + next.slice(1);
      result.push(merged);
      i++; // Skip next sentence
      continue;
    }

    // Split long sentences (>30 words) at a natural break point with 30% chance
    if (wc > 30 && chance(0.30)) {
      // Find a natural break: comma, "and", "but", "which", "that"
      const text = sentence.trim();
      const breakPatterns = [
        /,\s+(?:and|but|or|while)\s+/gi,
        /,\s+(?:which|that|where|when|who)\s+/gi,
        /,\s+(?:however|therefore|moreover|furthermore)\s+/gi,
      ];

      let breakPoint = -1;
      let replacement = '. ';

      for (const pattern of breakPatterns) {
        const match = text.match(pattern);
        if (match && match.index !== undefined && match.index > 10 && match.index < text.length - 10) {
          breakPoint = match.index;
          // Start new sentence with the conjunction
          replacement = '. ' + match[0].replace(/,\s+/, '').charAt(0).toUpperCase() +
            match[0].replace(/,\s+/, '').slice(1);
          break;
        }
      }

      // Fallback: split at a comma in the middle
      if (breakPoint === -1) {
        const commas = Array.from(text.matchAll(/,\s+/g));
        const middleCommas = commas.filter(c => c.index !== undefined && c.index > text.length * 0.3 && c.index < text.length * 0.7);
        if (middleCommas.length > 0) {
          const c = randomPick(middleCommas);
          breakPoint = c.index!;
          replacement = '. ';
        }
      }

      if (breakPoint > 0) {
        const first = text.slice(0, breakPoint).replace(/[,:]$/, '');
        const second = text.slice(breakPoint).replace(/^,?\s*/, '');
        const secondCapitalized = second.charAt(0).toUpperCase() + second.slice(1);
        result.push(first + '. ' + secondCapitalized);
        continue;
      }
    }

    result.push(sentence);
  }

  return result.join(' ');
}

// ==================== 2e. WORD-LEVEL PERPLEXITY INJECTION ====================

function injectPerplexity(text: string): string {
  // Apply all collocation replacements
  return applyCollocation(text);
}

// ==================== 2f. PARAGRAPH STRUCTURE RANDOMIZATION ====================

function randomizeParagraphs(text: string): string {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length <= 1) return text;

  const result: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const sentences = splitSentences(p);

    // 20% chance to split a paragraph into two at a natural point
    if (sentences.length >= 4 && chance(0.20)) {
      const splitPoint = 1 + Math.floor(Math.random() * (sentences.length - 2));
      const first = sentences.slice(0, splitPoint).join(' ');
      const second = sentences.slice(splitPoint).join(' ');
      result.push(first);
      result.push(second);
      continue;
    }

    // 20% chance to merge with next paragraph if both are short
    if (
      i < paragraphs.length - 1 &&
      sentences.length <= 2 &&
      splitSentences(paragraphs[i + 1]).length <= 2 &&
      chance(0.20)
    ) {
      result.push(p + ' ' + paragraphs[i + 1]);
      i++; // Skip next paragraph
      continue;
    }

    // 5% chance to add a one-sentence paragraph emphasis
    if (chance(0.05)) {
      // Extract a key sentence to emphasize
      if (sentences.length >= 3) {
        const emphasizeIdx = 1 + Math.floor(Math.random() * (sentences.length - 2));
        const emphasized = sentences[emphasizeIdx];
        const remaining = sentences.filter((_, idx) => idx !== emphasizeIdx);
        result.push(remaining.join(' '));
        result.push(emphasized);
        continue;
      }
    }

    result.push(p);
  }

  return joinParagraphs(result);
}

// ==================== CORPUS-AWARE POST-PROCESSING ====================

/**
 * Post-process text using corpus statistics to match real human writing patterns.
 * Targets sentence length distribution, transition frequency, and burstiness.
 */
export function corpusAwarePostprocess(text: string, styleModel?: CorpusStyleModel): string {
  const model = styleModel || loadStyleModel();
  if (!model) return text;

  let result = text;

  // 1. Adjust sentence lengths to match corpus distribution
  result = adjustSentenceLengthsToCorpus(result, model);

  // 2. Adjust transition word frequency
  result = adjustTransitionFrequency(result, model);

  // 3. Human voice injection
  result = injectHumanVoice(result, model);

  return result;
}

function adjustSentenceLengthsToCorpus(text: string, model: CorpusStyleModel): string {
  const sl = model.sentenceLengthDistribution;
  const paragraphs = splitParagraphs(text);
  return paragraphs.map(p => {
    const sentences = splitSentences(p);
    const adjusted = sentences.map(s => {
      const wc = wordCount(s);
      const targetMax = sl.p90;

      // If sentence is way too long (>p90 + 10), try to split
      if (wc > targetMax + 10 && chance(0.4)) {
        return trySplitSentence(s);
      }
      return s;
    });
    return adjusted.join(' ');
  }).join('\n\n');
}

function trySplitSentence(sentence: string): string {
  const breakPatterns = [
    /,\s+(?:and|but|or|while|whereas|which|that)\s+/gi,
    /,\s+(?:however|therefore|meaning)\s+/gi,
  ];
  for (const pattern of breakPatterns) {
    const match = sentence.match(pattern);
    if (match && match.index !== undefined && match.index > 10 && match.index < sentence.length - 10) {
      const first = sentence.slice(0, match.index).replace(/[,]$/, '');
      const second = sentence.slice(match.index).replace(/^,?\s*/, '');
      const capitalized = second.charAt(0).toUpperCase() + second.slice(1);
      return first + '. ' + capitalized;
    }
  }
  return sentence;
}

function adjustTransitionFrequency(text: string, model: CorpusStyleModel): string {
  const per1000 = wordCount(text);
  let currentTransitions = 0;
  const lower = text.toLowerCase();
  const transitionWords = ['however', 'therefore', 'moreover', 'furthermore', 'additionally',
    'consequently', 'nevertheless', 'meanwhile', 'subsequently', 'thus', 'hence',
    'accordingly', 'similarly', 'likewise', 'conversely'];
  for (const w of transitionWords) {
    const regex = new RegExp(`\\b${w}\\b`, 'gi');
    const matches = lower.match(regex);
    if (matches) currentTransitions += matches.length;
  }
  const currentPer1000 = (currentTransitions / Math.max(per1000, 1)) * 1000;

  // If too many transitions, remove some
  const targetTotal = Object.values(model.transitionWordFrequency).reduce((s, v) => s + v, 0);
  if (currentPer1000 > targetTotal * 1.5) {
    let result = text;
    let toRemove = Math.floor(currentTransitions * 0.3);
    for (const w of transitionWords) {
      if (toRemove <= 0) break;
      const regex = new RegExp(`\\b${w}\\b[,]?\s*`, 'gi');
      result = result.replace(regex, (match) => {
        if (toRemove > 0) { toRemove--; return ''; }
        return match;
      });
    }
    return result.replace(/\s{2,}/g, ' ').replace(/\.+\./g, '.');
  }
  return text;
}

function injectHumanVoice(text: string, model: CorpusStyleModel): string {
  let result = text;
  const contractionMean = model.contractionFrequency.mean;
  const words = result.split(/\s+/);
  const wc = words.length;

  // Count current contractions
  const currentContractions = (result.match(/\w+'(?:t|s|re|ve|ll|d|m)\b/gi) || []).length;
  const currentPer1000 = (currentContractions / Math.max(wc, 1)) * 1000;

  // Add contractions if below target
  if (currentPer1000 < contractionMean && chance(0.5)) {
    const expansions = [
      ['do not', "don't"], ['can not', "can't"], ['cannot', "can't"],
      ['will not', "won't"], ['is not', "isn't"], ['are not', "aren't"],
      ['it is', "it's"], ['that is', "that's"], ['there is', "there's"],
      ['we are', "we're"], ['they are', "they're"],
    ];
    for (const [expanded, contracted] of expansions) {
      if (currentPer1000 >= contractionMean) break;
      if (result.toLowerCase().includes(expanded)) {
        const regex = new RegExp(expanded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        result = result.replace(regex, contracted);
        break; // One per pass
      }
    }
  }

  // Occasionally start a sentence with a conjunction (10% chance per paragraph)
  if (chance(0.10)) {
    const paragraphs = splitParagraphs(result);
    const pIdx = Math.floor(Math.random() * paragraphs.length);
    const sentences = splitSentences(paragraphs[pIdx]);
    if (sentences.length > 1) {
      const sIdx = 1 + Math.floor(Math.random() * (sentences.length - 1));
      const conjunction = randomPick(['And', 'But', 'So', 'Plus']);
      sentences[sIdx] = conjunction + ' ' + sentences[sIdx].charAt(0).toLowerCase() + sentences[sIdx].slice(1);
      paragraphs[pIdx] = sentences.join(' ');
      result = joinParagraphs(paragraphs);
    }
  }

  // Occasionally add a parenthetical aside (5% chance)
  if (chance(0.05)) {
    const asides = ['which is interesting', 'interestingly', 'if you think about it', 'at least that\'s the idea', 'in my view'];
    const aside = randomPick(asides);
    // Insert before the last period
    const lastPeriod = result.lastIndexOf('.');
    if (lastPeriod > 20) {
      result = result.slice(0, lastPeriod) + ` (${aside})` + result.slice(lastPeriod);
    }
  }

  return result;
}

// ==================== 2g. AGGRESSIVE AI VOCABULARY REMOVAL ====================

function aggressiveSynonymSwap(text: string, style?: StylePreset): string {
  const isFormal = style === 'academic' || style === 'professional' || style === 'technical';

  const replacements: [RegExp, string[]][] = [
    [/\bdemonstrates?\b/gi, ['shows', 'makes clear', 'reveals', 'tells us']],
    [/\bfurthermore\b/gi, ['also', 'and', 'on top of that', 'plus']],
    [/\bmoreover\b/gi, ['also', 'and', 'besides', "what's more"]],
    [/\badditionally\b/gi, ['also', 'and', 'plus', 'on top of that']],
    [/\bconsequently\b/gi, ['so', 'which means', 'as a result', 'because of that']],
    [/\bsignificantly\b/gi, isFormal ? ['noticeably', 'considerably', 'to a meaningful extent'] : ['a lot', 'noticeably', 'quite a bit']],
    [/\bsubstantially\b/gi, isFormal ? ['considerably', 'to a large extent', 'materially'] : ['a lot', 'quite a bit', 'in a big way']],
    [/\bnotably\b/gi, ['especially', 'worth pointing out', 'interestingly']],
    [/\bremarkably\b/gi, isFormal ? ['surprisingly', 'strikingly', 'to a notable degree'] : ['surprisingly', 'interestingly', 'quite a bit']],
    [/\bparticularly\b/gi, ['especially', 'mainly', 'mostly']],
    [/\bessentially\b/gi, isFormal ? ['fundamentally', 'at its core', 'in essence'] : ['basically', 'at its core', 'when you get down to it']],
    [/\bfundamentally\b/gi, isFormal ? ['at its core', 'in essence', 'in principle'] : ['basically', 'at its core', 'really']],
    [/\bultimately\b/gi, isFormal ? ['in the end', 'in the final analysis', 'as a conclusion'] : ['in the end', 'at the end of the day', 'when all is said and done']],
    [/\binherently\b/gi, ['naturally', 'by its nature', 'built into it']],
    [/\butilize\b/gi, ['use', 'work with', 'make use of']],
    [/\bfacilitate\b/gi, ['help with', 'make easier', 'enable']],
    [/\bleverage\b/gi, ['use', 'take advantage of', 'build on']],
    [/\boptimize\b/gi, ['improve', 'make better', 'fine-tune']],
    [/\bimplement\b/gi, ['set up', 'put in place', 'start using']],
    [/\bcomprehensive\b/gi, ['thorough', 'complete', 'full']],
    [/\binnovative\b/gi, ['new', 'fresh', 'creative', 'different']],
    [/\btransformative\b/gi, isFormal ? ['major', 'significant', 'far-reaching'] : ['major', 'really big', 'a big deal']],
    [/\bunprecedented\b/gi, ['never seen before', 'completely new', 'totally unusual']],
    [/\bstreamline\b/gi, ['simplify', 'make smoother', 'speed up']],
    [/\bcrucial\b/gi, ['key', 'important', 'really matters']],
    [/\bpivotal\b/gi, ['key', 'important', 'central']],
    [/\bit is evident that\b/gi, ['clearly', 'obviously', 'you can see that']],
    [/\bit is clear that\b/gi, ['clearly', 'obviously']],
    [/\bplays? a crucial role\b/gi, isFormal ? ['is central to', 'is a key factor in', 'has a significant impact on'] : ['matters a lot', 'is really important', 'makes a big difference']],
    [/\bplays? an important role\b/gi, isFormal ? ['is significant in', 'contributes meaningfully to', 'is a key part of'] : ['matters', 'is important', 'makes a difference']],
    [/\bhas the potential to\b/gi, ['could', 'might', 'stands to']],
    [/\bin today's world\b/gi, ['now', 'these days', 'right now']],
    [/\bin the modern era\b/gi, ['now', 'these days']],
    [/\bin conclusion\b/gi, ['']],
    [/\bin summary\b/gi, ['']],
    [/\bto summarize\b/gi, ['']],
    [/\bit is important to note\b/gi, ['']],
    [/\bit is worth noting(?: that)?\b/gi, ['']],
    [/\bit is worth mentioning\b/gi, ['']],
    [/\bdelves? into\b/gi, ['looks at', 'digs into', 'explores']],
    [/\blandscape\b/gi, ['space', 'area', 'world', 'field']],
    [/\bmultifaceted\b/gi, ['complex', 'complicated', 'many-sided']],
    [/\bembark on a journey\b/gi, ['start', 'begin', 'get into']],
    [/\bseamless(ly)?\b/gi, ['smooth', 'easy', 'natural']],
    [/\bnumerous\b/gi, isFormal ? ['many', 'several', 'a considerable number of'] : ['many', 'a lot of', 'tons of']],
    [/\ba variety of\b/gi, ['different', 'various', 'all kinds of']],
    [/\ba multitude of\b/gi, isFormal ? ['many', 'numerous', 'a significant number of'] : ['many', 'a lot of', 'tons of']],
    [/\ba significant number of\b/gi, isFormal ? ['many', 'numerous', 'a considerable number of'] : ['many', 'a lot of', 'quite a few']],
    // Additional AI-generated phrases (Issue #91)
    [/\bin today's digital landscape\b/gi, ['now', 'these days', 'in the current environment']],
    [/\bin the realm of\b/gi, isFormal ? ['in the field of', 'in the area of', 'when it comes to'] : ['in', 'when it comes to', 'for']],
    [/\bas we navigate\b/gi, ['as we deal with', 'as we work through', 'when dealing with']],
    [/\btapestry of\b/gi, ['mix of', 'variety of', 'collection of']],
    [/\bshowcase\b/gi, ['show', 'display', 'demonstrate', 'highlight']],
    [/\brobust\b/gi, isFormal ? ['strong', 'solid', 'well-built'] : ['strong', 'solid', 'reliable']],
    [/\bdynamic\b/gi, ['active', 'changing', 'flexible', 'adaptable']],
    [/\bmeticulous(ly)?\b/gi, isFormal ? ['careful', 'thorough', 'detailed'] : ['careful', 'thorough', 'precise']],
    [/\bempowers?\b/gi, ['enables', 'allows', 'helps', 'lets']],
    [/\brevolutionize\b/gi, ['change', 'transform', 'improve dramatically']],
    [/\bcutting-edge\b/gi, ['latest', 'newest', 'modern', 'advanced']],
    [/\bstate-of-the-art\b/gi, ['latest', 'most advanced', 'top-of-the-line']],
    [/\bgame-changer\b/gi, ['big deal', 'major shift', 'important development']],
    [/\bparadigm shift\b/gi, ['major change', 'fundamental shift', 'big shift']],
    [/\bin the ever-evolving\b/gi, ['in the changing', 'in the growing']],
    [/\bmeticulously crafted\b/gi, ['carefully made', 'well-designed', 'thoughtfully built']],
  ];

  let result = text;
  for (const [pattern, alternatives] of replacements) {
    result = result.replace(pattern, () => randomPick(alternatives));
  }
  return result;
}

// ==================== 2h. FLOW DISRUPTION ====================

function disruptFlow(text: string, style?: StylePreset): string {
  const isFormal = style === 'academic' || style === 'professional' || style === 'technical';
  const paragraphs = splitParagraphs(text);
  return paragraphs.map(p => {
    const sentences = splitSentences(p);
    if (sentences.length < 2) return p;

    const result = [...sentences];

    if (isFormal) {
      // Formal: mild insertions — parenthetical asides, qualifying clauses
      if (chance(0.20) && result.length >= 3) {
        const formalInsertions = [
          '— though this remains debated',
          '— at least in principle',
          'which is worth considering.',
          'notably.',
          '— a point worth emphasizing.',
          'in practice.',
        ];
        const idx = 1 + Math.floor(Math.random() * (result.length - 1));
        result.splice(idx, 0, randomPick(formalInsertions));
      }
      // Formal: start with a transition rather than a conjunction
      if (chance(0.15)) {
        const formalStarters = ['Importantly, ', 'In practice, ', 'Notably, ', 'As it turns out, ', 'Looking at the data, '];
        result[0] = randomPick(formalStarters) + result[0].charAt(0).toLowerCase() + result[0].slice(1);
      }
    } else {
      // Casual/creative: keep current behavior but expanded
      if (chance(0.30) && result.length >= 3) {
        const insertions = ['Right.', 'Exactly.', 'Makes sense.', 'Think about that.', 'Hmm.', 'Interesting.', 'Yeah.', 'No, really.', 'Honestly.', 'True story.', 'Funny enough.'];
        const idx = 1 + Math.floor(Math.random() * (result.length - 1));
        result.splice(idx, 0, randomPick(insertions));
      }

      // 20% chance: start with a conjunction
      if (chance(0.20)) {
        const conjunctions = ['And ', 'But ', 'So ', 'Plus ', 'Then again, ', 'OK, ', 'Well, '];
        result[0] = randomPick(conjunctions) + result[0].charAt(0).toLowerCase() + result[0].slice(1);
      }
    }

    // 15% chance: add a rhetorical question (both styles)
    if (chance(0.15) && result.length >= 2) {
      const questions = isFormal
        ? ['Why does this matter?', 'What are the implications?', 'Is this correlation or causation?', 'How significant is this finding?']
        : ['Makes you wonder, right?', 'Sound familiar?', 'Who would have thought?', 'And is that really so surprising?'];
      const idx = Math.floor(Math.random() * result.length);
      result.splice(idx, 0, randomPick(questions));
    }

    return result.join(' ');
  }).join('\n\n');
}

// ==================== MAIN POST-PROCESS FUNCTION ====================

export interface PostProcessOptions {
  light?: boolean; // If true, apply lighter version (for Layer 4)
  style?: StylePreset; // Adjust transformations to match writing style
  skipReadabilityGuard?: boolean; // For internal use when re-applying light passes
  aggressiveSynonyms?: boolean; // If false, skip aggressiveSynonymSwap. Default: true.
}

/**
 * Apply all non-LLM post-processing transformations.
 * Each transformation is randomized, so the same input produces different output each time.
 * Style-aware: academic/professional gets milder transformations than casual/creative.
 */
export function postprocess(text: string, options?: PostProcessOptions): string {
  const light = options?.light ?? false;
  const style = options?.style;
  let result = text;

  // ALWAYS: Strip em-dashes (strongest AI tell). Numeric ranges preserved.
  result = stripAIDashes(result);

  // Aggressive AI vocabulary removal (style-aware). Skippable per-call.
  // The pass makes context-blind global replacements that occasionally damage
  // meaning ("first" -> "to start", "deal" -> "address"); turn off when
  // semantic precision matters more than vocabulary variation.
  if (options?.aggressiveSynonyms !== false) {
    result = aggressiveSynonymSwap(result, style);
  }

  // ALWAYS: Collocation replacements
  result = injectPerplexity(result);

  if (light) {
    result = swapSynonyms(result);
    if (chance(0.5)) result = addPunctuationNoise(result);
    // Skip disruptFlow in light mode: it injects emphasis fillers ("Right.",
    // "Sound familiar?", "Funny enough.") and conjunction starters at fixed
    // per-paragraph rates, which compounds badly on long inputs and reads as
    // an AI tic itself. Full mode keeps it for cases that explicitly want
    // structural disruption.
    return result
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // Full post-processing pipeline
  result = swapSynonyms(result);
  result = addPunctuationNoise(result);
  result = manipulateSentenceLengths(result);
  result = disruptFlow(result, style);

  // Sentence reordering
  const paragraphs = splitParagraphs(result);
  const reorderedParagraphs = paragraphs.map(p => reorderSentences(p));
  result = joinParagraphs(reorderedParagraphs);

  result = randomizeParagraphs(result);

  // Additional collocation passes
  for (let i = 0; i < 3; i++) {
    result = applyRandomCollocation(result);
  }

  // Safe typographic variation (smart quotes, en-dashes)
  result = addTypographicVariation(result);

  // Readability guard
  if (!options?.skipReadabilityGuard) {
    result = readabilityGuard(text, result);
  }

  // Clean up
  result = result
    .replace(/  +/g, (match) => {
      if (/[.!?]  /.test(match)) return '  ';
      return ' ';
    })
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\.\s*\./g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return result;
}

// ==================== READABILITY GUARD ====================

/**
 * Prevents post-processing from destroying readability.
 * If the post-processed text has a Flesch Reading Ease score more than 15 points
 * lower than the original, revert the most aggressive changes.
 */
function readabilityGuard(original: string, processed: string): string {
  const origScores = calculateReadability(original);
  const procScores = calculateReadability(processed);
  const drop = origScores.fleschReadingEase - procScores.fleschReadingEase;

  if (drop > 15) {
    // Revert to a lighter version: only synonym swaps + collocations
    let safe = aggressiveSynonymSwap(original);
    safe = injectPerplexity(safe);
    safe = swapSynonyms(safe);
    safe = addTypographicVariation(safe);
    return safe
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return processed;
}
