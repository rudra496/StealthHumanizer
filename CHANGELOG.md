# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed — current models for every provider

Model lists and defaults now point at models that exist as of October 2026
(checked against each provider's docs or public model list). Retired IDs that
returned 404s are gone: Gemini 2.0, Cerebras Llama 3.1, DeepInfra/NVIDIA Llama 3,
Groq Compound, Mistral Nemo, Cohere `command-light`, the old Cloudflare Llama 3
models, and Fireworks' placeholder `default`.

New defaults: OpenAI `gpt-6-luna`, Claude `claude-sonnet-5-5` (Opus 5.5 stays
available in the list; the default rewrite model shouldn't be the flagship),
Gemini `gemini-3.5-flash-lite`, Mistral `mistral-small-latest`,
Together/OpenRouter DeepSeek V4.1 Flash, Cerebras `qwen-3.8-27b`, Z.ai
`glm-5.3-flash`, Codex CLI `gpt-6.1-sol` (GPT-5.5 left Codex for ChatGPT
sign-in on 2026-10-14).

### Fixed

- OpenAI GPT-5/6 and o-series: send `max_completion_tokens` and the lowest
  `reasoning_effort` each model accepts; only send temperature/top_p when
  reasoning is `none`.
- Claude Opus 4.7+, Sonnet/Haiku 5.x: drop temperature/top_p (rejected) and use
  `output_config.effort: low`; older Claude models get temperature only. A
  `refusal` stop reason now raises instead of returning empty text.
- Gemini 3.x/4: use `thinkingLevel` instead of `thinkingBudget`, and stop
  sending ignored sampling params.
- Reasoning-by-default open models (Qwen 3.x, DeepSeek V4, GLM 5, gpt-oss,
  Gemma 4) get each host's switch to turn reasoning off or down, plus output
  headroom where it can't be turned off.
- HuggingFace moved to `router.huggingface.co` (the old Inference API host no
  longer resolves). Cloudflare uses the Workers AI OpenAI-compatible endpoint,
  so every text model's reply parses. Cohere moved to Chat v2.
- OpenCode moved to the `/inference/...` base URLs; OpenCode Go requests send the
  required `x-opencode-session` header.
- The fetch host allowlist (and CSP `connect-src`) was missing Perplexity,
  Fireworks, NVIDIA NIM, OpenCode, Codebuff, Command Code and other configured
  providers, so their requests failed before being sent.
- Per-host request tweaks (Groq token caps, OpenAI reasoning params, Cerebras
  token param, OpenRouter referer) now match the exact URL hostname instead of
  substring checks (CodeQL js/incomplete-url-substring-sanitization).

## [2.4.2] - 2026-07-04

### Changed — sub-1B specialized humanizer for short text

After a deeper HuggingFace audit + on-VPS testing of every candidate, swapped
the short-text backend from Qwen2.5-0.5B (general instruct) to
**`cive202/humanize-ai-text-bart-large`** (BART, 406M params).

- Peer-reviewed paper (Paneru 2026, "Make it Sound like Human")
- BERTScore 0.924 on test set — measurable fidelity, not marketing
- 25,140 training pairs with document-disjoint splits
- MIT license, updated April 2026
- The ONLY sub-1B specialized humanizer that ACTUALLY preserves length + facts
  on real inputs (verified on 84-word + 319-word test cases)

Auto-routing by input word count:
- ≤150 words → cive202 BART (sub-1B, 5–12s, faithful)
- >150 words → Ollama gemma3:4b (4B, 25–90s, only faithful option for long form)

Why the swap: Qwen2.5-0.5B worked on short text but hallucinated fake awards
and publications on long inputs ("Euratom Medal of the Russian Federation",
invented grants, etc.). Ateeqq/Text-Rewriter-Paraphraser produced garbage
tokens. amicus summarized. No sub-1B model is faithful on long text — cive202
BART-large is the only one that works on short, gemma3:4b is the only one
that works on long. Auto-routing was the honest compromise.

## [2.4.1] - 2026-07-04

### Changed — swapped humanizer backend to gemma3:4b

The first version of Rudra's Free Usage Model used `WhiteRoomProdigy/amicus-humanizer-v1-onnx`
(T5-base, 60M params). On real inputs it produced lossy, repetitive summaries
(84 words in → 19 words out, "scalable and maintainable" repeated in the same
sentence). The new backend is **Ollama `gemma3:4b`** with a 7-rule humanize
system prompt — faithful rewrites that preserve length, facts, names, and
structure. Same external API (no client change needed), same Oracle VPS, same
API keys.

- Latency: 1.2s → ~25s for a 100-word input (acceptable on free-tier ARM CPU).
- Quality: input 84 words → output 140 words, all facts preserved, detector
  score drops to ~6% AI probability on the humanized text.
- Free-tier footprint: stealth-models container dropped from 1.1 GB → 249 MB
  RAM because we no longer load the ONNX model in-process. The Python service
  now proxies `/humanize/` to Ollama over the docker bridge.

## [2.4.0] - 2026-07-04

### Added — Rudra's Free Usage Model (zero-config default)

- **New default provider: "Rudra's Free Usage Model."** The public Vercel
  deployment now ships with a pre-configured humanizer + detector pair hosted on
  the maintainer's free Oracle Cloud ARM VPS. No API key needed from the user —
  just paste text and click Humanize.
  - Humanizer: `WhiteRoomProdigy/amicus-humanizer-v1-onnx` (T5-base, 60M, ONNX INT8)
  - Detector: `fakespot-ai/roberta-base-ai-text-detection-v1` (RoBERTa-base, 125M)
- **Independent AI-detector verdict now shown below every humanize result.**
  After each successful humanize, the app automatically fires the hosted
  RoBERTa detector on the output and renders the verdict (Likely Human / Likely
  AI + AI probability) in a separate panel, distinct from the heuristic
  `finalScore`.
- **Server-side proxy module** (`lib/server/rudra-free.ts`) keeps the API keys
  in Vercel env vars (`RUDRA_HUMANIZER_API_KEY`, `RUDRA_DETECTOR_API_KEY`,
  `RUDRA_API_BASE_URL`). Keys never reach the browser bundle.
- **Settings UI** hides the API key field for Rudra's Free Usage Model and
  shows a "Pre-configured" notice instead.
- **Self-hosters** can opt out by setting `NEXT_PUBLIC_DEFAULT_PROVIDER=gemini`
  (or any other provider id). See `.env.example` for the full set of new vars.

### Notes

- The detector's verdict is intentionally shown as a separate panel rather than
  blended into the heuristic score — RoBERTa detectors have a known high
  false-positive rate on formal prose, so the two numbers measure different
  things.

## [2.3.0] - 2026-06-28

### Fixed — humanization quality overhaul

This release fixes the root causes of broken output: incomplete sentences,
grammar/punctuation errors, and over-casual rewrites that "changed everything."

- **Re-humanize prompt rewritten.** The old prompt instructed the model to inject
  casual openers ("Honestly,"), em-dashes, rhetorical questions, and to split every
  long sentence — which produced orphan fragments ("Honestly?", "But get this—?").
  The new prompt forbids fragments and disconnected interjections, demands complete,
  grammatical sentences, and preserves meaning, facts, and register.
- **Post-processing no longer creates orphan sentences.** `disruptFlow` previously
  spliced in standalone interjections ("Right.", "Funny enough.") and rhetorical
  questions as their own sentences. It now only softens stiff AI openers in place.
- **Em-dash stripping is now punctuation-aware.** "word—?" no longer becomes the
  broken "word,?"; trailing/leading and parenthetical dashes are all handled cleanly.
  Numeric ranges (2020–2025) are still preserved.
- **Sentence-start capitalization safety net.** A final `capitalizeSentenceStarts`
  pass restores correct casing after every transformation, with abbreviation guards.
- **Removed casing-mangling transforms.** The random semicolon-merge and the
  short-sentence-merge both lowercased the following word, which broke proper nouns
  and safety-critical phrasing ("Never share keys" → "and never share keys").
- **Collocations now use word boundaries.** "facilitate" no longer matches inside
  "facilitated" leaving "make easierd"; inflected words are left intact. Literal
  "..." placeholders that injected stray ellipses were removed.
- **`thing→stuff` and similar context-blind safe-synonym swaps removed.**
- **`injectHumanVoice` no longer breaks proper nouns** (removed the conjunction
  prepend that forced-lowercased the next word).
- **Empty-string AI-phrase replacements** (`in conclusion → ''`) that left dangling
  commas now produce clean transitions.

### Changed

- **Removed the GPTZero API scoring panel** from the UI. With no `GPTZERO_API_KEY`
  configured it only ever showed a local fallback, which was confusing. Detection
  still runs locally (Human Score, heatmap, readability); external checking is a
  one-click link to GPTZero, ZeroGPT, and Copyleaks for anyone who wants it.
- **Humanize is now a single pass by default.** The automatic multi-round
  "refine to 90%+" loop that ran after every humanize (up to 8 extra API calls,
  blocking, and silently copying to the clipboard) is gone. Refinement is opt-in
  via the "Refine further" button (bounded to 3 rounds, no silent clipboard write).
- **Simpler, more professional UI.** Collapsed Advanced options by default, replaced
  the redundant 7-card stats grid with a slim footer bar, cleaned emoji-heavy action
  labels, and grouped external detector links. The sentence diff folds stray
  fragments into the previous row instead of showing misleading pairings.

### Fixed — tooling / CI

- **`npm run lint` works again.** Next.js 16 removed `next lint`; switched to a
  flat ESLint 9 config (`eslint.config.mjs`) using the TypeScript-ESLint tooling
  bundled with `eslint-config-next` (FlatCompat hit a circular-structure bug with
  this version combo).
- **CLI runners work on Windows.** `cli-providers.ts` now spawns `.mjs`/`.js`
  runners through `node`, avoiding Windows `spawn EFTYPE` on shebang scripts.
- **Browser extension least-privilege.** Removed the redundant always-on
  `<all_urls>` content script (the web app already reads `?text=` itself); kept
  `activeTab` as the minimal permission for tab messaging.

## [2.2.0] - 2026-06-02

### Added

- Full CLI tool (`stealthhumanizer` / `stealth-humanize`) with `humanize`, `detect`,
  and `providers` commands. Supports stdin, file I/O, JSON output, all rewrite levels,
  styles, tones, languages, and domains.
- Two local CLI-runner providers (`claude-code`, `codex`) that use existing CLI logins
  instead of API keys — confined with disabled tools, read-only sandbox, and isolated
  working directories.
- Batch humanization API (`POST /api/humanize-batch`) for up to 20 texts concurrently
  with 3 parallel API calls.
- GPTZero API integration with local heuristic fallback for AI detection scoring.
- Grammar checking API (`POST /api/grammar`) with LLM-backed analysis and local fallback.
- Protected region extraction/restoration — code blocks, links, URLs, and mentions are
  preserved verbatim during humanization.
- Rehumanize API (`POST /api/rehumanize`) with regression guard that falls back to
  lighter rewrites when semantic drift is detected (Jaccard + n-gram overlap).
- Logistic regression human-likeness scorer (`POST /api/model-score`) with 11 text
  features.
- File upload with magic-byte validation for PDF (pdfjs-dist), DOCX (mammoth), and TXT
  extraction (max 10 MB).
- Standardized API error handling module (`lib/api-response.ts`) with consistent error
  response format across all routes.
- Shared text utilities module (`lib/text-utils.ts`) deduplicating sentence splitting
  and word counting.
- Unit test suites for detector engine (25+ tests), rate limiter, and input validation.
- CLI regression test suite (18 tests) with mocked provider fetch and fake CLI runners.
- SEO: JSON-LD structured data, FAQ schema, programmatic robots.txt and sitemap.xml.
- `.env.example` documenting all 15 provider API key variables plus CLI overrides.
- SECURITY.md supported versions table and responsible disclosure policy.
- Comprehensive troubleshooting guide (`docs/TROUBLESHOOTING.md`).
- GitHub issue templates for bug reports, feature requests, and API key issues.
- Release workflow for tag-based GitHub releases with changelog validation.

### Changed

- Security hardening: Content-Security-Policy headers, X-Frame-Options DENY, HSTS,
  X-Content-Type-Options nosniff, per-IP rate limiting (30 req/min default), SSRF
  prevention via Cloudflare account ID validation, XSS-safe error responses.
- API routes enforce CLI-only provider rejection — browser and serverless contexts
  cannot spawn `claude-code` or `codex` subprocesses.
- Detector calibrated with corpus-derived thresholds instead of static heuristics.
- Architecture doc updated to reflect current provider count and module structure.
- CLI binary path configurable via `STEALTHHUMANIZER_CLAUDE_CODE_BIN` and
  `STEALTHHUMANIZER_CODEX_BIN` environment variables.

### Fixed

- Performance: `detectAI()` no longer re-runs on every React render (useMemo fix).
- EPIPE crash on CLI stdin when child process exits early.
- PDF upload parsing stability (pdfjs-dist replacing pdf-parse).
- Score regressions in rehumanize loop — regression guard prevents semantic drift.
- pnpm-lock.yaml synced with package.json (dotenv dependency added).
- CI/CD workflow branch triggers updated for `master` branch.
- Client bundle crash from `node:fs` import in browser-targeted `style-model.ts`.
- LinkedIn URL corrected in `Footer.tsx`.

### Security

- Per-IP rate limiting on all API routes with configurable window.
- Input validation on all endpoints (length, type, format checks).
- File upload magic-byte validation prevents content-type spoofing.
- CLI runners confined: `claude-code` runs with `--tools ""` (all tools disabled);
  `codex` runs with `--sandbox read-only`, isolated directory, no env inheritance.
- SSRF prevention: Cloudflare account IDs validated as 32-char hex strings.
- API error responses sanitized to prevent information leakage.

## [2.1.0] - 2026-04-11

### Added

- Style-aware humanization engine calibrated from academic writing statistics
  (OpenAlex, 11 domains, 2018–2025).
- Style model capturing real human writing patterns: sentence length distribution
  (mean 20.5, median 20, stddev 9.4), burstiness (0.426), vocabulary diversity
  (69.4%), passive voice ratio (18.1%), transition word frequencies, and sentence
  starter distributions.
- Style-aware prompt builder that injects corpus-calibrated statistical targets
  directly into LLM rewrite prompts.
- Corpus-calibrated detection thresholds — dynamic baselines derived from real
  academic writing rather than hardcoded values.
- Corpus-aware post-processing engine for output refinement.
- Expanded collocation database with 50+ new AI phrase replacements (150+ total).
- Bulk paper download and ingestion pipeline (`scripts/papers/`).

### Changed

- Style model (`public/corpus-style-model.json`) now loads via `fetch()` for
  client-side compatibility (no `node:fs` in browser bundle).
- AI detector uses dynamic corpus-calibrated thresholds instead of static
  heuristics.

### Fixed

- LinkedIn URL corrected in `Footer.tsx`.
- CI/CD workflow branch triggers updated from `main` to `master`.
- Client bundle crash resolved by isolating `node:fs` usage from browser-targeted
  `style-model.ts`.
- Markdown lint configuration fixed for Quality workflow.

## [2.0.0] - 2026-03-31

### Added

- 13 AI provider support with configurable API keys
- 4 rewrite levels including multi-pass ninja mode
- 13 preset writing tones and style controls
- Integrated AI detection heuristic scoring
- Readability analysis layer (Flesch-Kincaid, Gunning Fog)
- PDF and DOCX file upload support
- Grammar check integration
- Multi-language humanization support
- Browser-first API key storage (no server-side persistence)
- Side-by-side humanizer/detector workflow
- Dark/light theme toggle
- Research pipeline scripts for benchmark and training
- Comprehensive docs site with GitHub Pages deployment

### Changed

- Major rewrite from initial prototype to production Next.js application
- Upgraded to Next.js 16, React 19, TypeScript 6
- Modernized CI with Node 20/22 matrix testing
- Overhauled UI with Tailwind CSS and glass-morphism design

### Security

- All user data (API keys, history) stored client-side only
- No server-side persistence of user prompts or outputs

## [1.0.0] - 2026-04-09

### Added

- Comprehensive governance and support documentation (`SUPPORT.md`, improved
  contribution/security policies).
- Professionalized GitHub community templates and automation (`CODEOWNERS`,
  Dependabot, workflow modernization).
- Structured Markdown docs information architecture under `docs/` for onboarding
  and usage.
- Release workflow for tag-based GitHub release publishing.

### Changed

- Overhauled `README.md` for professional onboarding, architecture overview, and
  policy links.
- Modernized CI and Pages workflows for `main` branch and clearer quality gates.
- Added repository hygiene baselines (`.editorconfig`, `.gitattributes`, refined
  `.gitignore`).

### Removed

- Removed duplicate root-level `FUNDING.yml` in favor of `.github/FUNDING.yml`.
