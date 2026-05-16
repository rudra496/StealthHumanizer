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
    assert.equal(result.stderr, "");
  });

  test("lists providers as structured JSON", async () => {
    const providers = parseJsonOutput(await runCli(["providers", "--json"]));
    const gemini = providers.find((provider) => provider.id === "gemini");
    const openai = providers.find((provider) => provider.id === "openai");

    assert.ok(Array.isArray(providers));
    assert.ok(providers.length >= 10);
    assert.equal(gemini.env, "GEMINI_API_KEY");
    assert.equal(gemini.free, true);
    assert.equal(gemini.defaultModel, "gemini-1.5-flash");
    assert.equal(openai.free, false);
    assert.equal(Object.hasOwn(gemini, "getApiKeyUrl"), true);
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
});
