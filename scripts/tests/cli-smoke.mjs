#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function runCli(args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "bin/cli.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, OPENAI_API_KEY: "", GEMINI_API_KEY: "" },
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));

    if (typeof input === "string") {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function main() {
  const help = await runCli(["--help"]);
  assert.equal(help.code, 0, "help should exit with code 0");
  assert.match(help.stdout, /Usage:/, "help output should include usage");

  const pkgRaw = await readFile(path.resolve(process.cwd(), "package.json"), "utf8");
  const { version } = JSON.parse(pkgRaw);
  const ver = await runCli(["--version"]);
  assert.equal(ver.code, 0, "version should exit with code 0");
  assert.equal(ver.stdout.trim(), version, "version should match package.json");

  const positional = await runCli(["quick smoke text"]);
  assert.equal(positional.code, 1, "missing key should fail");
  assert.match(positional.stderr, /OPENAI_API_KEY is not set/, "missing key error should be shown");

  const inputFile = path.join(os.tmpdir(), `stealthhumanizer-cli-smoke-${Date.now()}.txt`);
  await writeFile(inputFile, "file input smoke text", "utf8");
  const fromFile = await runCli(["--input", inputFile]);
  assert.equal(fromFile.code, 1, "missing key with --input should fail after reading file");
  assert.match(fromFile.stderr, /OPENAI_API_KEY is not set/, "file input should reach api key validation");

  const fromStdin = await runCli([], { input: "stdin smoke text\n" });
  assert.equal(fromStdin.code, 1, "missing key with stdin should fail");
  assert.match(fromStdin.stderr, /OPENAI_API_KEY is not set/, "stdin input should reach api key validation");
}

main().catch((error) => {
  console.error(`[test:cli] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
