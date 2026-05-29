export interface GrammarIssue {
  type: 'grammar' | 'spelling' | 'punctuation' | 'phrasing';
  original: string;
  suggestion: string;
  explanation: string;
}

export interface GrammarCheckResult {
  issues: GrammarIssue[];
  correctedText: string;
  source: 'llm' | 'local-fallback';
}

const LOCAL_RULES: Array<{
  type: GrammarIssue['type'];
  pattern: RegExp;
  replacement: string | ((match: string, ...args: string[]) => string);
  explanation: string;
}> = [
  { type: 'spelling', pattern: /\bgrammer\b/gi, replacement: 'grammar', explanation: 'Corrects a common spelling mistake.' },
  { type: 'spelling', pattern: /\bbeofre\b/gi, replacement: 'before', explanation: 'Corrects a common spelling mistake.' },
  { type: 'spelling', pattern: /\beveryhting\b/gi, replacement: 'everything', explanation: 'Corrects a common spelling mistake.' },
  { type: 'grammar', pattern: /\bi\b/g, replacement: 'I', explanation: 'Capitalizes the first-person pronoun.' },
  { type: 'grammar', pattern: /\b([Tt])here is (\w+) (?:that|who|which) are\b/g, replacement: '$1here are $2 that are', explanation: 'Fixes subject-verb agreement.' },
  { type: 'grammar', pattern: /\b([Tt])here are (\w+) (?:that|who|which) is\b/g, replacement: '$1here is $2 that is', explanation: 'Fixes subject-verb agreement.' },
  { type: 'grammar', pattern: /\b([Hh]e|[Ss]he|[Ii]t) are\b/g, replacement: '$1 is', explanation: 'Uses the singular verb form with a singular subject.' },
  { type: 'grammar', pattern: /\b([Tt]hey|[Ww]e|[Yy]ou) is\b/g, replacement: '$1 are', explanation: 'Uses the plural verb form with a plural subject.' },
  { type: 'grammar', pattern: /\bdoes not has\b/gi, replacement: 'does not have', explanation: 'Uses the base verb after “does”.' },
  { type: 'grammar', pattern: /\bdid not (\w+)ed\b/gi, replacement: 'did not $1', explanation: 'Uses the base verb after “did”.' },
  { type: 'phrasing', pattern: /\bin order to\b/gi, replacement: 'to', explanation: 'Removes wordy phrasing.' },
  { type: 'phrasing', pattern: /\bdue to the fact that\b/gi, replacement: 'because', explanation: 'Replaces wordy phrasing with a clearer word.' },
  { type: 'punctuation', pattern: /\s+([,.;:!?])/g, replacement: '$1', explanation: 'Removes spaces before punctuation.' },
  { type: 'punctuation', pattern: /([,.;:!?])([^\s”’"')\]}])/g, replacement: '$1 $2', explanation: 'Adds a missing space after punctuation.' },
  { type: 'punctuation', pattern: /\s{2,}/g, replacement: ' ', explanation: 'Collapses repeated spaces.' },
];

function preserveCase(original: string, replacement: string): string {
  if (original.toUpperCase() === original) return replacement.toUpperCase();
  if (original[0]?.toUpperCase() === original[0]) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

function addIssue(issues: GrammarIssue[], type: GrammarIssue['type'], original: string, suggestion: string, explanation: string) {
  if (!original || original === suggestion) return;
  if (issues.some(issue => issue.original === original && issue.suggestion === suggestion)) return;
  issues.push({ type, original, suggestion, explanation });
}

function capitalizeSentenceStarts(text: string, issues: GrammarIssue[]): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (match, prefix: string, letter: string) => {
    const suggestion = `${prefix}${letter.toUpperCase()}`;
    addIssue(issues, 'punctuation', match, suggestion, 'Capitalizes the first letter of a sentence.');
    return suggestion;
  });
}

function ensureTerminalPunctuation(text: string, issues: GrammarIssue[]): string {
  const trimmed = text.trimEnd();
  if (!trimmed || /[.!?]$/.test(trimmed)) return text;
  addIssue(issues, 'punctuation', trimmed.slice(-30), `${trimmed.slice(-30)}.`, 'Adds missing terminal punctuation.');
  return `${trimmed}.`;
}

export function checkGrammarLocally(text: string): GrammarCheckResult {
  const issues: GrammarIssue[] = [];
  let correctedText = text;

  for (const rule of LOCAL_RULES) {
    correctedText = correctedText.replace(rule.pattern, (...args: string[]) => {
      const match = args[0];
      const raw = typeof rule.replacement === 'function'
        ? rule.replacement(match, ...args.slice(1, -2))
        : match.replace(rule.pattern, rule.replacement);
      const suggestion = typeof rule.replacement === 'string' && /^[a-z]+$/i.test(rule.replacement)
        ? preserveCase(match, raw)
        : raw;
      addIssue(issues, rule.type, match, suggestion, rule.explanation);
      return suggestion;
    });
  }

  correctedText = capitalizeSentenceStarts(correctedText, issues);
  correctedText = ensureTerminalPunctuation(correctedText, issues);

  return { issues: issues.slice(0, 50), correctedText, source: 'local-fallback' };
}

export function normalizeGrammarPayload(value: unknown, fallbackText: string, source: GrammarCheckResult['source'] = 'llm'): GrammarCheckResult | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  const rawIssues = Array.isArray(payload.issues) ? payload.issues : [];
  const issues = rawIssues
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === 'object')
    .map(issue => ({
      type: ['grammar', 'spelling', 'punctuation', 'phrasing'].includes(String(issue.type)) ? issue.type as GrammarIssue['type'] : 'grammar',
      original: String(issue.original || ''),
      suggestion: String(issue.suggestion || ''),
      explanation: String(issue.explanation || 'Suggested correction.'),
    }))
    .filter(issue => issue.original && issue.suggestion);

  return {
    issues,
    correctedText: typeof payload.correctedText === 'string' && payload.correctedText.trim() ? payload.correctedText : fallbackText,
    source,
  };
}

export function parseFirstJsonObject(raw: string): unknown | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw;
  const start = candidate.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) {
      try {
        return JSON.parse(candidate.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
