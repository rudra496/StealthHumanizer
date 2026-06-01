import { RewriteLevel, StylePreset, TonePreset } from '@/lib/types';
import { postprocess } from '@/lib/postprocess';

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bit is important to note that\b/gi, 'notably'],
  [/\bin conclusion,?\b/gi, 'to wrap this up,'],
  [/\bfurthermore,?\b/gi, 'also,'],
  [/\bmoreover,?\b/gi, 'plus,'],
  [/\butilize\b/gi, 'use'],
  [/\bleverage\b/gi, 'use'],
  [/\brobust\b/gi, 'solid'],
  [/\bseamless\b/gi, 'smooth'],
  [/\bdelve into\b/gi, 'look at'],
  [/\btapestry\b/gi, 'mix'],
  [/\brealm\b/gi, 'area'],
  [/\bplays a crucial role\b/gi, 'matters'],
  [/\bcomprehensive\b/gi, 'thorough'],
];

function varySentence(sentence: string, index: number, level: RewriteLevel, tone: TonePreset): string {
  let output = sentence.trim();
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) output = output.replace(pattern, replacement);
  if (level === 'aggressive' || level === 'ninja') {
    output = output
      .replace(/\btherefore\b/gi, index % 2 === 0 ? 'so' : 'as a result')
      .replace(/\bhowever\b/gi, index % 2 === 0 ? 'but' : 'still')
      .replace(/\bdemonstrates\b/gi, 'shows')
      .replace(/\bfacilitates\b/gi, 'helps');
  }
  if ((tone === 'conversational' || tone === 'academic-casual') && index % 3 === 1 && !/^Honestly|In practice|Put simply/i.test(output)) {
    output = `In practice, ${output.charAt(0).toLowerCase()}${output.slice(1)}`;
  }
  return output;
}

export function localHumanizeText(
  text: string,
  options: { level?: RewriteLevel; style?: StylePreset; tone?: TonePreset } = {},
): string {
  const level = options.level ?? 'medium';
  const tone = options.tone ?? 'conversational';
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) ?? [text];
  const rewritten = sentences.map((sentence, index) => varySentence(sentence, index, level, tone)).join(' ');
  return postprocess(rewritten, { style: options.style, light: level === 'light' });
}
