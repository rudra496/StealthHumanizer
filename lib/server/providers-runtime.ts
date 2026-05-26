// Server-only provider dispatcher.
//
// Wraps lib/providers.ts's generateWithProvider with CLI-runner support.
// HTTP providers delegate to lib/providers.ts (same code path the browser
// uses for direct fetches in Settings/Humanizer). CLI runners (claude-code,
// codex) are handled here because spawning subprocesses requires Node and
// can't live in the browser-safe lib/providers.ts.
//
// Why a thin wrapper instead of fully owning execution: keeping the HTTP
// adapters in lib/providers.ts preserves the browser → provider direct call
// path that the "API keys never touch our server" privacy model relies on.

import { spawn } from 'node:child_process';
import {
  ModelProvider,
  isCliOnlyProvider,
  generateWithProvider as generateHttpProvider,
} from '../providers';
import { claudeCodeGenerate, codexGenerate } from './cli-providers';

interface GenerationOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  model?: string;
}

export async function generateWithProvider(
  provider: ModelProvider,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: GenerationOptions = {},
): Promise<string> {
  if (provider === 'claude-code') {
    const fullUserPrompt = `Text to humanize:\n\n${userPrompt}`;
    return claudeCodeGenerate(systemPrompt, fullUserPrompt, { model: options.model });
  }
  if (provider === 'codex') {
    const fullUserPrompt = `Text to humanize:\n\n${userPrompt}`;
    return codexGenerate(systemPrompt, fullUserPrompt, { model: options.model });
  }
  return generateHttpProvider(provider, apiKey, systemPrompt, userPrompt, options);
}

// Re-exported for convenience so server-only callers can import one module.
// generateAlternatives uses the HTTP-only generateWithProvider internally;
// it doesn't currently support CLI runners (alternatives are an HTTP-only
// feature surfaced in the web UI, not the CLI).
export { generateAlternatives, testApiKey } from '../providers';

/** Best-effort check that a CLI-runner binary is reachable. Spawns
 *  `<bin> --version` and looks for a zero exit. Returns false for non-CLI
 *  providers or when the binary isn't found. */
export async function testCliProvider(provider: ModelProvider): Promise<boolean> {
  if (!isCliOnlyProvider(provider)) return false;
  const bin = provider === 'claude-code'
    ? (process.env.STEALTHHUMANIZER_CLAUDE_CODE_BIN || 'claude')
    : (process.env.STEALTHHUMANIZER_CODEX_BIN || 'codex');
  return new Promise<boolean>((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
