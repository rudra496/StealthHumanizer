#!/usr/bin/env tsx
/**
 * StealthHumanizer CLI — wraps the full 4-layer TypeScript humanization pipeline.
 *
 * Usage:
 *   echo "Your text" | npx tsx bin/cli.ts [options]
 *   npx tsx bin/cli.ts [options] "Your text here"
 *
 * Options:
 *   --level      light | medium | aggressive | ninja  (default: medium)
 *   --style      humanize | academic | casual | professional | creative | technical  (default: casual)
 *   --tone       conversational | academic-formal | academic-casual | journalistic |
 *                creative-writing | professional | technical | persuasive |
 *                storytelling | humorous | emotional | analytical | custom  (default: conversational)
 *   --model      gemini | openai | claude | groq | mistral | cohere | together |
 *                openrouter | cerebras | deepinfra | huggingface | cloudflare | zai  (default: openai)
 *   --language   BCP-47 language code  (default: en)
 *   --domain     academic domain hint (optional)
 *   --target     target humanness score 0-100  (default: 80)
 *   --style-guide path to a writing style guide file — sets tone to 'custom'
 *   --no-aggressive-synonyms  disable the context-blind synonym swap pass
 *   --json       output full JSON result instead of plain text
 *   --help       show this help
 *
 * API keys are read from environment variables:
 *   GROQ_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
 *   MISTRAL_API_KEY, COHERE_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY,
 *   CEREBRAS_API_KEY, DEEPINFRA_API_KEY, HUGGINGFACE_API_KEY,
 *   CLOUDFLARE_API_KEY, ZAI_API_KEY
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { humanizeText } from '../lib/humanizer';
import type { HumanizationOptions, ModelProvider, RewriteLevel, StylePreset, TonePreset } from '../lib/types';

type CliOptions = {
  text: string | null;
  inputPath?: string;
  outputPath?: string;
  level: RewriteLevel;
  style: StylePreset;
  tone: TonePreset;
  customTone?: string;
  model: ModelProvider;
  language: string;
  domain?: string;
  targetScore: number;
  aggressiveSynonyms: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
};

const HELP_TEXT = `StealthHumanizer CLI

Usage:
  stealthhumanizer [options] [text]
  stealth-humanize [options] [text]
  echo "Your text" | stealthhumanizer [options]

Options:
  -i, --input <file>         Read input text from a file
  -o, --output <file>        Write output text to a file (stdout by default)
      --level <value>        light | medium | aggressive | ninja (default: medium)
      --style <value>        humanize | academic | casual | professional | creative | technical (default: casual)
      --tone <value>         conversational | academic-formal | academic-casual | journalistic |
                             creative-writing | professional | technical | persuasive |
                             storytelling | humorous | emotional | analytical | custom (default: conversational)
      --model <value>        gemini | openai | claude | groq | mistral | cohere | together |
                             openrouter | cerebras | deepinfra | huggingface | cloudflare | zai (default: openai)
      --language <code>      BCP-47 language code (default: en)
      --domain <text>        Academic domain hint (optional)
      --target <0-100>       Target humanness score (default: 80)
      --style-guide <file>   Path to writing style guide file (sets tone to custom)
      --no-aggressive-synonyms
      --json                 Output full JSON result
  -h, --help                 Show help
  -v, --version              Show version
`;

// ── env var map ──────────────────────────────────────────────────────────────
const API_KEY_ENV: Record<ModelProvider, string> = {
  groq:        'GROQ_API_KEY',
  openai:      'OPENAI_API_KEY',
  claude:      'ANTHROPIC_API_KEY',
  gemini:      'GEMINI_API_KEY',
  mistral:     'MISTRAL_API_KEY',
  cohere:      'COHERE_API_KEY',
  together:    'TOGETHER_API_KEY',
  openrouter:  'OPENROUTER_API_KEY',
  cerebras:    'CEREBRAS_API_KEY',
  deepinfra:   'DEEPINFRA_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  cloudflare:  'CLOUDFLARE_API_KEY',
  zai:         'ZAI_API_KEY',
};

// ── arg parser ───────────────────────────────────────────────────────────────
function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const opts = {
    text: null as string | null,
    inputPath: undefined as string | undefined,
    outputPath: undefined as string | undefined,
    level: 'medium' as RewriteLevel,
    style: 'casual' as StylePreset,
    tone: 'conversational' as TonePreset,
    customTone: undefined as string | undefined,
    model: 'openai' as ModelProvider,
    language: 'en',
    domain: undefined as string | undefined,
    targetScore: 80,
    aggressiveSynonyms: true,
    json: false,
    help: false,
    version: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--version' || a === '-v') {
      opts.version = true;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--no-aggressive-synonyms') {
      opts.aggressiveSynonyms = false;
    } else if (a === '--input' || a === '-i') {
      const val = args[++i];
      if (!val) { process.stderr.write(`Missing value for ${a}\n`); process.exit(1); }
      opts.inputPath = val;
    } else if (a === '--output' || a === '-o') {
      const val = args[++i];
      if (!val) { process.stderr.write(`Missing value for ${a}\n`); process.exit(1); }
      opts.outputPath = val;
    } else if (a === '--level' || a === '--style' || a === '--tone' || a === '--model' ||
               a === '--language' || a === '--domain' || a === '--target' || a === '--style-guide') {
      const val = args[++i];
      if (!val) { process.stderr.write(`Missing value for ${a}\n`); process.exit(1); }
      if (a === '--level')       opts.level = val as RewriteLevel;
      if (a === '--style')       opts.style = val as StylePreset;
      if (a === '--tone')        opts.tone = val as TonePreset;
      if (a === '--model')       opts.model = val as ModelProvider;
      if (a === '--language')    opts.language = val;
      if (a === '--domain')      opts.domain = val;
      if (a === '--target')      opts.targetScore = parseInt(val, 10);
      if (a === '--style-guide') {
        opts.customTone = readFileSync(val, 'utf8');
        opts.tone = 'custom';
      }
    } else if (!a.startsWith('-')) {
      positional.push(a);
    } else {
      process.stderr.write(`Unknown option: ${a}\n`);
      process.exit(1);
    }
  }

  if (positional.length > 0 && opts.inputPath) {
    process.stderr.write('Error: provide text either as argument or via --input, not both\n');
    process.exit(1);
  }

  if (positional.length > 0) opts.text = positional.join(' ');
  return opts;
}

// ── read stdin ───────────────────────────────────────────────────────────────
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    process.stdout.write(HELP_TEXT + '\n');
    process.exit(0);
  }
  if (opts.version) {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    process.stdout.write(`${packageJson.version || '0.0.0'}\n`);
    process.exit(0);
  }

  // Resolve text
  const isStdinTTY = process.stdin.isTTY;
  let text = opts.text;
  if (!text && opts.inputPath) {
    try {
      text = readFileSync(opts.inputPath, 'utf8').trim();
    } catch {
      process.stderr.write(`Error: could not read input file: ${opts.inputPath}\n`);
      process.exit(1);
    }
  }
  if (!text) {
    if (isStdinTTY) {
      process.stderr.write('Error: provide text as argument, --input file, or via stdin\n');
      process.exit(1);
    }
    text = await readStdin();
  }

  if (!text) {
    process.stderr.write('Error: empty input\n');
    process.exit(1);
  }

  // Resolve API key
  const envVar = API_KEY_ENV[opts.model];
  const apiKey = process.env[envVar] || '';
  if (!apiKey) {
    process.stderr.write(`Error: ${envVar} is not set (required for --model ${opts.model})\n`);
    process.exit(1);
  }

  const options: HumanizationOptions = {
    level: opts.level,
    style: opts.style,
    tone: opts.tone,
    customTone: opts.customTone,
    model: opts.model,
    language: opts.language,
    targetScore: opts.targetScore,
    domain: opts.domain,
    aggressiveSynonyms: opts.aggressiveSynonyms,
  };

  const onProgress = (pass: number, maxPasses: number, message: string) => {
    process.stderr.write(`[${pass}/${maxPasses}] ${message}\n`);
  };

  try {
    const result = await humanizeText(text, options, apiKey, onProgress);

    if (opts.json) {
      const payload = JSON.stringify(result, null, 2) + '\n';
      if (opts.outputPath) {
        writeFileSync(opts.outputPath, payload, 'utf8');
      } else {
        process.stdout.write(payload);
      }
    } else {
      const payload = result.fullText + '\n';
      if (opts.outputPath) {
        writeFileSync(opts.outputPath, payload, 'utf8');
      } else {
        process.stdout.write(payload);
      }
      process.stderr.write(
        `\n✓ Done — score: ${result.finalScore}% human | passes: ${result.passes} | ` +
        `words: ${result.wordCount.input}→${result.wordCount.output} | model: ${result.modelName}\n`
      );
    }
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
