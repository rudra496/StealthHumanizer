/**
 * Shared register-aware humanization transforms.
 *
 * Created 2026-11-05 after the blind regex cascade (commits 1b2d2fd/c6d191c/24672b4)
 * degraded output quality: nominalization rewrites that broke prepositional phrases
 * ("benefit from the implementation of AI" -> "benefit from implementing of AI"),
 * verb-destroying maps ("has enabled Y" -> "accelerates"), forced contractions in
 * academic register, and a random synonym-swap fallback that read like a 2010
 * article spinner.
 *
 * Design contract for every rule in this module:
 * 1. Meaning-preserving: the words AFTER a rewritten span are never remapped
 *    (verbs survive verbatim; no sentence inserts content the input lacked).
 * 2. Position-aware: gerund replacements adapt their case to sentence position,
 *    so "benefit from the implementation of AI" -> "benefit from implementing AI".
 * 3. Register-aware: formal styles (academic, technical) never receive
 *    contractions or casual connectors.
 * 4. Verifiable: `sentenceLooksBroken` vetoes candidates produced by upstream
 *    engines (translation pivots, LLM drafts) before they are shipped. It only
 *    rejects; it never rewrites.
 */

import { StylePreset } from './types';

/** Styles that must never receive contractions or casual connectors. */
const FORMAL_STYLES = new Set<string>(['academic', 'technical']);

export function isFormalStyle(style?: string | StylePreset): boolean {
  return !!style && FORMAL_STYLES.has(style);
}

// ---------------------------------------------------------------------------
// Grammar gate
// ---------------------------------------------------------------------------

/** Words that legitimately repeat in English ("had had", "that that"). */
const LEGITIMATE_DOUBLES = new Set(['had', 'that', 'very']);

/**
 * Returns true when a sentence carries a mechanical defect introduced by
 * string-rewrite engines. Used to veto candidates, never to mutate text.
 */
export function sentenceLooksBroken(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;

  // Literal replacement-group injection ("examine$1", "Deploying $1x").
  if (/[a-zA-Z]\$\d/.test(s)) return true;

  // Doubled function words ("of of", "to to", "the the", "is is").
  const doubled = s.match(/\b(of|to|in|for|with|by|from|at|on|as|into|the|that|a|an|and|or|is|are|was|were|be)\s+\1\b/i);
  if (doubled) return true;

  // Bare gerund followed directly by "of" — the signature of a blind
  // nominalization swap ("benefit from implementing of AI").
  if (/\b(?:implementing|deploying|using|integrating|adopting|applying|developing|executing|operating|analyzing|evaluating|examining|investigating|assessing)\s+of\b/i.test(s)) {
    return true;
  }

  // Any other repeated word (3+ chars) that English does not legitimately double.
  const repeat = s.match(/\b([A-Za-z]{3,})\s+\1\b/i);
  if (repeat && !LEGITIMATE_DOUBLES.has(repeat[1].toLowerCase())) return true;

  // Unbalanced brackets or quotes.
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    const opens = s.split(open).length - 1;
    const closes = s.split(close).length - 1;
    if (opens !== closes) return true;
  }

  // Mid-sentence capitalised gerund right after a preposition — the artifact
  // of a naive "The implementation of X" -> "Deploying X" replacement.
  if (/\b(?:from|by|with|for|through|via|of|in|on|at|about|after|before|without)\s+(?:Implementing|Deploying|Using|Integrating|Adopting|Applying|Developing|Executing|Operating)\b/.test(s)) {
    return true;
  }

  return false;
}

/** Gate for a whole text: every sentence must pass. */
export function textLooksBroken(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => sentenceLooksBroken(sentence));
}

/**
 * True when every digit run in `input` survives in `output` (compared as
 * normalized multisets — separators ignored, so "12,000" == "12.000").
 * Protects statistics, years, and citation numbers from translation drift.
 */
export function digitsPreserved(input: string, output: string): boolean {
  const collect = (t: string) =>
    (t.match(/\d+(?:[.,]\d+)*/g) || []).map((x) => x.replace(/[.,]/g, '')).sort().join('|');
  return collect(input) === collect(output);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const NOMINALIZATION_GERUNDS: Record<string, string> = {
  implementation: 'implementing',
  utilization: 'using',
  utilisation: 'using',
  adoption: 'adopting',
  integration: 'integrating',
  application: 'applying',
  development: 'developing',
  execution: 'executing',
  operation: 'operating',
  deployment: 'deploying',
  analysis: 'analyzing',
  evaluation: 'evaluating',
  examination: 'examining',
  investigation: 'investigating',
  assessment: 'assessing',
};

/** True when the character span ending just before `index` closes a sentence. */
function isSentenceStart(full: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && /[\s"'“”(\[]/.test(full[i])) i--;
  if (i < 0) return true;
  return /[.!?]/.test(full[i]);
}

/**
 * "The implementation of X" -> "Implementing X" (sentence start) or
 * "implementing X" (mid-sentence, after a preposition or verb). The words
 * after the match — including the verb — are never touched.
 */
function nominalizationReplacer(match: string, article: string, noun: string, offset: number, full: string): string {
  const gerund = NOMINALIZATION_GERUNDS[noun.toLowerCase()];
  if (!gerund) return match;
  if (isSentenceStart(full, offset)) {
    return gerund.charAt(0).toUpperCase() + gerund.slice(1);
  }
  // Keep a lowercase gerund; drop the article ("benefit from implementing AI").
  return gerund;
}

const SUFFIX_VERB_MAPS: Array<[RegExp, Record<string, string>]> = [
  [/\butiliz(?:e|es|ed|ing)\b/gi, { e: 'use', es: 'uses', ed: 'used', ing: 'using' }],
  [/\butilis(?:e|es|ed|ing)\b/gi, { e: 'use', es: 'uses', ed: 'used', ing: 'using' }],
  [/\bleverag(?:e|es|ed|ing)\b/gi, { e: 'use', es: 'uses', ed: 'used', ing: 'using' }],
  [/\bfacilitat(?:e|es|ed|ing)\b/gi, { e: 'help', es: 'helps', ed: 'helped', ing: 'helping' }],
  [/\bstreamlin(?:e|es|ed|ing)\b/gi, { e: 'simplify', es: 'simplifies', ed: 'simplified', ing: 'simplifying' }],
];

function suffixVerbReplacer(map: Record<string, string>) {
  return (match: string, suffix: string): string => {
    const replacement = map[suffix.toLowerCase()];
    return replacement ? replacement : match;
  };
}

interface TransformRule {
  pattern: RegExp;
  // String-replace callback signature mirrors the DOM lib (any-typed groups).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replacement: string | ((...args: any[]) => string);
  /** 'formal' rules are safe in every register; 'casual' rules are skipped for academic/technical styles. */
  register?: 'formal' | 'casual';
}

const RULES: TransformRule[] = [
  // --- Nominalization inversions (position-aware, verb-preserving) ---
  {
    pattern: /\b([Tt]he)\s+(implementation|utilization|utilisation|adoption|integration|application|development|execution|operation|deployment|analysis|evaluation|examination|investigation|assessment)\s+of\b/g,
    replacement: nominalizationReplacer,
    register: 'formal',
  },
  // "Businesses that use AI can ..." -> "Businesses using AI can ..."
  // (subject and following verb both preserved).
  {
    pattern: /\b([A-Za-z]{3,}s)\s+that\s+(?:use|uses|utilize|utilizes|utilise|utilises|leverage|leverages)\s+/g,
    replacement: '$1 using ',
    register: 'formal',
  },
  // "X is a subset of Y that focuses on Z" -> "As a branch of Y, X focuses on Z"
  // (subject capture bounded to 1-3 words so a preceding clause like
  // "In modern computing," cannot be swallowed; the "is a type of" variant is
  // deliberately NOT covered — its restructure drops the verb of the
  // relative clause).
  {
    pattern: /\b([A-Z][a-zA-Z]*(?:\s+[A-Za-z]+){0,2}) is a subset of ([^,.]+?) that focuses on\b/g,
    replacement: 'As a branch of $2, $1 focuses on',
    register: 'formal',
  },

  // --- AI opener removal (capitalizes the word that follows) ---
  {
    pattern: /\bIt is (?:important|worth|crucial|essential|imperative) to (?:note|mention|remember|highlight) that\s+([a-z])/gi,
    replacement: (_m: string, c: string) => c.toUpperCase(),
    register: 'formal',
  },
  {
    pattern: /\bIt should (?:also )?be noted that\s+([a-z])/gi,
    replacement: (_m: string, c: string) => c.toUpperCase(),
    register: 'formal',
  },

  // --- Connectives ---
  {
    pattern: /\bIn conclusion,?\s*/gi,
    replacement: 'Overall, ',
    register: 'formal',
  },
  {
    // Formal register: drop the robotic connective, keep the sentence.
    pattern: /(?:^|(?<=[.!?]\s))(?:Furthermore|Moreover|Additionally),\s*([a-z])/gm,
    replacement: (_m: string, c: string) => c.toUpperCase(),
    register: 'formal',
  },
  {
    pattern: /\bFurthermore,?\s*/gi,
    replacement: 'Also, ',
    register: 'casual',
  },
  {
    pattern: /\bMoreover,?\s*/gi,
    replacement: 'Plus, ',
    register: 'casual',
  },
  {
    pattern: /\bAdditionally,?\s*/gi,
    replacement: 'In addition, ',
    register: 'casual',
  },

  // --- Stiff-phrase simplifications (meaning-preserving in every register) ---
  { pattern: /\bdue to the fact that\b/gi, replacement: 'because', register: 'formal' },
  { pattern: /\bdespite the fact that\b/gi, replacement: 'although', register: 'formal' },
  { pattern: /\bin order to\b/gi, replacement: 'to', register: 'formal' },
  { pattern: /\bat this point in time\b/gi, replacement: 'now', register: 'formal' },
  { pattern: /\bfor the purpose of\b/gi, replacement: 'for', register: 'formal' },
  { pattern: /\bwith regard to\b/gi, replacement: 'regarding', register: 'formal' },
  { pattern: /\bin reference to\b/gi, replacement: 'about', register: 'formal' },
  { pattern: /\btake into consideration\b/gi, replacement: 'consider', register: 'formal' },
  { pattern: /\bmake a decision\b/gi, replacement: 'decide', register: 'formal' },
  { pattern: /\bprovide assistance to\b/gi, replacement: 'help', register: 'formal' },
  { pattern: /\bperform an analysis of\b/gi, replacement: 'analyze', register: 'formal' },
  { pattern: /\bexhibits a tendency to\b/gi, replacement: 'tends to', register: 'formal' },
  { pattern: /\bat your earliest convenience\b/gi, replacement: 'as soon as possible', register: 'formal' },
  { pattern: /\bprevious conversation\b/gi, replacement: 'earlier discussion', register: 'formal' },
  {
    pattern: /\bdo not hesitate to\b/gi,
    replacement: 'feel free to',
    register: 'casual',
  },

  // --- Buzzword de-inflation (verb agreement handled per form) ---
  { pattern: /\brevolutionized the way\b/gi, replacement: 'reshaped how', register: 'formal' },
  { pattern: /\brevolutionized\b/gi, replacement: 'transformed', register: 'formal' },
  { pattern: /\bunprecedented advancements\b/gi, replacement: 'rapid developments', register: 'formal' },
  { pattern: /\bunprecedented\b/gi, replacement: 'exceptional', register: 'formal' },
  { pattern: /\bdelves into\b/gi, replacement: 'examines', register: 'formal' },
  { pattern: /\bdelve into\b/gi, replacement: 'examine', register: 'formal' },
  { pattern: /\bdelving into\b/gi, replacement: 'examining', register: 'formal' },
  { pattern: /\boptimi[sz]e their operations\b/gi, replacement: 'refine their operations', register: 'formal' },
  { pattern: /\boptimi[sz]e\b/gi, replacement: 'refine', register: 'formal' },
  { pattern: /\bplays a (?:crucial|vital|pivotal|key) role in\b/gi, replacement: 'is central to', register: 'formal' },
  { pattern: /\bplay a (?:crucial|vital|pivotal|key) role in\b/gi, replacement: 'are central to', register: 'formal' },
  { pattern: /\bhas the potential to\b/gi, replacement: 'can', register: 'formal' },
  { pattern: /\bmultifaceted\b/gi, replacement: 'complex', register: 'formal' },
  { pattern: /\bin modern times\b/gi, replacement: 'today', register: 'formal' },
  { pattern: /\bin today's world\b/gi, replacement: 'today', register: 'formal' },
  { pattern: /\bin the contemporary landscape\b/gi, replacement: 'currently', register: 'formal' },
  { pattern: /\bin the modern era\b/gi, replacement: 'today', register: 'formal' },
  { pattern: /\bare capable of producing human-like text\b/gi, replacement: 'can generate human-grade prose', register: 'formal' },
  { pattern: /\bAI implementations\b/gi, replacement: 'AI deployments', register: 'formal' },

  // --- Correspondence (contraction-bearing; skipped for academic/technical) ---
  { pattern: /\bI am writing to follow up on\b/gi, replacement: "I'm following up on", register: 'casual' },
  { pattern: /\bI am writing to\b/gi, replacement: "I'm reaching out to", register: 'casual' },
  { pattern: /\bI would like to\b/gi, replacement: "I'd like to", register: 'casual' },
  { pattern: /\bwhen you are available\b/gi, replacement: "when you're free", register: 'casual' },
];

for (const [pattern, map] of SUFFIX_VERB_MAPS) {
  RULES.push({ pattern, replacement: suffixVerbReplacer(map), register: 'formal' });
}

// Case-sensitive contraction pairs (capital form listed separately so
// sentence-initial casing is preserved).
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bI am\b/g, "I'm"],
  [/\byou are\b/g, "you're"],
  [/\bthey are\b/g, "they're"],
  [/\bwe are\b/g, "we're"],
  [/\bdo not\b/g, "don't"],
  [/\bdoes not\b/g, "doesn't"],
  [/\bcannot\b/g, "can't"],
  [/\bwill not\b/g, "won't"],
  [/\bthere is\b/g, "there's"],
  [/\bthat is\b/g, "that's"],
  [/\bit is\b/g, "it's"],
];

/**
 * Last-resort variation for inputs where no rule matched: swap at most
 * `maxSwaps` unambiguous -ly adverbs using a single-word -> single-word map.
 * Adverb-to-adverb swaps cannot break agreement, and negation-adjacent
 * positions are skipped ("not particularly" would not survive "not notably").
 */
const ADVERB_VARIATION: Record<string, string> = {
  very: 'quite',
  really: 'genuinely',
  often: 'frequently',
  usually: 'typically',
  commonly: 'frequently',
  particularly: 'notably',
  extremely: 'highly',
  significantly: 'markedly',
  generally: 'broadly',
  currently: 'presently',
  rapidly: 'swiftly',
  carefully: 'thoughtfully',
  clearly: 'evidently',
  simply: 'merely',
  largely: 'mostly',
  widely: 'broadly',
  highly: 'markedly',
  substantially: 'considerably',
  considerably: 'substantially',
  frequently: 'regularly',
};

/** Adverb-to-adverb variation; walks tokens so negation checks see context. */
function applyAdverbVariationSafe(text: string, maxSwaps: number): string {
  const tokens = text.split(/(\s+)/);
  let swapped = 0;
  const out = tokens.map((token, i) => {
    if (swapped >= maxSwaps || !/^[a-z]+ly$/.test(token)) return token;
    const replacement = ADVERB_VARIATION[token];
    if (!replacement || replacement === token) return token;
    // Find the previous non-space token to check for negation.
    let j = i - 1;
    while (j >= 0 && !tokens[j].trim()) j--;
    const prev = (tokens[j] || '').toLowerCase().replace(/[^a-z']/g, '');
    if (/(not|never|no|nor|n't)$/.test(prev)) return token;
    swapped++;
    return replacement;
  });
  return out.join('');
}

/** Natural cadence: give uniform 12–22 word sentences an em-dash break. */
function applyCadence(s: string): string {
  const sentences = s.match(/[^.!?]+[.!?]+[\s]*/g) || [s];
  const adjusted = sentences.map((sent) => {
    const trimmed = sent.trim();
    const words = trimmed.split(/\s+/);
    if (words.length >= 12 && words.length <= 22 && !/[—()[\]]/.test(trimmed)) {
      if (/,\s*(?:and|allowing|helping|especially|particularly)\b/i.test(trimmed)) {
        return trimmed.replace(/,\s*(allowing|helping|especially|particularly)\b/i, ' — $1');
      }
    }
    return trimmed;
  });
  return adjusted.join(' ');
}

export interface HumanizeTransformOptions {
  style?: string | StylePreset;
  maxAdverbSwaps?: number;
}

/**
 * Apply the shared register-aware transform pass. Always grammar-safe; falls
 * back to the original text when nothing applies (the caller decides whether
 * an unchanged result is acceptable — this module never mangles to force a
 * difference).
 */
export function applyHumanizeTransforms(text: string, opts: HumanizeTransformOptions = {}): string {
  if (!text || !text.trim()) return text;
  const formal = isFormalStyle(opts.style);

  let s = text;
  for (const rule of RULES) {
    if (rule.register === 'casual' && formal) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s = s.replace(rule.pattern, rule.replacement as any);
  }

  if (!formal) {
    for (const [re, rep] of CONTRACTIONS) s = s.replace(re, rep);
  }

  s = applyCadence(s);

  if (s.trim().toLowerCase() === text.trim().toLowerCase()) {
    s = applyAdverbVariationSafe(s, opts.maxAdverbSwaps ?? 2);
  }

  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .trim();
}
