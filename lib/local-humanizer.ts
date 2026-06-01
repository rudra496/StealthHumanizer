import { RewriteLevel, StylePreset, TonePreset } from '@/lib/types';
import { postprocess } from '@/lib/postprocess';
import { splitIntoSentences } from '@/lib/text-utils';

interface LocalHumanizeOptions {
  level?: RewriteLevel;
  style?: StylePreset;
  tone?: TonePreset;
  preserveParagraphs?: boolean;
}

interface RewriteRule {
  pattern: RegExp;
  replacements: string[];
  levels?: RewriteLevel[];
  styles?: StylePreset[];
  tones?: TonePreset[];
}

const LEVEL_STRENGTH: Record<RewriteLevel, number> = {
  light: 1,
  medium: 2,
  aggressive: 3,
  ninja: 4,
};

const TONE_OPENERS: Partial<Record<TonePreset, string[]>> = {
  conversational: ['In practice', 'Put simply', 'Here is the thing'],
  'academic-casual': ['In practice', 'More plainly', 'At a practical level'],
  professional: ['In practical terms', 'Operationally', 'For teams'],
  analytical: ['From the evidence', 'Looking at the pattern', 'In context'],
  journalistic: ['On the ground', 'In real terms', 'For readers'],
  technical: ['Technically', 'At runtime', 'In implementation'],
};

const STYLE_CONNECTORS: Partial<Record<StylePreset, string[]>> = {
  academic: ['This matters because', 'The key point is', 'The evidence suggests'],
  professional: ['For teams, this means', 'The practical result is', 'That gives teams'],
  casual: ['That means', 'So', 'The useful part is'],
  creative: ['The effect is', 'What emerges is', 'The texture changes when'],
  technical: ['In implementation terms', 'At system level', 'The mechanism is'],
  humanize: ['That means', 'In practice', 'The useful part is'],
};

const PHRASE_RULES: RewriteRule[] = [
  { pattern: /\bit is important to note that\b/gi, replacements: ['notably', 'it is worth noting', 'the key point is'] },
  { pattern: /\bin conclusion,?\b/gi, replacements: ['to wrap this up,', 'overall,', 'in the end,'] },
  { pattern: /\bfurthermore,?\b/gi, replacements: ['also,', 'just as important,', 'beyond that,'] },
  { pattern: /\bmoreover,?\b/gi, replacements: ['plus,', 'along with that,', 'also,'] },
  { pattern: /\btherefore\b/gi, replacements: ['so', 'as a result', 'that is why'] },
  { pattern: /\bhowever\b/gi, replacements: ['but', 'still', 'even so'] },
  { pattern: /\butilize\b/gi, replacements: ['use'] },
  { pattern: /\bleverage\b/gi, replacements: ['use', 'draw on', 'make use of'] },
  { pattern: /\brobust\b/gi, replacements: ['solid', 'reliable', 'well-tested'] },
  { pattern: /\bseamless\b/gi, replacements: ['smooth', 'low-friction', 'easy to follow'] },
  { pattern: /\bdelve into\b/gi, replacements: ['look at', 'dig into', 'examine'] },
  { pattern: /\btapestry\b/gi, replacements: ['mix', 'pattern', 'set'] },
  { pattern: /\brealm\b/gi, replacements: ['area', 'field', 'space'] },
  { pattern: /\bplays a crucial role\b/gi, replacements: ['matters', 'is central', 'does important work'] },
  { pattern: /\bcomprehensive\b/gi, replacements: ['thorough', 'broad', 'complete'] },
  { pattern: /\bdemonstrates\b/gi, replacements: ['shows', 'makes clear', 'points to'], levels: ['aggressive', 'ninja'] },
  { pattern: /\bfacilitates\b/gi, replacements: ['helps', 'makes possible', 'supports'], levels: ['aggressive', 'ninja'] },
  { pattern: /\boptimize\b/gi, replacements: ['improve', 'tune', 'make more efficient'], levels: ['medium', 'aggressive', 'ninja'] },
  { pattern: /\binnovative\b/gi, replacements: ['new', 'practical', 'fresh'], levels: ['medium', 'aggressive', 'ninja'] },
  { pattern: /\bcutting-edge\b/gi, replacements: ['newer', 'modern', 'current'], levels: ['medium', 'aggressive', 'ninja'] },
];

function hashText(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(values: T[], seed: number): T {
  return values[seed % values.length];
}

function applyPhraseRules(sentence: string, level: RewriteLevel, style: StylePreset, tone: TonePreset, seed: number): string {
  let output = sentence;
  for (const rule of PHRASE_RULES) {
    if (rule.levels && !rule.levels.includes(level)) continue;
    if (rule.styles && !rule.styles.includes(style)) continue;
    if (rule.tones && !rule.tones.includes(tone)) continue;
    output = output.replace(rule.pattern, () => pick(rule.replacements, seed + output.length));
  }
  return output;
}

function softenOverconfidentClaims(sentence: string, seed: number): string {
  const hedges = ['often', 'in many cases', 'usually', 'for many teams'];
  return sentence
    .replace(/\b(always|never|guarantees|ensures)\b/gi, match => {
      const normalized = match.toLowerCase();
      if (normalized === 'always') return pick(hedges, seed);
      if (normalized === 'never') return 'rarely';
      return normalized === 'guarantees' ? 'can support' : 'helps make';
    })
    .replace(/\bperfect\b/gi, 'strong')
    .replace(/\bunparalleled\b/gi, 'notable');
}

function varyOpening(sentence: string, index: number, level: RewriteLevel, style: StylePreset, tone: TonePreset, seed: number): string {
  if (LEVEL_STRENGTH[level] < 3 || sentence.length < 70 || index % 3 === 0) return sentence;
  if (/^(In practice|Put simply|Here is the thing|Technically|Operationally|Overall|That means)/i.test(sentence)) return sentence;
  const openerPool = TONE_OPENERS[tone] ?? STYLE_CONNECTORS[style] ?? STYLE_CONNECTORS.humanize ?? ['In practice'];
  const opener = pick(openerPool, seed + index);
  return `${opener}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}

function splitLongSentence(sentence: string, level: RewriteLevel): string {
  if (LEVEL_STRENGTH[level] < 3 || sentence.length < 180) return sentence;
  const match = sentence.match(/^(.{80,}?)(,\s+(?:and|but|while|which|because)\s+)(.{60,})$/i);
  if (!match) return sentence;
  const first = match[1].trim().replace(/[;,:-]+$/, '');
  const second = match[3].trim();
  return `${first}. ${second.charAt(0).toUpperCase()}${second.slice(1)}`;
}

function preserveTerminalSpacing(original: string, rewritten: string): string {
  const trailing = original.match(/\s+$/)?.[0] ?? '';
  return `${rewritten.trim()}${trailing}`;
}

function rewriteSentence(sentence: string, index: number, options: Required<LocalHumanizeOptions>): string {
  const seed = hashText(`${sentence}:${index}:${options.level}:${options.style}:${options.tone}`);
  let output = sentence.trim();
  output = applyPhraseRules(output, options.level, options.style, options.tone, seed);
  output = softenOverconfidentClaims(output, seed);
  output = varyOpening(output, index, options.level, options.style, options.tone, seed);
  output = splitLongSentence(output, options.level);
  return preserveTerminalSpacing(sentence, output);
}

function rewriteParagraph(paragraph: string, paragraphIndex: number, options: Required<LocalHumanizeOptions>): string {
  const sentences = splitIntoSentences(paragraph);
  if (sentences.length === 0) return paragraph;
  let cursor = 0;
  const rebuilt: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const at = paragraph.indexOf(sentence, cursor);
    if (at >= cursor) rebuilt.push(paragraph.slice(cursor, at));
    rebuilt.push(rewriteSentence(sentence, paragraphIndex * 100 + i, options));
    cursor = at >= 0 ? at + sentence.length : cursor;
  }
  rebuilt.push(paragraph.slice(cursor));
  return rebuilt.join('');
}

export function localHumanizeText(text: string, options: LocalHumanizeOptions = {}): string {
  const resolved: Required<LocalHumanizeOptions> = {
    level: options.level ?? 'medium',
    style: options.style ?? 'humanize',
    tone: options.tone ?? 'conversational',
    preserveParagraphs: options.preserveParagraphs ?? true,
  };
  const paragraphs = resolved.preserveParagraphs ? text.split(/(\n{2,})/) : [text];
  const rewritten = paragraphs
    .map((chunk, index) => /^\n+$/.test(chunk) ? chunk : rewriteParagraph(chunk, index, resolved))
    .join('');
  return postprocess(rewritten, { style: resolved.style, light: resolved.level === 'light' });
}
