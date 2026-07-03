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

// Ensure every sentence (and the start of the text) begins with a capital letter.
// The various transformation passes (sentence merge/split, synonym swaps) can leave
// a sentence starting lowercase; this restores correct casing without touching the
// interior of words. Skips likely abbreviations (e.g. "U.S.", "Dr.", "e.g.") by
// not capitalizing after a 1-2 letter token that ends in a period.
const ABBREVIATION_TAIL = /(?:^|\s)(?:[A-Za-z]\.){1,2}$|(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|cf|approx|Inc|Ltd|Co|Corp|No)\.$/;

function capitalizeSentenceStarts(text: string): string {
  return text.replace(
    /(^|[.!?]["')\]]?\s+|\n\s*)([a-z])/g,
    (match, prefix: string, ch: string, offset: number) => {
      // Avoid capitalizing right after an abbreviation ("e.g. word" -> "e.g. Word").
      const before = text.slice(0, offset + prefix.length);
      if (ABBREVIATION_TAIL.test(before)) return match;
      return prefix + ch.toUpperCase();
    }
  );
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

function swapSynonyms(text: string, intensity: number = 10): string {
  // Only swap the safest single-word synonyms at low probability.
  // No context-blind replacements — only words where all synonyms
  // preserve meaning and grammatical role.
  const swapChance = intensity / 100;
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

    if (chance(swapChance)) {
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
    // 2. Dash immediately followed by punctuation -> drop the dash, keep punctuation
    .replace(/\s*[–—]\s*(?=[.!?,;:)\]"'…])/g, '')
    // 3. Dash at the start of a sentence -> drop it (no leading comma)
    .replace(/(^|[\n.!?]["')\]]?\s+)[–—]\s*/g, '$1')
    // 4. Any remaining clausing/parenthetical dash -> ", " (a normal comma splice)
    .replace(/\s*[–—]\s*/g, ', ')
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

  // NOTE: a previous 5% "merge two sentences with a semicolon + lowercase the
  // second" transform was removed. It destroyed sentence boundaries and casing
  // (turning "Done. Never share keys." into "Done; never share keys."), which
  // both reads worse and broke safety-text preservation. Kept out on purpose.

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

function manipulateSentenceLengths(text: string): string {
  const sentences = splitSentences(text);
  const result: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const words = sentence.trim().split(/\s+/);
    const wc = words.length;

    // NOTE: a previous "merge two short sentences with a conjunction + lowercase
    // the second" transform was removed. It lowercased the second sentence's
    // opening word, which broke proper nouns and safety-critical phrasing
    // ("Never share keys" -> "and never share keys"). Splitting long sentences
    // below is kept because it capitalizes correctly.

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

// ==================== 2d'. BURSTINESS INJECTION (EVASION) ====================

function ensureBurstiness(text: string): string {
  // Detect low sentence length variance (burstiness) and fix it to evade detectors.
  const paragraphs = splitParagraphs(text);
  const result: string[] = [];

  for (const p of paragraphs) {
    const sentences = splitSentences(p);
    if (sentences.length < 3) {
      result.push(p);
      continue;
    }

    const lengths = sentences.map(s => wordCount(s));
    
    // Check if sentences are too uniform (e.g., adjacent sentences differ by < 8 words)
    let isUniform = true;
    for (let i = 0; i < lengths.length - 1; i++) {
      if (Math.abs(lengths[i] - lengths[i + 1]) > 8) {
        isUniform = false;
        break;
      }
    }

    if (isUniform && chance(0.75)) {
      // Forcefully merge two adjacent short/medium sentences to create a spike in variance
      for (let i = 0; i < sentences.length - 1; i++) {
        if (lengths[i] < 20 && lengths[i + 1] < 20) {
          // Remove the punctuation of the first sentence and join with semicolon
          const s1 = sentences[i].replace(/[.!?]+$/, '');
          const s2 = sentences[i + 1].charAt(0).toLowerCase() + sentences[i + 1].slice(1);
          sentences.splice(i, 2, s1 + '; ' + s2);
          break; // Do one merge per uniform paragraph
        }
      }
    }
    result.push(sentences.join(' '));
  }
  return joinParagraphs(result);
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
      const regex = new RegExp(`\\b${w}\\b[,]?\\s*`, 'gi');
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

  // NOTE: We intentionally do NOT inject conjunction sentence-starters
  // ("And ...", "But ...", "So ...") here. Prepending them forced lowercasing
  // the following word, which broke proper nouns ("Google" -> "google"), and
  // starting sentences with conjunctions at a fixed rate is itself an AI tic
  // that detectors learn. The LLM rewrite + contraction balancing already
  // supply enough sentence-variety without this risk.

  // Occasionally add a short parenthetical aside (low rate; in-place, never an orphan)
  if (chance(0.04)) {
    const asides = ['which is worth noting', 'interestingly', 'if you think about it', 'at least in principle', 'in practice'];
    const aside = randomPick(asides);
    // Insert before the last period of the final sentence only
    const lastPeriod = result.lastIndexOf('.');
    if (lastPeriod > 40) {
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
    [/\bfurthermore\b/gi, ['also', 'and', 'on top of that']],
    [/\bmoreover\b/gi, ['also', 'and', 'besides', "what's more"]],
    [/\badditionally\b/gi, ['also', 'and', 'on top of that']],
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
    [/\bin conclusion\b/gi, ['overall', 'so', 'in short']],
    [/\bin summary\b/gi, ['in short', 'overall', 'to sum up']],
    [/\bto summarize\b/gi, ['in short', 'overall', 'in brief']],
    [/\bit is important to note\b/gi, ['notably', 'worth noting', 'keep in mind']],
    [/\bit is worth noting(?: that)?\b/gi, ['worth noting', 'notably', 'keep in mind']],
    [/\bit is worth mentioning\b/gi, ['worth mentioning', 'notably', 'also']],
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

// ==================== 2h. FLOW SOFTENING (in-place only) ====================
//
// IMPORTANT: This step must NEVER create a new standalone sentence. Earlier
// versions spliced in detached interjections ("Right.", "Honestly?", "Makes
// you wonder, right?") and rhetorical questions as their own sentences. Those
// orphans read as broken/incomplete text, misalign the sentence-level diff,
// and themselves register as an AI tic. We now only MODIFY existing sentences
// in place (soften stiff openers) — no insertions, no splices.

function softenStiffOpeners(sentence: string, isFormal: boolean): string {
  const trimmed = sentence.trimStart();
  // Only re-touch a sentence occasionally and only if it begins with a stiff
  // AI-typical phrase. Keep the sentence complete and grammatically correct.
  const stiffFormal: [RegExp, string][] = [
    [/^It is important to note that\b/i, 'Notably,'],
    [/^It is worth noting that\b/i, 'Worth noting:'],
    [/^It should be noted that\b/i, 'Note that'],
    [/^It is evident that\b/i, 'Clearly,'],
    [/^In conclusion,?\s*/i, 'Overall,'],
    [/^In summary,?\s*/i, 'In short,'],
    [/^Furthermore,?\s*/i, 'Also,'],
    [/^Moreover,?\s*/i, 'Additionally,'],
    [/^Additionally,?\s*/i, 'Also,'],
    [/^Subsequently,?\s*/i, 'Then,'],
    [/^Consequently,?\s*/i, 'So,'],
    [/^Hence,?\s*/i, 'So,'],
    [/^Thus,?\s*/i, 'So,'],
    [/^Therefore,?\s*/i, 'So,'],
  ];
  const stiffCasual: [RegExp, string][] = [
    [/^In conclusion,?\s*/i, 'So,'],
    [/^Furthermore,?\s*/i, 'Also,'],
    [/^Moreover,?\s*/i, 'Additionally,'],
    [/^Additionally,?\s*/i, 'Also,'],
    [/^Therefore,?\s*/i, 'So,'],
  ];
  const rules = isFormal ? stiffFormal : [...stiffCasual, ...stiffFormal];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(trimmed)) {
      const rest = trimmed.replace(pattern, '').trim();
      if (!rest) continue;
      const lead = sentence.slice(0, sentence.length - trimmed.length); // preserve leading whitespace
      const firstChar = replacement.charAt(0);
      return `${lead}${firstChar}${replacement.slice(1)} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
    }
  }
  return sentence;
}

function disruptFlow(text: string, style?: StylePreset): string {
  const isFormal = style === 'academic' || style === 'professional' || style === 'technical';
  const paragraphs = splitParagraphs(text);
  return paragraphs.map(p => {
    const sentences = splitSentences(p);
    if (sentences.length === 0) return p;

    // Soften at most ONE stiff opener per paragraph, in place. No insertions.
    if (chance(0.35)) {
      const targetIdx = Math.floor(Math.random() * sentences.length);
      sentences[targetIdx] = softenStiffOpeners(sentences[targetIdx], isFormal);
    }
    return sentences.join(' ');
  }).join('\n\n');
}

// ==================== MAIN POST-PROCESS FUNCTION ====================

export interface PostProcessOptions {
  light?: boolean; // If true, apply lighter version (for Layer 4)
  style?: StylePreset; // Adjust transformations to match writing style
  skipReadabilityGuard?: boolean; // For internal use when re-applying light passes
  aggressiveSynonyms?: boolean; // If false, skip aggressiveSynonymSwap. Default: true.
  synonymIntensity?: number; // 0-100, controls synonym swap frequency. Default: 25
}

/**
 * Apply all non-LLM post-processing transformations.
 * Each transformation is randomized, so the same input produces different output each time.
 * Style-aware: academic/professional gets milder transformations than casual/creative.
 */
/**
 * Strip chatty LLM preambles/sign-offs and wrapping quotes that smaller models
 * (e.g. local gemma3) emit despite instructions to return only the rewrite.
 * Conservative by design: only removes a SINGLE leading intro line when it
 * matches a known opener AND ends in a colon AND substantive text follows, and
 * only unwraps quotes when they wrap the ENTIRE output. Normal prose is safe
 * because a real first sentence neither starts with these openers nor ends in
 * a trailing colon with body text on subsequent lines.
 */
function stripLLMPreamble(text: string): string {
  let r = text.trim();
  const QC = '["“”‘’`]';
  const unwrap = (s: string) => {
    // Same-character wrap (straight quote / backtick): open and close match.
    let m = s.match(/^(["`])([\s\S]*?)\1$/);
    if (m) return m[2].trim();
    // Smart-quote pairs use distinct open/close code points.
    m = s.match(/^(“)([\s\S]*)”$/);
    if (m) return m[2].trim();
    m = s.match(/^(‘)([\s\S]*)’$/);
    if (m) return m[2].trim();
    return s;
  };
  const startsQ = (s: string) => new RegExp('^' + QC).test(s);
  const endsQ = (s: string) => new RegExp(QC + '$').test(s);

  const opener =
    /^(here(?:'s| is)?|below(?:,| is)?|sure[,!]?|certainly[,!]?|of course[,!]?|okay[,!]?|alright[,!]?|this is|the (?:rewritten|revised|humanized|final|following)|rewritten|revised|humanized(?:\s+(?:text|version))?|result|output|answer)\b/i;

  // 1) Single-line preamble clause: "<opener> ... : <content>". Models phrase
  //    this many ways (with/without quotes, open-only quotes, etc.), so key on
  //    the SEMANTIC content of the preamble: it must start with an opener AND
  //    contain a meta word (rewritten/version/natural/...). That keeps legit
  //    prose like "Here is the issue: we need time." (no meta word) untouched.
  const META = /\b(rewritten|revised|humanized|rewrite|version|natural|polished|aiming|preserving|following|simpler|clearer|readable|updated)\b/i;
  const colonIdx = r.search(/[:：]/);
  if (colonIdx > 0 && colonIdx < 200) {
    const before = r.slice(0, colonIdx).trim();
    const after = r.slice(colonIdx + 1).trim();
    if (opener.test(before) && META.test(before) && after.length > 0) {
      if (startsQ(after) && endsQ(after)) r = unwrap(after);
      else if (startsQ(after)) r = after.replace(new RegExp('^' + QC), '');
      else r = after;
    }
  }

  // 2) Preamble on its own line: "<opener> ...:" then content on later lines.
  const lines = r.split(/\r?\n/);
  if (lines.length >= 2) {
    const first = lines[0].trim();
    if (first.length > 0 && first.length < 120 && opener.test(first) && /[:：]\s*$/.test(first)) {
      lines.shift();
      r = unwrap(lines.join('\n').trim());
    }
  }

  // 3) Trailing sign-off line.
  r = r
    .replace(/\n\s*(hope this helps.*|let me know.*|feel free to.*|happy (?:writing|humanizing|to help).*)\s*$/i, '')
    .trim();

  // 4) Orphan leading quote: some models open a quote and never close it,
  //    with no preamble at all. Strip a lone opening quote when its matching
  //    closer is absent (balanced pairs are already handled by unwrap above).
  const stripOrphanLeadQuote = (s: string): string => {
    if (s.startsWith('“') && !s.includes('”')) return s.slice(1).trimStart();
    if (s.startsWith('‘') && !s.includes('’')) return s.slice(1).trimStart();
    if (s.startsWith('"') && (s.match(/"/g) || []).length % 2 === 1) return s.slice(1).trimStart();
    return s;
  };

  // 5) Final unwrap in case earlier steps left the body wrapped.
  return stripOrphanLeadQuote(unwrap(r));
}

// ==================== STEALTH ENGINE (anti-detector deterministic layer) ====================
// The strongest detector signals are AI-typical vocabulary/phrases and the
// absence of contractions + uniform sentence lengths. These maps strip the
// AI lexicon down to plain human wording and force natural contractions.
// Order matters: longer/more-specific phrases first, then word-level swaps.
// Replacements are meaning-preserving; case at sentence starts is restored by
// capitalizeSentenceStarts after every pass.

const AI_LEXICON_PHRASES: [RegExp, string][] = [
  // Filler openers / connectives -> delete entirely (meaning survives without them)
  [/\b(?:moreover|furthermore|additionally|in addition|lastly|finally),\s*/gi, ''],
  [/\bit is important to note that\s*,?\s*/gi, ''],
  [/\bit is worth (?:noting|mentioning) that\s*,?\s*/gi, ''],
  [/\bit should be (?:noted|emphasized) that\s*,?\s*/gi, ''],
  [/\bit must be noted that\s*,?\s*/gi, ''],
  [/\bit is (?:crucial|essential|imperative|vital) to\s+/gi, 'you must '],
  [/\bit is (?:evident|clear|apparent) that\s*,?\s*/gi, 'clearly, '],
  [/\bin conclusion\s*,?\s*/gi, ''],
  [/\bin summary\s*,?\s*/gi, ''],
  [/\bto summarize\s*,?\s*/gi, ''],
  [/\bto conclude\s*,?\s*/gi, ''],
  [/\bas (?:previously )?mentioned(?: earlier)?\s*,?\s*/gi, ''],
  [/\bas (?:discussed|noted) (?:earlier|above)\s*,?\s*/gi, ''],
  [/\bneedless to say\s*,?\s*/gi, ''],
  [/\blast but not least\s*,?\s*/gi, ''],
  [/\bfirst and foremost\s*,?\s*/gi, 'first, '],
  [/\bat the end of the day\s*,?\s*/gi, ''],
  [/\bin today'?s world\s*,?\s*/gi, ''],
  [/\bin today'?s digital landscape\s*,?\s*/gi, 'today '],
  [/\bin this day and age\s*,?\s*/gi, 'now '],
  [/\bin the modern era\s*,?\s*/gi, 'now '],
  [/\bin the (?:contemporary|current) landscape\s*,?\s*/gi, 'today '],
  [/\bin the realm of\b/gi, 'in'],
  [/\bas we navigate\s+/gi, 'as we handle '],
  [/\bplays? a (?:crucial|important|pivotal|key|vital|significant) role (?:in|of)\b/gi, 'matters in'],
  [/\bplays? a (?:crucial|important|pivotal|key|vital) role\b/gi, 'matters'],
  [/\bhas the potential to\b/gi, 'can'],
  [/\bdelve(?:s)? into\b/gi, 'dig into'],
  [/\bsheds? light on\b/gi, 'shows'],
  [/\bbrings? to the forefront\b/gi, 'highlights'],
  [/\bembarks? on a journey\b/gi, 'starts'],
  [/\bnavigat(?:e|es|ing) the\b/gi, 'handle the'],
  [/\ba myriad of\b/gi, 'many'],
  [/\ba multitude of\b/gi, 'many'],
  [/\ba (?:wide|broad|vast) (?:range|array) of\b/gi, 'many'],
  [/\ba significant number of\b/gi, 'many'],
  [/\ba (?:large|small) number of\b/gi, 'many'],
  [/\bin terms of\b/gi, 'for'],
  [/\bwhen it comes to\b/gi, 'for'],
  [/\bon the other hand\s*,?\s*/gi, ''],
  [/\bas a result\s*,?\s*/gi, 'so '],
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bdespite the fact that\b/gi, 'although'],
  [/\ba (?:key|crucial|vital|critical) aspect of\b/gi, 'a core part of'],
];

const AI_LEXICON_WORDS: [RegExp, string][] = [
  [/\bleverage(?:d|s|ing)?\b/gi, 'use'],
  [/\butilize(?:d|s|ing)?\b/gi, 'use'],
  [/\bfacilitate(?:d|s|ing)?\b/gi, 'help'],
  [/\bfoster(?:ed|s|ing)?\b/gi, 'build'],
  [/\bcultivat(?:e|ed|es|ing)\b/gi, 'grow'],
  [/\bempower(?:ed|s|ing)?\b/gi, 'enable'],
  [/\brobust\b/gi, 'strong'],
  [/\bcomprehensive(?:ly)?\b/gi, 'complete'],
  [/\binnovative\b/gi, 'new'],
  [/\bunprecedented\b/gi, 'rare'],
  [/\bseamless(?:ly)?\b/gi, 'smooth'],
  [/\bstreamline(?:d|s|ing)?\b/gi, 'simplify'],
  [/\bparadigm\b/gi, 'model'],
  [/\bsynerg(?:y|ies|istic(?:ally)?)\b/gi, 'teamwork'],
  [/\bmultifaceted\b/gi, 'complex'],
  [/\bholistic(?:ally)?\b/gi, 'whole'],
  [/\bcutting-edge\b/gi, 'advanced'],
  [/\bstate-of-the-art\b/gi, 'modern'],
  [/\bgroundbreaking\b/gi, 'new'],
  [/\btransformative\b/gi, 'important'],
  [/\bshowcase(?:d|s|ing)?\b/gi, 'show'],
  [/\bunderscore(?:d|s|ing)?\b/gi, 'highlight'],
  [/\belucidate(?:d|s|ing)?\b/gi, 'explain'],
  [/\bmitigat(?:e|ed|es|ing)\b/gi, 'reduce'],
  [/\bsynthesi[sz]e(?:d|s|ing)?\b/gi, 'combine'],
  [/\bmyriad\b/gi, 'many'],
  [/\bnevertheless\b/gi, 'still'],
  [/\bconsequently\b/gi, 'so'],
  [/\bsubsequently\b/gi, 'then'],
  [/\bthus,?\s+/gi, 'so '],
  [/\bhence,?\s+/gi, 'so '],
  [/\bdemonstrat(?:e|es|ed)\b/gi, 'show'],
  [/\billustrat(?:e|es|ed)\b/gi, 'show'],
  [/\bnotably\b,?\s*/gi, ''],
  [/\bremarkably\b,?\s*/gi, ''],
  [/\bsignificantly\b,?\s*/gi, ''],
  [/\bessentially\b,?\s*/gi, ''],
];

export function stripAILexicon(text: string): string {
  let r = text;
  for (const [re, rep] of AI_LEXICON_PHRASES) r = r.replace(re, rep);
  for (const [re, rep] of AI_LEXICON_WORDS) r = r.replace(re, rep);
  // Tidy up gaps left by phrase deletions (stray commas, double spaces).
  // NOTE: do not capitalize here -- capitalizeSentenceStarts (called after)
  // handles sentence-start casing correctly without upper-casing every word.
  r = r
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1');
  return capitalizeSentenceStarts(r);
}

// Case-sensitive contraction pairs (capital form must be listed separately so
// sentence-initial casing is preserved).
const STEALTH_CONTRACTIONS: [RegExp, string][] = [
  [/\bDo not\b/g, "Don't"], [/\bdo not\b/g, "don't"],
  [/\bDoes not\b/g, "Doesn't"], [/\bdoes not\b/g, "doesn't"],
  [/\bDid not\b/g, "Didn't"], [/\bdid not\b/g, "didn't"],
  [/\bCannot\b/g, "Can't"], [/\bcannot\b/g, "can't"], [/\bcan not\b/g, "can't"],
  [/\bWill not\b/g, "Won't"], [/\bwill not\b/g, "won't"],
  [/\bWould not\b/g, "Wouldn't"], [/\bwould not\b/g, "wouldn't"],
  [/\bShould not\b/g, "Shouldn't"], [/\bshould not\b/g, "shouldn't"],
  [/\bCould not\b/g, "Couldn't"], [/\bcould not\b/g, "couldn't"],
  [/\bIs not\b/g, "Isn't"], [/\bis not\b/g, "isn't"],
  [/\bAre not\b/g, "Aren't"], [/\bare not\b/g, "aren't"],
  [/\bWas not\b/g, "Wasn't"], [/\bwas not\b/g, "wasn't"],
  [/\bWere not\b/g, "Weren't"], [/\bwere not\b/g, "weren't"],
  [/\bHas not\b/g, "Hasn't"], [/\bhas not\b/g, "hasn't"],
  [/\bHave not\b/g, "Haven't"], [/\bhave not\b/g, "haven't"],
  [/\bHad not\b/g, "Hadn't"], [/\bhad not\b/g, "hadn't"],
  [/\bIt is\b/g, "It's"], [/\bit is\b/g, "it's"],
  [/\bThey are\b/g, "They're"], [/\bthey are\b/g, "they're"],
  [/\bWe are\b/g, "We're"], [/\bwe are\b/g, "we're"],
  [/\bYou are\b/g, "You're"], [/\byou are\b/g, "you're"],
  [/\bI am\b/g, "I'm"],
  [/\bThat is\b/g, "That's"], [/\bthat is\b/g, "that's"],
  [/\bThere is\b/g, "There's"], [/\bthere is\b/g, "there's"],
  [/\bWe will\b/g, "We'll"], [/\bwe will\b/g, "we'll"],
  [/\bIt will\b/g, "It'll"], [/\bit will\b/g, "it'll"],
  [/\bLet us\b/g, "Let's"], [/\blet us\b/g, "let's"],
];

function forceContractions(text: string): string {
  let r = text;
  for (const [re, rep] of STEALTH_CONTRACTIONS) r = r.replace(re, rep);
  return r;
}

/**
 * Stealth post-process: the deterministic anti-detector layer for the 'stealth'
 * style. Strips the AI lexicon, forces natural contractions, and enforces
 * burstiness/length variation -- the signals real detectors key on. Run AFTER
 * the LLM rewrite + regression guard so these transforms are never reverted.
 * Meaning-preserving by construction (safe word/phrase swaps + structure split).
 */
export function stealthPostprocess(text: string, options?: { style?: StylePreset }): string {
  let r = stripLLMPreamble(text);
  r = stripAIDashes(r);
  r = stripAILexicon(r);
  r = forceContractions(r);
  r = injectPerplexity(r);
  r = manipulateSentenceLengths(r);
  r = ensureBurstiness(r);
  r = applyRandomCollocation(r);
  r = r
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return capitalizeSentenceStarts(r);
}

/**
 * Intensity-driven post-process. Controls how hard the deterministic
 * anti-detector layer pushes, independent of style (style = tone, intensity =
 * stealth strength). Applied after the regression guard so it is never
 * reverted. ninja's surgical sentence-rewrite happens in the route (needs the
 * detector).
 *   light     -> preamble/dash strip only (max fidelity, minimal change)
 *   medium    -> + safe word-level AI-lexicon strip
 *   aggressive-> + contractions + burstiness + length variation (full stealth)
 *   ninja     -> aggressive (route adds surgical rewrite of low-scored sentences)
 */
export function intensityPostprocess(
  text: string,
  intensity: 'light' | 'medium' | 'aggressive' | 'ninja',
  options?: { style?: StylePreset }
): string {
  let r = stripLLMPreamble(text);
  r = stripAIDashes(r);
  const tidy = (s: string) =>
    capitalizeSentenceStarts(
      s.replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1').trim()
    );
  if (intensity === 'light') return tidy(r);
  r = stripAILexicon(r);
  if (intensity === 'medium') return tidy(r);
  // aggressive + ninja: full stealth treatment (forceContractions + burstiness).
  return stealthPostprocess(text, { style: options?.style });
}

/**
 * Pure cleanup that never changes meaning: strip AI em-dashes, collapse
 * whitespace, fix double punctuation, and restore sentence-start capitals.
 * Used for the rewrite-regression fallback so that when the guard reverts to
 * the raw LLM output, the text is still polished (no em-dashes / bad casing)
 * without re-introducing the drift that triggered the revert.
 */
export function safeClean(text: string): string {
  let r = stripLLMPreamble(text);
  r = stripAIDashes(r);
  r = r
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return capitalizeSentenceStarts(r);
}

export function postprocess(text: string, options?: PostProcessOptions): string {
  const light = options?.light ?? false;
  const style = options?.style;
  let result = text;

  // ALWAYS: Drop chatty LLM preambles/wrapping quotes first (smaller models).
  result = stripLLMPreamble(result);

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
    result = swapSynonyms(result, options?.synonymIntensity);
    // Skip addPunctuationNoise in light mode: expanding/contracting random
    // contractions and adding double spaces adds no anti-detection value and
    // can break text in subtle ways.
    return result
      .replace(/,\s*,/g, ',')
      .replace(/\s+,/g, ',')
      .replace(/\.\s*\./g, '.')
      .replace(/\s{2,}/g, ' ')
      // Remove dangling punctuation fragments (standalone periods, commas)
      .replace(/(?:^|\n)\s*[.,;:!?]\s*(?:\n|$)/g, '\n')
      // Remove orphan single-character lines
      .replace(/(?:^|\n)\s*[a-zA-Z]\s*(?:\n|$)/g, '\n')
      .trim()
      .split(/\n/)
      .map(line => capitalizeSentenceStarts(line))
      .join('\n');
  }

  // Full post-processing pipeline (less aggressive than before)
  result = swapSynonyms(result, options?.synonymIntensity);
  result = addPunctuationNoise(result);
  result = manipulateSentenceLengths(result);
  result = ensureBurstiness(result);
  result = disruptFlow(result, style);

  // NOTE: Sentence reordering and paragraph randomization have been removed.
  // They destroyed logical flow and paragraph structure, making text incoherent.
  // The LLM rewrite + synonym swaps + flow disruption are sufficient for
  // anti-detection without breaking meaning.

  // Single additional collocation pass (reduced from 3 to 1)
  result = applyRandomCollocation(result);

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

  // Restore correct sentence-start capitalization as a final safety net.
  result = capitalizeSentenceStarts(result);

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

  // Also check if sentence count changed drastically (sign of broken text)
  const origSentences = original.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const procSentences = processed.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const sentenceRatio = origSentences > 0 ? procSentences / origSentences : 1;

  if (drop > 15 || sentenceRatio < 0.5 || sentenceRatio > 2.0) {
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
