import { StylePreset } from '@/lib/types';
import { postprocess } from '@/lib/postprocess';
import { splitIntoSentences } from '@/lib/text-utils';

interface LocalHumanizeOptions {
  style?: StylePreset;
  preserveParagraphs?: boolean;
}

interface RewriteRule {
  pattern: RegExp;
  replacements: string[];
  styles?: StylePreset[];
}

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
  { pattern: /\bdemonstrates\b/gi, replacements: ['shows', 'makes clear', 'points to'] },
  { pattern: /\bfacilitates\b/gi, replacements: ['helps', 'makes possible', 'supports'] },
  { pattern: /\boptimize\b/gi, replacements: ['improve', 'tune', 'make more efficient'] },
  { pattern: /\binnovative\b/gi, replacements: ['new', 'practical', 'fresh'] },
  { pattern: /\bcutting-edge\b/gi, replacements: ['newer', 'modern', 'current'] },
  { pattern: /\bpivotal\b/gi, replacements: ['key', 'central', 'major'] },
  { pattern: /\bintricate\b/gi, replacements: ['complex', 'detailed', 'involved'] },
  { pattern: /\bmultifaceted\b/gi, replacements: ['complex', 'varied', 'multi-part'] },
  { pattern: /\bsynergy\b/gi, replacements: ['teamwork', 'combined effort', 'collaboration'] },
  { pattern: /\bparadigm shift\b/gi, replacements: ['major change', 'new approach', 'shift in thinking'] },
  { pattern: /\bultimately\b/gi, replacements: ['in the end', 'finally', 'basically'] },
  { pattern: /\bfundamentally\b/gi, replacements: ['basically', 'at its core', 'essentially'] },
  { pattern: /\bunprecedented\b/gi, replacements: ['new', 'never seen before', 'unique'] },
  { pattern: /\btransformative\b/gi, replacements: ['major', 'game-changing', 'impactful'] },
  { pattern: /\bindispensable\b/gi, replacements: ['vital', 'necessary', 'crucial'] },
  { pattern: /\belucidate\b/gi, replacements: ['explain', 'clarify', 'show'] },
  { pattern: /\bunderscore\b/gi, replacements: ['highlight', 'stress', 'show'] },
  { pattern: /\bmeticulous\b/gi, replacements: ['careful', 'detailed', 'thorough'] },
  { pattern: /\bcognizant\b/gi, replacements: ['aware', 'mindful', 'knowing'] },
  // Contraction-bearing correspondence rules — informal registers only.
  // Applied per style so academic/technical text keeps its formal register.
  { pattern: /\bI am writing to follow up on\b/gi, replacements: ["I'm following up on"], styles: ['casual', 'creative', 'humanize', 'stealth', 'professional'] as StylePreset[] },
  { pattern: /\bI am writing to\b/gi, replacements: ["I'm reaching out to"], styles: ['casual', 'creative', 'humanize', 'stealth', 'professional'] as StylePreset[] },
  { pattern: /\bwhen you are available\b/gi, replacements: ["when you're free", "when you're available"], styles: ['casual', 'creative', 'humanize', 'stealth', 'professional'] as StylePreset[] },
  { pattern: /\bdo not hesitate to\b/gi, replacements: ["feel free to", "don't hesitate to"], styles: ['casual', 'creative', 'humanize', 'stealth', 'professional'] as StylePreset[] },
  { pattern: /\bprevious conversation\b/gi, replacements: ["earlier discussion", "earlier chat"] },
  { pattern: /\bat your earliest convenience\b/gi, replacements: ["as soon as possible", "at your convenience"] },
  // "X is a subset of Y that focuses on Z" — capture bounded to 1–3 words so
  // the subject match cannot swallow preceding clauses ("In modern computing,").
  { pattern: /\b([A-Z][a-zA-Z]*(?:\s+[A-Za-z]+){0,2}) is a subset of ([^,\.]+?) that focuses on\b/gi, replacements: ["As a branch of $2, $1 focuses on"] },
  { pattern: /\bimprove their accuracy over time\b/gi, replacements: ["boost accuracy over time"] },
  { pattern: /\bwithout being programmed to do so\b/gi, replacements: ["without explicit manual coding"] }
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

function applyPhraseRules(sentence: string, style: StylePreset, seed: number): string {
  let output = sentence;
  for (const rule of PHRASE_RULES) {
    if (rule.styles && !rule.styles.includes(style)) continue;
    // Pass the replacement as a plain string (not a callback): string
    // replacement interpolates $1/$2 group references, a callback would emit
    // them literally ("As a branch of $2, $1 focuses on ...").
    output = output.replace(rule.pattern, pick(rule.replacements, seed + output.length));
  }
  return output;
}

function softenOverconfidentClaims(sentence: string, seed: number): string {
  const hedges = ['often', 'in many cases', 'usually', 'for many teams'];
  return sentence
    .replace(/\b(always|guarantees|ensures)\b/gi, match => {
      const normalized = match.toLowerCase();
      if (normalized === 'always') return pick(hedges, seed);
      return normalized === 'guarantees' ? 'can support' : 'helps make';
    })
    .replace(/\bperfect\b/gi, 'strong')
    .replace(/\bunparalleled\b/gi, 'notable');
}

function varyOpening(sentence: string, index: number, _style: StylePreset, seed: number): string {
  // Only at stronger levels, only occasionally, and only with short connectors
  // that read naturally as a lead-in to an independent clause. Avoid quirky
  // openers ("Here is the thing,") that produce awkward comma splices.
  if (sentence.length < 70 || index % 4 !== 2) return sentence;
  if (/^(In practice|Put simply|Technically|Operationally|Overall|That means|Even so|That said|Still|In short|On balance)/i.test(sentence)) return sentence;
  const safeConnectors = ['In practice', 'Even so', 'That said', 'Still', 'In short', 'On balance'];
  const connector = pick(safeConnectors, seed + index);
  return `${connector}, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}

function splitLongSentence(sentence: string): string {
  if (sentence.length < 180) return sentence;
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
  const seed = hashText(`${sentence}:${index}:`);
  let humanized = applyPhraseRules(sentence.trim(), options.style, seed);
  humanized = softenOverconfidentClaims(humanized, seed);
  humanized = varyOpening(humanized, index, options.style, seed);
  humanized = splitLongSentence(humanized);
  return preserveTerminalSpacing(sentence, humanized);
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
    style: options.style ?? 'humanize',
    preserveParagraphs: options.preserveParagraphs ?? true,
  };
  const paragraphs = resolved.preserveParagraphs ? text.split(/(\n{2,})/) : [text];
  const rewritten = paragraphs
    .map((chunk, index) => /^\n+$/.test(chunk) ? chunk : rewriteParagraph(chunk, index, resolved))
    .join('');
  return postprocess(rewritten, { style: resolved.style, light: true });
}
