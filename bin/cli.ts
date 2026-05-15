#!/usr/bin/env node
import 'dotenv/config';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { detectAI, getDetailedDetectionReport } from '../lib/detector';
import { humanizeText } from '../lib/humanizer';
import { getAvailableProvider, getProvider, PROVIDERS } from '../lib/providers';
import type { DetectionResult, HumanizationOptions, ModelProvider, RewriteLevel, StylePreset, TonePreset } from '../lib/types';

type Command = 'humanize' | 'detect' | 'providers';

interface ParsedCli {
  command: Command;
  commandExplicit: boolean;
  flags: Map<string, string | boolean>;
  positionals: string[];
}

const COMMANDS: readonly Command[] = ['humanize', 'detect', 'providers'];
const LEVELS: readonly RewriteLevel[] = ['light', 'medium', 'aggressive', 'ninja'];
const STYLES: readonly StylePreset[] = ['humanize', 'academic', 'casual', 'professional', 'creative', 'technical'];
const TONES: readonly TonePreset[] = [
  'academic-formal',
  'academic-casual',
  'journalistic',
  'creative-writing',
  'conversational',
  'professional',
  'technical',
  'persuasive',
  'storytelling',
  'humorous',
  'emotional',
  'analytical',
  'custom',
];
const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

const API_KEY_ENV: Record<ModelProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cohere: 'COHERE_API_KEY',
  together: 'TOGETHER_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  cloudflare: 'CLOUDFLARE_API_KEY',
  zai: 'ZAI_API_KEY',
};

const VALUE_FLAGS = new Set([
  'api-key',
  'api-key-env',
  'domain',
  'input',
  'language',
  'level',
  'model',
  'output',
  'style',
  'style-guide',
  'target',
  'text',
  'tone',
]);

const BOOLEAN_FLAGS = new Set([
  'help',
  'json',
  'no-aggressive-synonyms',
  'quiet',
  'report',
  'sentences',
  'version',
]);

const FLAG_ALIASES: Record<string, string> = {
  h: 'help',
  i: 'input',
  j: 'json',
  m: 'model',
  o: 'output',
  p: 'model',
  q: 'quiet',
  s: 'sentences',
  v: 'version',
};

class CliError extends Error {
  constructor(message: string, readonly showUsage = false) {
    super(message);
    this.name = 'CliError';
  }
}

function isCommand(value: string | undefined): value is Command {
  return value !== undefined && COMMANDS.includes(value as Command);
}

function normalizeFlagName(name: string): string {
  if (name === 'provider') return 'model';
  if (name === 'target-score') return 'target';
  return name;
}

function parseCli(argv: string[]): ParsedCli {
  const tokens = argv.slice(2);
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command: Command = 'humanize';
  let commandExplicit = false;

  if (tokens[0] === 'help') {
    flags.set('help', true);
    if (isCommand(tokens[1])) {
      command = tokens[1];
      commandExplicit = true;
    }
    return { command, commandExplicit, flags, positionals };
  }

  if (isCommand(tokens[0])) {
    command = tokens.shift() as Command;
    commandExplicit = true;
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === '--') {
      positionals.push(...tokens.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const equalsIndex = token.indexOf('=');
      const rawName = equalsIndex === -1 ? token.slice(2) : token.slice(2, equalsIndex);
      const name = normalizeFlagName(rawName);
      const inlineValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);

      if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, inlineValue === undefined ? true : inlineValue !== 'false');
        continue;
      }

      if (!VALUE_FLAGS.has(name)) {
        throw new CliError(`Unknown option: --${rawName}`, true);
      }

      const value = inlineValue ?? tokens[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError(`Missing value for --${rawName}`);
      }
      flags.set(name, value);
      continue;
    }

    if (token.startsWith('-') && token !== '-') {
      const alias = token.slice(1);
      const name = FLAG_ALIASES[alias];
      if (!name) {
        throw new CliError(`Unknown option: -${alias}`, true);
      }

      if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, true);
        continue;
      }

      const value = tokens[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError(`Missing value for -${alias}`);
      }
      flags.set(name, value);
      continue;
    }

    positionals.push(token);
  }

  return { command, commandExplicit, flags, positionals };
}

function flagString(parsed: ParsedCli, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function flagBoolean(parsed: ParsedCli, name: string): boolean {
  return parsed.flags.get(name) === true;
}

function validateChoice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) {
    throw new CliError(`Invalid ${label}: ${value}. Expected one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function parseTargetScore(value: string | undefined): number {
  if (value === undefined) return 80;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new CliError(`Invalid --target: ${value}. Expected a number from 0 to 100.`);
  }
  return Math.round(parsed);
}

function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, '../package.json'),
    path.resolve(__dirname, '../../package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (parsed.name === 'stealthhumanizer' && parsed.version) return parsed.version;
    } catch {
      // Ignore malformed package metadata and fall through to the next candidate.
    }
  }

  return 'unknown';
}

function readTextFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new CliError(`Input file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function resolveInputText(parsed: ParsedCli): Promise<string> {
  const explicitText = flagString(parsed, 'text');
  if (explicitText !== undefined) return explicitText;

  const inputPath = flagString(parsed, 'input');
  if (inputPath !== undefined) {
    return inputPath === '-' ? readStdin() : readTextFile(inputPath);
  }

  if (parsed.positionals.length > 0) {
    return parsed.positionals.join(' ');
  }

  if (process.stdin.isTTY !== true) {
    return readStdin();
  }

  throw new CliError('Provide text as an argument, with --text, with --input, or via stdin.', true);
}

function requireNonEmptyText(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').trim();
  if (!normalized) {
    throw new CliError('Input text is empty.');
  }
  return normalized;
}

function resolveProvider(parsed: ParsedCli): ModelProvider {
  const requestedProvider = flagString(parsed, 'model');
  if (requestedProvider !== undefined) {
    return validateChoice(requestedProvider, PROVIDER_IDS, '--model');
  }

  const envKeys: Record<string, string | undefined> = {};
  for (const provider of PROVIDERS) {
    envKeys[provider.id] = process.env[API_KEY_ENV[provider.id]];
  }

  return getAvailableProvider(envKeys) ?? 'gemini';
}

function resolveApiKey(parsed: ParsedCli, provider: ModelProvider): string {
  const explicitApiKey = flagString(parsed, 'api-key');
  if (explicitApiKey) return explicitApiKey;

  const envName = flagString(parsed, 'api-key-env') ?? API_KEY_ENV[provider];
  const apiKey = process.env[envName];
  if (!apiKey) {
    throw new CliError(`Missing API key for ${provider}. Set ${envName} or pass --api-key.`);
  }
  return apiKey;
}

function resolveHumanizationOptions(parsed: ParsedCli, provider: ModelProvider): HumanizationOptions {
  const styleGuidePath = flagString(parsed, 'style-guide');
  const customTone = styleGuidePath ? readTextFile(styleGuidePath) : undefined;

  return {
    level: validateChoice(flagString(parsed, 'level') ?? 'medium', LEVELS, '--level'),
    style: validateChoice(flagString(parsed, 'style') ?? 'casual', STYLES, '--style'),
    tone: customTone
      ? 'custom'
      : validateChoice(flagString(parsed, 'tone') ?? 'conversational', TONES, '--tone'),
    customTone,
    model: provider,
    targetScore: parseTargetScore(flagString(parsed, 'target')),
    language: flagString(parsed, 'language') ?? 'en',
    domain: flagString(parsed, 'domain'),
    aggressiveSynonyms: !flagBoolean(parsed, 'no-aggressive-synonyms'),
  };
}

function writeOutput(parsed: ParsedCli, content: string): void {
  const output = content.endsWith('\n') ? content : `${content}\n`;
  const outputPath = flagString(parsed, 'output');
  if (outputPath) {
    writeFileSync(outputPath, output, 'utf8');
    return;
  }
  process.stdout.write(output);
}

function formatSentence(sentence: string): string {
  return sentence.length > 120 ? `${sentence.slice(0, 117)}...` : sentence;
}

function humanizeMetricName(metric: string): string {
  return metric
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase());
}

function formatDetectionSummary(result: DetectionResult, includeSentences: boolean): string {
  const lines = [
    `Score: ${result.score}% human (${result.overallVerdict})`,
    `Confidence: ${result.confidenceInterval.lower}-${result.confidenceInterval.upper}`,
    `Readability: grade ${result.readability.fleschKincaidGrade}, ${result.readability.readingTimeMinutes} min read`,
    '',
    'Metrics:',
  ];

  for (const [metric, value] of Object.entries(result.analysis)) {
    lines.push(`  ${humanizeMetricName(metric)}: ${value}`);
  }

  const issueSentences = result.sentences
    .filter((sentence) => sentence.issues.length > 0)
    .slice(0, 5);

  if (issueSentences.length > 0) {
    lines.push('', 'Top sentence issues:');
    for (const sentence of issueSentences) {
      lines.push(`  [${sentence.classification} ${sentence.score}%] ${formatSentence(sentence.text)}`);
      lines.push(`    ${sentence.issues.join('; ')}`);
    }
  }

  if (includeSentences && result.sentences.length > 0) {
    lines.push('', 'Sentences:');
    for (const sentence of result.sentences) {
      lines.push(`  [${sentence.classification} ${sentence.score}%] ${sentence.text}`);
    }
  }

  return lines.join('\n');
}

function formatDetailedReport(text: string): string {
  const report = getDetailedDetectionReport(text);
  const lines = [
    `Score: ${report.overallScore}% human (${report.verdict})`,
    `Confidence: ${report.confidenceInterval.lower}-${report.confidenceInterval.upper}`,
    '',
    'Most AI-like sentences:',
  ];

  for (const sentence of report.topAiSentences) {
    lines.push(`  [${sentence.score}%] ${sentence.text}`);
    if (sentence.issues.length > 0) lines.push(`    ${sentence.issues.join('; ')}`);
  }

  if (report.foundAiPhrases.length > 0) {
    lines.push('', 'Detected AI phrases:');
    for (const phrase of report.foundAiPhrases.slice(0, 10)) {
      lines.push(`  ${phrase}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const recommendation of report.recommendations) {
      lines.push(`  ${recommendation}`);
    }
  }

  return lines.join('\n');
}

function formatProvidersJson(): string {
  const payload = PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    free: provider.free,
    defaultModel: provider.defaultModel,
    models: provider.models,
    env: API_KEY_ENV[provider.id],
    getApiKeyUrl: provider.getApiKeyUrl,
    docsUrl: provider.docsUrl,
  }));
  return JSON.stringify(payload, null, 2);
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - value.length));
}

function formatProvidersTable(): string {
  const rows = PROVIDERS.map((provider) => ({
    provider: provider.id,
    free: provider.free ? 'yes' : 'no',
    env: API_KEY_ENV[provider.id],
    defaultModel: provider.defaultModel,
    name: provider.name,
  }));

  const headers = {
    provider: 'Provider',
    free: 'Free',
    env: 'Env var',
    defaultModel: 'Default model',
    name: 'Name',
  };

  const widths = {
    provider: Math.max(headers.provider.length, ...rows.map((row) => row.provider.length)),
    free: Math.max(headers.free.length, ...rows.map((row) => row.free.length)),
    env: Math.max(headers.env.length, ...rows.map((row) => row.env.length)),
    defaultModel: Math.max(headers.defaultModel.length, ...rows.map((row) => row.defaultModel.length)),
  };

  const lines = [
    `${pad(headers.provider, widths.provider)}  ${pad(headers.free, widths.free)}  ${pad(headers.env, widths.env)}  ${pad(headers.defaultModel, widths.defaultModel)}  ${headers.name}`,
    `${'-'.repeat(widths.provider)}  ${'-'.repeat(widths.free)}  ${'-'.repeat(widths.env)}  ${'-'.repeat(widths.defaultModel)}  ----`,
  ];

  for (const row of rows) {
    lines.push(
      `${pad(row.provider, widths.provider)}  ${pad(row.free, widths.free)}  ${pad(row.env, widths.env)}  ${pad(row.defaultModel, widths.defaultModel)}  ${row.name}`,
    );
  }

  return lines.join('\n');
}

function mainHelp(): string {
  return `StealthHumanizer CLI

Usage:
  stealthhumanizer humanize [options] [text]
  stealthhumanizer detect [options] [text]
  stealthhumanizer providers [--json]
  stealthhumanizer [options] [text]

Commands:
  humanize    Rewrite text with the full humanization pipeline (default)
  detect      Score text with the built-in AI-signal detector
  providers   List supported providers and API key environment variables

Examples:
  stealthhumanizer detect --text "This paper explores the multifaceted impacts of..."
  echo "Draft text" | stealthhumanizer humanize --model gemini --level aggressive
  stealthhumanizer humanize --input draft.txt --output humanized.txt --style academic
  stealthhumanizer providers

Run "stealthhumanizer help humanize" for command options.`;
}

function humanizeHelp(): string {
  return `Usage:
  stealthhumanizer humanize [options] [text]
  stealthhumanizer [options] [text]

Input:
  --text <text>             Text to process
  -i, --input <path|->      Read text from a file or stdin

Output:
  -o, --output <path>       Write output to a file
  -j, --json                Write the full JSON result
  -q, --quiet               Hide progress and summary lines

Humanization options:
  -m, --model <provider>    Provider id (default: first configured env key, then gemini)
  --level <level>           light, medium, aggressive, ninja (default: medium)
  --style <style>           humanize, academic, casual, professional, creative, technical
  --tone <tone>             conversational, academic-formal, journalistic, technical, etc.
  --language <code>         BCP-47 language code (default: en)
  --domain <name>           Optional academic domain hint
  --target <0-100>          Target human score (default: 80)
  --style-guide <path>      File with custom writing guidance; sets tone to custom
  --no-aggressive-synonyms  Disable context-blind synonym swaps

API keys:
  --api-key <key>           Pass an API key directly
  --api-key-env <name>      Read the API key from a custom environment variable

Run "stealthhumanizer providers" to see provider ids and default env vars.`;
}

function detectHelp(): string {
  return `Usage:
  stealthhumanizer detect [options] [text]

Input:
  --text <text>             Text to score
  -i, --input <path|->      Read text from a file or stdin

Output:
  -o, --output <path>       Write output to a file
  -j, --json                Write JSON instead of a text summary
  -s, --sentences           Include every sentence in text output
  --report                  Include detailed issue and recommendation output`;
}

function providersHelp(): string {
  return `Usage:
  stealthhumanizer providers [--json]

Lists supported provider ids, default models, and API key environment variables.`;
}

function helpFor(command: Command): string {
  if (command === 'humanize') return humanizeHelp();
  if (command === 'detect') return detectHelp();
  return providersHelp();
}

async function runHumanize(parsed: ParsedCli): Promise<void> {
  const text = requireNonEmptyText(await resolveInputText(parsed));
  const provider = resolveProvider(parsed);
  const providerInfo = getProvider(provider);
  const apiKey = resolveApiKey(parsed, provider);
  const options = resolveHumanizationOptions(parsed, provider);
  const quiet = flagBoolean(parsed, 'quiet');

  const result = await humanizeText(text, options, apiKey, (pass, maxPasses, message) => {
    if (!quiet) process.stderr.write(`[${pass}/${maxPasses}] ${message}\n`);
  });

  if (flagBoolean(parsed, 'json')) {
    writeOutput(parsed, JSON.stringify(result, null, 2));
    return;
  }

  writeOutput(parsed, result.fullText);

  if (!quiet) {
    const outputPath = flagString(parsed, 'output');
    const destination = outputPath ? ` | output: ${outputPath}` : '';
    process.stderr.write(
      `\nDone: ${result.finalScore}% human | passes: ${result.passes} | words: ${result.wordCount.input} -> ${result.wordCount.output} | provider: ${providerInfo?.name ?? provider}${destination}\n`,
    );
  }
}

async function runDetect(parsed: ParsedCli): Promise<void> {
  const text = requireNonEmptyText(await resolveInputText(parsed));

  if (flagBoolean(parsed, 'json')) {
    const payload = flagBoolean(parsed, 'report') ? getDetailedDetectionReport(text) : detectAI(text);
    writeOutput(parsed, JSON.stringify(payload, null, 2));
    return;
  }

  const result = flagBoolean(parsed, 'report')
    ? formatDetailedReport(text)
    : formatDetectionSummary(detectAI(text), flagBoolean(parsed, 'sentences'));
  writeOutput(parsed, result);
}

function runProviders(parsed: ParsedCli): void {
  writeOutput(parsed, flagBoolean(parsed, 'json') ? formatProvidersJson() : formatProvidersTable());
}

async function main(): Promise<void> {
  const parsed = parseCli(process.argv);

  if (flagBoolean(parsed, 'version')) {
    process.stdout.write(`${readPackageVersion()}\n`);
    return;
  }

  if (flagBoolean(parsed, 'help')) {
    process.stdout.write(`${parsed.commandExplicit ? helpFor(parsed.command) : mainHelp()}\n`);
    return;
  }

  if (parsed.command === 'detect') {
    await runDetect(parsed);
    return;
  }

  if (parsed.command === 'providers') {
    runProviders(parsed);
    return;
  }

  await runHumanize(parsed);
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    process.stderr.write(`Error: ${error.message}\n`);
    if (error.showUsage) process.stderr.write('\nRun "stealthhumanizer --help" for usage.\n');
  } else {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
