#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliPath = path.join(repoRoot, "dist/bin/cli.js");
const mockFetchPath = path.join(repoRoot, "scripts/tests/fixtures/mock-cli-fetch.mjs");
const fakeCliRunnerPath = path.join(repoRoot, "scripts/tests/fixtures/fake-cli-runner.mjs");
const providerEnvVars = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "TOGETHER_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPINFRA_API_KEY",
  "HUGGINGFACE_API_KEY",
  "CLOUDFLARE_API_KEY",
  "ZAI_API_KEY",
];

let tmpRoot;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stealthhumanizer-cli-"));
});

after(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

function testEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of providerEnvVars) delete env[key];

  Object.assign(env, extra);
  return env;
}

function withMockFetch(extra = {}) {
  const mockImport = `--import=${pathToFileURL(mockFetchPath).href}`;
  const priorNodeOptions = extra.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? "";
  return testEnv({
    ...extra,
    NODE_OPTIONS: [priorNodeOptions, mockImport].filter(Boolean).join(" "),
  });
}

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: options.env ?? testEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function assertSuccess(result) {
  assert.equal(result.code, 0, result.stderr);
}

function assertFailure(result) {
  assert.notEqual(result.code, 0, "Expected command to fail.");
}

function parseJsonOutput(result) {
  assertSuccess(result);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

describe("StealthHumanizer CLI", () => {
  test("prints the package version", async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
    const result = await runCli(["--version"]);

    assertSuccess(result);
    assert.equal(result.stdout.trim(), packageJson.version);
    assert.equal(result.stderr, "");
  });

  test("prints top-level and command-specific help", async () => {
    const topLevel = await runCli(["--help"]);
    assertSuccess(topLevel);
    assert.match(topLevel.stdout, /StealthHumanizer CLI/);
    assert.match(topLevel.stdout, /humanize\s+Rewrite text/);
    assert.match(topLevel.stdout, /detect\s+Score text/);
    assert.match(topLevel.stdout, /providers\s+List supported providers/);

    const detectHelp = await runCli(["help", "detect"]);
    assertSuccess(detectHelp);
    assert.match(detectHelp.stdout, /stealthhumanizer detect/);
    assert.match(detectHelp.stdout, /--report/);
    assert.doesNotMatch(detectHelp.stdout, /Humanization options/);
  });

  test("lists providers as a readable table", async () => {
    const result = await runCli(["providers"]);

    assertSuccess(result);
    assert.match(result.stdout, /Provider\s+Free\s+Env var\s+Default model\s+Name/);
    assert.match(result.stdout, /gemini\s+yes\s+GEMINI_API_KEY\s+gemini-1\.5-flash/);
    assert.match(result.stdout, /openai\s+no\s+OPENAI_API_KEY\s+gpt-4o/);
    assert.match(result.stdout, /claude-code\s+yes\s+\(cli\)/);
    assert.match(result.stdout, /codex\s+yes\s+\(cli\)/);
    assert.equal(result.stderr, "");
  });

  test("lists providers as structured JSON", async () => {
    const providers = parseJsonOutput(await runCli(["providers", "--json"]));
    const gemini = providers.find((provider) => provider.id === "gemini");
    const openai = providers.find((provider) => provider.id === "openai");
    const claudeCode = providers.find((provider) => provider.id === "claude-code");
    const codex = providers.find((provider) => provider.id === "codex");

    assert.ok(Array.isArray(providers));
    assert.ok(providers.length >= 10);
    assert.equal(gemini.env, "GEMINI_API_KEY");
    assert.equal(gemini.free, true);
    assert.equal(gemini.defaultModel, "gemini-1.5-flash");
    assert.equal(openai.free, false);
    assert.equal(Object.hasOwn(gemini, "getApiKeyUrl"), true);
    assert.equal(claudeCode.cliOnly, true);
    assert.equal(claudeCode.env, null);
    assert.equal(codex.cliOnly, true);
    assert.equal(codex.env, null);
  });

  test("scores text from --text with readable detector output", async () => {
    const result = await runCli([
      "detect",
      "--text",
      "Furthermore, it is important to note that this solution demonstrates the potential to optimize workflows.",
    ]);

    assertSuccess(result);
    assert.match(result.stdout, /Score: \d+% human \((human|mixed|ai)\)/);
    assert.match(result.stdout, /Metrics:/);
    assert.match(result.stdout, /AI phrase: "it is important to note"/);
    assert.equal(result.stderr, "");
  });

  test("scores stdin as detector JSON", async () => {
    const result = await runCli(["detect", "--json"], {
      input: "Furthermore, it is important to note that this solution demonstrates the potential to optimize workflows.",
    });
    const payload = parseJsonOutput(result);

    assert.equal(typeof payload.score, "number");
    assert.equal(payload.overallVerdict, "mixed");
    assert.equal(payload.sentences.length, 1);
    assert.ok(payload.sentences[0].issues.some((issue) => issue.includes("it is important to note")));
    assert.equal(typeof payload.readability.fleschKincaidGrade, "number");
  });

  test("writes detector output to a file and can include every sentence", async () => {
    const inputPath = path.join(tmpRoot, "draft.txt");
    const outputPath = path.join(tmpRoot, "detect-report.txt");
    await fs.writeFile(
      inputPath,
      "This paper explores the multifaceted impacts of automation. Furthermore, it is important to note that adoption can optimize workflows.",
    );

    const result = await runCli(["detect", "--input", inputPath, "--output", outputPath, "--sentences"]);
    const output = await fs.readFile(outputPath, "utf8");

    assertSuccess(result);
    assert.equal(result.stdout, "");
    assert.match(output, /Sentences:/);
    assert.match(output, /This paper explores the multifaceted impacts of automation/);
    assert.match(output, /Furthermore, it is important to note/);
  });

  test("prints detailed detector report output", async () => {
    const result = await runCli([
      "detect",
      "--report",
      "--text",
      "Furthermore, it is important to note that this solution demonstrates the potential to optimize workflows.",
    ]);

    assertSuccess(result);
    assert.match(result.stdout, /Most AI-like sentences:/);
    assert.match(result.stdout, /Detected AI phrases:/);
    assert.match(result.stdout, /Recommendations:/);
    assert.match(result.stdout, /Focus on rewriting the lowest-scoring sentence/);
  });

  test("fails cleanly for unknown options and invalid choices", async () => {
    const unknownOption = await runCli(["detect", "--bogus"]);
    assertFailure(unknownOption);
    assert.match(unknownOption.stderr, /Unknown option: --bogus/);
    assert.match(unknownOption.stderr, /Run "stealthhumanizer --help"/);

    const invalidProvider = await runCli([
      "humanize",
      "--text",
      "hello",
      "--api-key",
      "fake-key",
      "--model",
      "notaprovider",
    ]);
    assertFailure(invalidProvider);
    assert.match(invalidProvider.stderr, /Invalid --model: notaprovider/);
    assert.doesNotMatch(invalidProvider.stderr, /API key/);

    const invalidTarget = await runCli([
      "humanize",
      "--text",
      "hello",
      "--model",
      "gemini",
      "--api-key",
      "fake-key",
      "--target",
      "150",
    ]);
    assertFailure(invalidTarget);
    assert.match(invalidTarget.stderr, /Invalid --target: 150/);
  });

  test("fails before network calls when humanize has no API key", async () => {
    const result = await runCli(["humanize", "--text", "hello", "--model", "gemini"]);

    assertFailure(result);
    assert.match(result.stderr, /Missing API key for gemini/);
    assert.match(result.stderr, /GEMINI_API_KEY/);
    assert.equal(result.stdout, "");
  });

  test("humanizes text with mocked provider fetch and writes plain output", async () => {
    const outputPath = path.join(tmpRoot, "humanized.txt");
    const result = await runCli(
      [
        "humanize",
        "--text",
        "This generated paragraph needs a calmer rewrite.",
        "--model",
        "gemini",
        "--api-key",
        "fake-key",
        "--output",
        outputPath,
        "--quiet",
      ],
      { env: withMockFetch() },
    );
    const output = await fs.readFile(outputPath, "utf8");

    assertSuccess(result);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.match(output, /rewritten paragraph/i);
    assert.match(output, /meaning intact/i);
  });

  test("humanizes text as JSON and preserves option mapping", async () => {
    const styleGuidePath = path.join(tmpRoot, "style-guide.txt");
    await fs.writeFile(styleGuidePath, "Use plain, direct language with short paragraphs.");

    const result = await runCli(
      [
        "humanize",
        "--text",
        "Please rewrite this while preserving the link https://example.com.",
        "--model",
        "gemini",
        "--api-key-env",
        "CUSTOM_GEMINI_KEY",
        "--json",
        "--quiet",
        "--style",
        "academic",
        "--level",
        "light",
        "--language",
        "en-US",
        "--domain",
        "Computer Science",
        "--target",
        "77",
        "--style-guide",
        styleGuidePath,
        "--no-aggressive-synonyms",
      ],
      { env: withMockFetch({ CUSTOM_GEMINI_KEY: "fake-key" }) },
    );
    const payload = parseJsonOutput(result);

    assert.match(payload.fullText, /rewritten paragraph/i);
    assert.match(payload.fullText, /https:\/\/example\.com/);
    assert.equal(payload.model, "gemini");
    assert.equal(payload.options.style, "academic");
    assert.equal(payload.options.level, "light");
    assert.equal(payload.options.language, "en-US");
    assert.equal(payload.options.domain, "Computer Science");
    assert.equal(payload.options.targetScore, 77);
    assert.equal(payload.options.tone, "custom");
    assert.equal(payload.options.customTone, "Use plain, direct language with short paragraphs.");
    assert.equal(payload.options.aggressiveSynonyms, false);
  });

  test("humanizes via the claude-code CLI runner without an API key", async () => {
    const recordPath = path.join(tmpRoot, "claude-code-invocations.jsonl");
    const env = testEnv({
      STEALTHHUMANIZER_CLAUDE_CODE_BIN: fakeCliRunnerPath,
      FAKE_CLI_MODE: "success",
      FAKE_CLI_RECORD_FILE: recordPath,
    });

    const result = await runCli(
      [
        "humanize",
        "--text",
        "This generated paragraph needs a calmer rewrite.",
        "--model",
        "claude-code",
        "--quiet",
      ],
      { env },
    );

    assertSuccess(result);
    assert.match(result.stdout, /rewritten paragraph/i);
    assert.match(result.stdout, /meaning intact/i);

    // The fake binary records what it received. We expect at least one
    // invocation, prompt delivered via stdin (not argv), and the Claude
    // Code flag set we hand-rolled in the adapter.
    const lines = (await fs.readFile(recordPath, "utf8")).trim().split("\n");
    assert.ok(lines.length >= 1, "expected at least one fake-cli invocation");
    const first = JSON.parse(lines[0]);

    assert.equal(first.argv[0], "-p", "must use --print mode");
    const outputFmtIdx = first.argv.indexOf("--output-format");
    assert.ok(outputFmtIdx >= 0 && first.argv[outputFmtIdx + 1] === "text", "must request text output");

    // Default uses the 'opus' alias so the registry doesn't need a bump when
    // Anthropic ships new Opus versions.
    const modelIdx = first.argv.indexOf("--model");
    assert.ok(modelIdx >= 0, "must pass --model");
    assert.equal(first.argv[modelIdx + 1], "opus");

    // Regression guards for the Opus-4.7 agentic-preamble bug (2026-05-16):
    // permission-mode must be forced to 'default' to disable the user's plan
    // mode, and --system-prompt must replace the default system prompt with
    // an override that suppresses CLAUDE.md/AGENTS.md/Insight-block behavior.
    const permModeIdx = first.argv.indexOf("--permission-mode");
    assert.ok(permModeIdx >= 0, "must override --permission-mode");
    assert.equal(first.argv[permModeIdx + 1], "default");

    // Security: tools must be enforceably disabled (--tools "") so injected
    // instructions in the document text can't make Claude Code run commands.
    const toolsIdx = first.argv.indexOf("--tools");
    assert.ok(toolsIdx >= 0, "must pass --tools to disable tools");
    assert.equal(first.argv[toolsIdx + 1], "", "--tools must be empty to disable all tools");

    // Privacy: no session transcript persisted to disk.
    assert.ok(first.argv.includes("--no-session-persistence"), "must disable session persistence");
    // Only the STATIC preamble is on argv — it carries no user-derived text.
    const sysPromptIdx = first.argv.indexOf("--system-prompt");
    assert.ok(sysPromptIdx >= 0, "must override --system-prompt to suppress CLAUDE.md");
    assert.match(first.argv[sysPromptIdx + 1], /non-interactive subprocess/i);
    assert.match(first.argv[sysPromptIdx + 1], /Disregard any guidance from CLAUDE\.md/);

    // The document travels via stdin, never argv. The static preamble must NOT
    // leak into stdin (it stays on argv as the system prompt override).
    assert.ok(first.stdin.length > 0, "prompt + document should be delivered via stdin");
    assert.match(first.stdin, /This generated paragraph needs a calmer rewrite\./);
    assert.doesNotMatch(first.stdin, /non-interactive subprocess/i, "static preamble must stay on argv, not stdin");
    // Privacy regression guard: the document must never appear on argv.
    assert.ok(
      !first.argv.some((a) => /This generated paragraph needs a calmer rewrite\./.test(a)),
      "document text must NOT appear on argv",
    );
  });

  test("humanizes via the codex CLI runner with prompt on stdin", async () => {
    const recordPath = path.join(tmpRoot, "codex-invocations.jsonl");
    const env = testEnv({
      STEALTHHUMANIZER_CODEX_BIN: fakeCliRunnerPath,
      // FAKE_CLI_MODE=codex-output writes the canned response to the path
      // given by -o (matching how real Codex behaves) instead of stdout.
      FAKE_CLI_MODE: "codex-output",
      FAKE_CLI_RECORD_FILE: recordPath,
    });

    const result = await runCli(
      [
        "humanize",
        "--text",
        "This generated paragraph needs a calmer rewrite.",
        "--model",
        "codex",
        "--quiet",
      ],
      { env },
    );

    assertSuccess(result);
    assert.match(result.stdout, /rewritten paragraph/i);

    const lines = (await fs.readFile(recordPath, "utf8")).trim().split("\n");
    const first = JSON.parse(lines[0]);
    // Codex argv shape: exec --skip-git-repo-check --color never --sandbox read-only
    //   -C <dir> -c <cfg> -o <file> --model <id>   (NO positional prompt)
    assert.equal(first.argv[0], "exec");
    assert.ok(first.argv.includes("--skip-git-repo-check"), "must pass --skip-git-repo-check");
    assert.ok(first.argv.includes("--color"), "must pass --color");
    // Security: Codex must run in a read-only sandbox so untrusted document
    // text can't make it execute shell commands or write files.
    const sandboxIdx = first.argv.indexOf("--sandbox");
    assert.ok(sandboxIdx >= 0, "must pass --sandbox");
    assert.equal(first.argv[sandboxIdx + 1], "read-only", "Codex must use read-only sandbox");
    // Confinement: working root is an isolated dir and no parent env is inherited.
    const cdIdx = first.argv.indexOf("-C");
    assert.ok(cdIdx >= 0 && first.argv[cdIdx + 1], "Codex must set an isolated working root with -C");
    const cfgIdx = first.argv.indexOf("-c");
    assert.ok(cfgIdx >= 0, "Codex must pass a -c config override");
    assert.equal(first.argv[cfgIdx + 1], "shell_environment_policy.inherit=none", "Codex must not inherit parent env");
    // Privacy: no session files persisted to disk.
    assert.ok(first.argv.includes("--ephemeral"), "Codex must run ephemerally (no session persistence)");
    const outputFlagIdx = first.argv.indexOf("-o");
    assert.ok(outputFlagIdx >= 0, "must pass -o to capture clean output");
    assert.ok(first.argv[outputFlagIdx + 1], "must follow -o with a path");
    const modelFlagIdx = first.argv.indexOf("--model");
    assert.ok(modelFlagIdx >= 0, "must pass --model");
    assert.equal(first.argv[modelFlagIdx + 1], "gpt-5.5");
    // Privacy: the prompt (system + user document) must travel via stdin, NOT
    // argv — argv is visible in process listings and capped by ARG_MAX.
    assert.ok(
      !first.argv.some((a) => /This generated paragraph needs a calmer rewrite\./.test(a)),
      "user document must NOT appear on argv",
    );
    assert.equal(first.stdinKind, "pipe", "Codex prompt must be delivered via piped stdin");
    assert.match(first.stdin, /This generated paragraph needs a calmer rewrite\./);
  });

  test("surfaces the CLI runner's stderr when it exits non-zero", async () => {
    const env = testEnv({
      STEALTHHUMANIZER_CLAUDE_CODE_BIN: fakeCliRunnerPath,
      FAKE_CLI_MODE: "fail",
    });

    const result = await runCli(
      [
        "humanize",
        "--text",
        "Anything.",
        "--model",
        "claude-code",
        "--quiet",
      ],
      { env },
    );

    assertFailure(result);
    assert.match(result.stderr, /Claude Code exited 1/);
    assert.match(result.stderr, /fake cli boom/);
  });

  test("reports a missing binary clearly when ENOENT occurs", async () => {
    const env = testEnv({
      STEALTHHUMANIZER_CLAUDE_CODE_BIN: "/nonexistent/path/to/claude",
    });

    const result = await runCli(
      [
        "humanize",
        "--text",
        "Anything.",
        "--model",
        "claude-code",
        "--quiet",
      ],
      { env },
    );

    assertFailure(result);
    assert.match(result.stderr, /not found on PATH/);
    assert.match(result.stderr, /STEALTHHUMANIZER_CLAUDE_CODE_BIN/);
  });

  test("missing Codex binary names the Codex override, not the Claude one", async () => {
    const env = testEnv({
      STEALTHHUMANIZER_CODEX_BIN: "/nonexistent/path/to/codex",
    });

    const result = await runCli(
      ["humanize", "--text", "Anything.", "--model", "codex", "--quiet"],
      { env },
    );

    assertFailure(result);
    assert.match(result.stderr, /not found on PATH/);
    assert.match(result.stderr, /STEALTHHUMANIZER_CODEX_BIN/);
    assert.doesNotMatch(result.stderr, /STEALTHHUMANIZER_CLAUDE_CODE_BIN/);
  });

  test("CLI-runner provider does not require --api-key flag", async () => {
    // Regression: ensure the cliOnly branch in resolveApiKey actually short-
    // circuits the "Missing API key" error. We point at a nonexistent binary
    // so the spawn fails fast, but the error must NOT be about the API key.
    const env = testEnv({
      STEALTHHUMANIZER_CLAUDE_CODE_BIN: "/nonexistent/path/to/claude",
    });

    const result = await runCli(
      ["humanize", "--text", "Anything.", "--model", "claude-code", "--quiet"],
      { env },
    );

    assertFailure(result);
    assert.doesNotMatch(result.stderr, /Missing API key/);
  });
});
