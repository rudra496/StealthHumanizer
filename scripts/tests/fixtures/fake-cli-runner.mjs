#!/usr/bin/env node
// Fake Claude Code / Codex binary used by cli.test.mjs to exercise the
// subprocess provider path without requiring the real CLIs to be installed.
//
// Behavior is controlled by env vars set by the test:
//   FAKE_CLI_MODE=success       — emit a canned humanized paragraph on stdout
//   FAKE_CLI_MODE=codex-output  — write the canned reply to the path given by
//                                  -o <file> (mimics real Codex), plus some
//                                  banner-ish noise on stdout
//   FAKE_CLI_MODE=formatted      — emit a markdown-ish technical response with
//                                  blank lines and protected tokens
//   FAKE_CLI_MODE=fail          — write to stderr and exit 1
//   FAKE_CLI_MODE=echo-args     — emit the argv as JSON (for arg assertions)
//   FAKE_CLI_RECORD_FILE=<path> — append a JSON line per invocation with
//                                  { argv, stdin, stdinKind } for the test
//                                  to inspect

import { readFileSync, appendFileSync, writeFileSync, fstatSync } from "node:fs";

const mode = process.env.FAKE_CLI_MODE ?? "success";
const record = process.env.FAKE_CLI_RECORD_FILE;

function readStdinSync() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function classifyStdin() {
  try {
    const stat = fstatSync(0);
    // Node's child_process.spawn uses Unix domain socket pairs (not POSIX
    // FIFOs) on macOS for stdio: 'pipe'. On Linux it uses pipes. Treat both
    // as "pipe" — the semantic we care about is "data can flow in".
    if (stat.isFIFO() || stat.isSocket()) return "pipe";
    if (stat.isCharacterDevice()) {
      return process.stdin.isTTY ? "tty" : "char";
    }
    if (stat.isFile()) return "file";
    return "other";
  } catch {
    return "closed";
  }
}

const stdinKind = classifyStdin();
// Only attempt to read stdin if it's a pipe — reading from /dev/null is
// harmless but makes the test's intent ambiguous.
const stdin = stdinKind === "pipe" ? readStdinSync() : "";
const argv = process.argv.slice(2);

if (record) {
  appendFileSync(
    record,
    JSON.stringify({ argv, stdin, stdinKind }) + "\n",
    "utf8",
  );
}

const CANNED_REPLY =
  "This rewritten paragraph keeps its meaning intact. It reads naturally now.";
const FORMATTED_TECHNICAL_REPLY = `Verifier 0: binary integrity.

Before running anything, hash \`validator\` and \`bin/linux-x86_64/license_validator\`.

Reference hash: \`75d494fe14ad865b15a392c4d2317755a0ab771916ef53b78331d593cfc66193\`.
Version: Zig 0.15.2.`;

if (mode === "fail") {
  process.stderr.write("fake cli boom\n");
  process.exit(1);
}

if (mode === "echo-args") {
  process.stdout.write(JSON.stringify({ argv, stdin, stdinKind }));
  process.exit(0);
}

if (mode === "codex-output") {
  // Mimic Codex's `-o <file>` behavior: write the reply to the file argument
  // and put banner-ish noise on stdout (which the adapter should ignore).
  const outputFlagIdx = argv.indexOf("-o");
  if (outputFlagIdx === -1 || !argv[outputFlagIdx + 1]) {
    process.stderr.write("fake codex requires -o <file>\n");
    process.exit(1);
  }
  writeFileSync(argv[outputFlagIdx + 1], CANNED_REPLY + "\n", "utf8");
  process.stdout.write("[fake codex banner: would print logs here]\n");
  process.exit(0);
}

if (mode === "formatted") {
  process.stdout.write(FORMATTED_TECHNICAL_REPLY + "\n");
  process.exit(0);
}

// default ("success"): emit a canned, on-brand humanized paragraph
process.stdout.write(CANNED_REPLY + "\n");
