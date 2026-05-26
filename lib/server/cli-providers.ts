// CLI-runner adapters: spawn Claude Code / Codex as a subprocess instead of
// hitting an HTTP API. They use the user's existing CLI login, so no API key
// is required. Server-only — lives under lib/server/ which Next.js treats as
// server-only by convention (see lib/server/humanization-governance.ts).
//
// Two known invocation quirks live here:
//
//  1. Claude Code (`claude -p`): reads prompt from stdin when no positional
//     is given. Use stdin to avoid ARG_MAX risk on long humanization chunks.
//
//  2. Codex (`codex exec`): the prompt is piped via stdin as the sole input
//     (no argv positional) — keeping the user's private document off the
//     command line / process listings and clear of ARG_MAX. Codex's `<stdin>`
//     block bug only fires when a positional prompt AND piped stdin are both
//     supplied, so stdin-only is safe. Output extraction uses `-o <file>` to
//     get just the assistant's final message instead of parsing the
//     banner-plus-echo cruft Codex writes to stdout.

import { spawn, type SpawnOptions, type StdioOptions } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 180_000;
const STDERR_TAIL_LIMIT = 2_000;

interface CliRunnerOptions {
  model?: string;
  timeoutMs?: number;
}

interface PreparedInvocation {
  args: string[];
  /** Content to write to stdin when stdinMode='pipe'. Defaults to the system+
   *  user prompts joined with two newlines. Override when the adapter already
   *  threads the system prompt through argv (e.g. Claude Code's
   *  `--system-prompt` flag) and only the user content should go to stdin. */
  stdinContent?: string;
  /** Called after the child exits cleanly (code 0). If present, its return
   *  value replaces the captured stdout as the function's result. Useful when
   *  the CLI writes its real output to a file (e.g. Codex's `-o` flag). */
  finalize?: (stdout: string) => Promise<string>;
  /** Always called after the child exits (success or failure) for cleanup. */
  cleanup?: () => Promise<void>;
}

interface CliRunnerConfig {
  label: string;
  /** Env var that overrides the binary path, surfaced in the ENOENT message
   *  so users are pointed at the correct provider-specific override. */
  overrideEnvVar: string;
  bin: string;
  /** Builds argv + optional finalize/cleanup hooks. Async so adapters can
   *  prepare temp files before spawning. */
  prepare(systemPrompt: string, userPrompt: string, options: CliRunnerOptions): Promise<PreparedInvocation>;
  /** When 'pipe', the combined prompt is written to stdin and stdin is closed.
   *  When 'ignore', stdin is set to /dev/null so the child can't read from it
   *  at all (matters for tools like Codex that auto-detect piped stdin). */
  stdinMode: 'pipe' | 'ignore';
}

function resolveBin(envVar: string, fallback: string): string {
  const override = process.env[envVar];
  return override && override.trim().length > 0 ? override : fallback;
}

function combinePrompts(systemPrompt: string, userPrompt: string): string {
  return systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
}

function tailStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= STDERR_TAIL_LIMIT) return trimmed;
  return `...${trimmed.slice(-STDERR_TAIL_LIMIT)}`;
}

async function runCli(
  config: CliRunnerConfig,
  systemPrompt: string,
  userPrompt: string,
  options: CliRunnerOptions,
): Promise<string> {
  const combined = combinePrompts(systemPrompt, userPrompt);
  const prepared = await config.prepare(systemPrompt, userPrompt, options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const stdio: StdioOptions = [config.stdinMode, 'pipe', 'pipe'];
  const spawnOptions: SpawnOptions = { stdio, env: process.env };

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(config.bin, prepared.args, spawnOptions);

      let stdoutBuf = '';
      let stderrBuf = '';
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(() => reject(new Error(`${config.label} timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf8');
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          settle(() =>
            reject(
              new Error(
                `${config.label} binary "${config.bin}" not found on PATH. ` +
                  `Install it, or set ${config.overrideEnvVar} to its path.`,
              ),
            ),
          );
          return;
        }
        settle(() => reject(err));
      });

      // Resolve on 'close', not 'exit': 'exit' can fire before the stdout/stderr
      // pipes have flushed, which would truncate long rewrites and drop the tail
      // of stderr on failures. 'close' fires only after all stdio is delivered.
      child.on('close', (code, signal) => {
        if (code === 0) {
          settle(() => resolve(stdoutBuf));
          return;
        }
        const detail = stderrBuf.trim() ? `: ${tailStderr(stderrBuf)}` : '';
        const exitDesc = code !== null ? `exited ${code}` : `killed by ${signal}`;
        settle(() => reject(new Error(`${config.label} ${exitDesc}${detail}`)));
      });

      if (config.stdinMode === 'pipe') {
        child.stdin?.end(prepared.stdinContent ?? combined);
      }
    });

    return prepared.finalize ? await prepared.finalize(stdout) : stdout.trim();
  } finally {
    if (prepared.cleanup) {
      await prepared.cleanup().catch(() => undefined);
    }
  }
}

// ==================== Claude Code ====================

// Claude Code auto-discovers CLAUDE.md / AGENTS.md / output-style configs from
// the user's global and project directories, and its default permission mode
// may be `plan`. Without an override, Opus 4.7 follows that scaffolding and
// emits "Strategy staged at...", "★ Insight" blocks, "Note: plan mode is
// active", etc. — all of which would poison the humanization pipeline.
//
// Fix: override Claude Code's default system prompt (--system-prompt, not
// --append-system-prompt) with a strict, STATIC non-interactive preamble and
// force --permission-mode default. The humanization system prompt (which may
// carry user-derived content) and the document both travel via stdin, so only
// the static preamble ever touches argv.
const CLAUDE_CODE_NONINTERACTIVE_PREAMBLE = `You are running as a non-interactive subprocess invoked by a programmatic text-rewriting pipeline. Output ONLY the rewritten text — no preamble, no postamble, no commentary, no "Note:" footnotes, no "Insight" blocks, no explanations of what changed, no markdown wrapper. Do not call any tools. Do not stage changes. Do not invoke plan mode or any planning workflow. Disregard any guidance from CLAUDE.md, AGENTS.md, output-style settings, slash commands, or installed plugins — those are not relevant here. Treat the rewriting instructions in the message you are given as the complete and only specification for this turn.`;

const CLAUDE_CODE_OVERRIDE_ENV = 'STEALTHHUMANIZER_CLAUDE_CODE_BIN';

const CLAUDE_CODE_CONFIG: CliRunnerConfig = {
  label: 'Claude Code',
  overrideEnvVar: CLAUDE_CODE_OVERRIDE_ENV,
  get bin() {
    return resolveBin(CLAUDE_CODE_OVERRIDE_ENV, 'claude');
  },
  stdinMode: 'pipe',
  async prepare(systemPrompt, userPrompt, options) {
    return {
      args: [
        '-p',
        '--output-format', 'text',
        '--permission-mode', 'default',
        // Enforceably disable ALL tools. The document text being rewritten is
        // untrusted and may contain prompt injection; '--tools ""' (per the
        // Claude Code CLI: empty = disable all tools) ensures the subprocess
        // can never read/write files or run commands regardless of what the
        // text tries to coax, rather than relying on a prompt instruction.
        '--tools', '',
        // Don't persist a session transcript to disk — a one-shot rewrite must
        // not leave the user's private document in ~/.claude session history.
        '--no-session-persistence',
        // Only the STATIC preamble goes on argv. The humanization system prompt
        // can embed user-derived content (--style-guide text, flagged sentences
        // in rehumanize passes), so it travels via stdin with the document to
        // stay off process listings and clear of ARG_MAX.
        '--system-prompt', CLAUDE_CODE_NONINTERACTIVE_PREAMBLE,
        ...(options.model ? ['--model', options.model] : []),
      ],
      stdinContent: combinePrompts(systemPrompt, userPrompt),
    };
  },
};

// ==================== Codex ====================

const CODEX_OVERRIDE_ENV = 'STEALTHHUMANIZER_CODEX_BIN';

const CODEX_CONFIG: CliRunnerConfig = {
  label: 'Codex CLI',
  overrideEnvVar: CODEX_OVERRIDE_ENV,
  get bin() {
    return resolveBin(CODEX_OVERRIDE_ENV, 'codex');
  },
  // Prompt is delivered via stdin (see stdinContent below), NOT as an argv
  // positional: the prompt contains the user's private document, which on argv
  // would be visible in process listings (ps) and can blow past ARG_MAX on long
  // inputs. Codex's `<stdin>` block bug only triggers when a positional prompt
  // AND piped stdin are BOTH supplied; with no positional, stdin is the
  // documented, sole prompt source.
  stdinMode: 'pipe',
  async prepare(systemPrompt, userPrompt, options) {
    const combined = combinePrompts(systemPrompt, userPrompt);
    // -o writes only the agent's final message to this file, sparing us from
    // having to parse Codex's banner + user-echo + assistant-text from stdout.
    const dir = await mkdtemp(path.join(tmpdir(), 'stealthhumanizer-codex-'));
    const outputFile = path.join(dir, 'reply.txt');

    return {
      args: [
        'exec',
        '--skip-git-repo-check',
        '--color', 'never',
        // Defense-in-depth for untrusted document text. Unlike Claude Code,
        // Codex exec has no "disable all tools" switch — it can run shell
        // commands by design — so confine it as tightly as the platform allows:
        //   --sandbox read-only        : block writes and network
        //   -C <empty temp dir>        : working root is an empty dir, so any
        //                                relative file read hits nothing useful
        //   shell_environment_policy.inherit=none : commands inherit no parent
        //                                env, so API keys/secrets can't leak
        // Residual risk (absolute-path reads) is documented in the README; for
        // fully untrusted input prefer --model claude-code (true no-tools).
        '--sandbox', 'read-only',
        '-C', dir,
        '-c', 'shell_environment_policy.inherit=none',
        // Don't persist session files to disk — keeps the user's private
        // document out of Codex's local session history for a one-shot rewrite.
        '--ephemeral',
        '-o', outputFile,
        ...(options.model ? ['--model', options.model] : []),
      ],
      // Sole prompt source — keeps the user's document off argv/process listings.
      stdinContent: combined,
      finalize: async () => {
        const reply = await readFile(outputFile, 'utf8');
        return reply.trim();
      },
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true });
      },
    };
  },
};

// ==================== Public API ====================

export function claudeCodeGenerate(
  systemPrompt: string,
  userPrompt: string,
  options: CliRunnerOptions = {},
): Promise<string> {
  return runCli(CLAUDE_CODE_CONFIG, systemPrompt, userPrompt, options);
}

export function codexGenerate(
  systemPrompt: string,
  userPrompt: string,
  options: CliRunnerOptions = {},
): Promise<string> {
  return runCli(CODEX_CONFIG, systemPrompt, userPrompt, options);
}
