import { detectAI } from './detector';

const AI_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bFurthermore,?\s*/gi, ''],
  [/\bMoreover,?\s*/gi, 'Plus, '],
  [/\bAdditionally,?\s*/gi, 'And '],
  [/\bConsequently,?\s*/gi, 'So '],
  [/\bTherefore,?\s*/gi, 'So '],
  [/\bIn conclusion,?\s*/gi, 'The takeaway is '],
  [/\bIt is important to note that\s*/gi, 'Worth noting: '],
  [/\bplays? a (?:crucial|vital|significant|key) role in\b/gi, 'matters for'],
  [/\bfacilitates?\b/gi, 'helps'],
  [/\butilizes?\b/gi, 'uses'],
  [/\bleverages?\b/gi, 'uses'],
  [/\boptimi[sz]e\b/gi, 'improve'],
  [/\bcomprehensive\b/gi, 'thorough'],
  [/\bsignificant(?:ly)?\b/gi, 'real'],
  [/\bsubstantial(?:ly)?\b/gi, 'big'],
  [/\bvarious\b/gi, 'different'],
  [/\bnumerous\b/gi, 'many'],
  [/\brealm of\b/gi, 'area of'],
  [/\bdomain of\b/gi, 'area of'],
  [/\bwith remarkable efficiency\b/gi, 'pretty efficiently'],
  [/\bhas demonstrated\b/gi, 'has shown'],
  [/\bare able to\b/gi, 'can'],
];

const OPENERS = ['Honestly,', 'Look,', 'The thing is,', 'In practice,', 'For me,'];

export function splitIntoSentencesStable(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+[\s]*/g)?.map(s => s.trim()).filter(Boolean) || (text.trim() ? [text.trim()] : []);
}

export function parseRehumanizedLines(raw: string): string[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(s => s.length > 8);
    } catch {}
  }

  return raw
    .split('\n')
    .map(line => line
      .replace(/^\s*(?:[-*•]|\d+[.)]|["']?sentence\s*\d+["']?\s*[:.)-])\s*/i, '')
      .replace(/^['"]|['"]$/g, '')
      .trim())
    .filter(line => line.length > 8 && !/^here (?:are|is)\b/i.test(line));
}

function preserveEnding(original: string, rewritten: string): string {
  const end = original.trim().match(/[.!?]$/)?.[0] || '.';
  const clean = rewritten.trim().replace(/[.!?]+$/, '');
  return `${clean}${end}`;
}

function varySentenceShape(sentence: string, index: number): string {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  if (words.length > 24) {
    const cut = Math.max(8, Math.min(words.length - 6, Math.round(words.length * 0.55)));
    const first = words.slice(0, cut).join(' ');
    const second = words.slice(cut).join(' ');
    return `${first}. ${OPENERS[index % OPENERS.length].toLowerCase()} ${second}`;
  }

  if (words.length < 10 && !/[,—()]/.test(sentence)) {
    return `${OPENERS[index % OPENERS.length]} ${sentence.replace(/^./, c => c.toLowerCase())}`;
  }

  if (!/\b(?:I|we|you|honestly|look|basically|actually)\b/i.test(sentence)) {
    return `${OPENERS[index % OPENERS.length]} ${sentence.replace(/^./, c => c.toLowerCase())}`;
  }

  return sentence;
}

export function localRehumanizeSentence(sentence: string, index = 0): string {
  let rewritten = sentence.trim();
  for (const [pattern, replacement] of AI_PHRASE_REPLACEMENTS) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  rewritten = rewritten
    .replace(/\bThis (?:capability|development|approach|process)\b/gi, 'That')
    .replace(/\bThe (implementation|utilization|integration) of\b/gi, 'Using')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  rewritten = varySentenceShape(rewritten, index);
  rewritten = rewritten.replace(/^(Honestly,|Look,|The thing is,|In practice,|For me,)\s+([a-z])/, (_match, opener: string, letter: string) => `${opener} ${letter.toLowerCase()}`);
  rewritten = rewritten.replace(/,\s*,/g, ',').replace(/,\s+([.!?])/g, '$1');
  rewritten = rewritten.replace(/\b(can|will|should) not\b/gi, "$1n't");
  rewritten = rewritten.replace(/\bdo not\b/gi, "don't").replace(/\bdoes not\b/gi, "doesn't");
  return preserveEnding(sentence, rewritten);
}

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function scoreSentence(text: string): number {
  return detectAI(text).sentences[0]?.score ?? detectAI(text).score;
}

export function chooseImprovedRewrite(original: string, llmRewrite: string | undefined, index = 0): string {
  const fallback = localRehumanizeSentence(original, index);
  const originalScore = scoreSentence(original);
  const candidates = [llmRewrite, fallback]
    .filter((candidate): candidate is string => Boolean(candidate && candidate.trim().length > 8))
    .map(candidate => preserveEnding(original, candidate.trim()))
    .filter(candidate => normalized(candidate).toLowerCase() !== normalized(original).toLowerCase());

  if (candidates.length === 0) return fallback;

  return candidates
    .map(candidate => ({ candidate, score: scoreSentence(candidate) }))
    .sort((a, b) => {
      const aGain = a.score - originalScore;
      const bGain = b.score - originalScore;
      if (bGain !== aGain) return bGain - aGain;
      return b.score - a.score;
    })[0].candidate;
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
