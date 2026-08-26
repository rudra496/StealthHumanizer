<div align="center">

# StealthHumanizer

**Free, open-source AI text humanizer. No login. No limits.**

Transform AI-generated text into natural, human-like writing using multi-pass rewriting, style-aware processing, and statistical fingerprint disruption.

[![Try it Live](https://img.shields.io/badge/Try_it_Live-stealthhumanizer.vercel.app-black?logo=vercel&style=for-the-badge)](https://stealthhumanizer.vercel.app/)

[![GitHub stars](https://img.shields.io/github/stars/rudra496/StealthHumanizer?style=social)](https://github.com/rudra496/StealthHumanizer/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/rudra496/StealthHumanizer?style=social)](https://github.com/rudra496/StealthHumanizer/fork)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22118705.svg)](https://doi.org/10.5281/zenodo.22118705)
[![CI](https://github.com/rudra496/StealthHumanizer/actions/workflows/ci.yml/badge.svg)](https://github.com/rudra496/StealthHumanizer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Good First Issues](https://img.shields.io/github/issues/rudra496/StealthHumanizer/good%20first%20issue.svg)](https://github.com/rudra496/StealthHumanizer/labels/good%20first%20issue)

> **If this saves you money on paid humanizers, consider giving it a star -- it helps others find it.**

</div>

---

> **Try it now: [stealthhumanizer.vercel.app](https://stealthhumanizer.vercel.app/) -- paste AI text, click humanize. Done. Zero config: the public deployment ships with **Rudra's Free Usage Model** as the default.**

---

## Rudra's Free Usage Model

Starting with v2.4, the hosted app ships with a free, pre-configured model — **no API key needed from you.** Just paste text and click Humanize. **Auto-routing by input length** picks the best backend:

- **Short text (≤150 words)** → `cive202/humanize-ai-text-bart-large` (BART, 406M, sub-1B). Purpose-built humanizer backed by a peer-reviewed paper (Paneru 2026, BERTScore 0.924). Latency ~5–12s. Preserves length and facts on paragraphs, abstracts, social posts.
- **Long text (>150 words)** → `gemma3:4b` via Ollama (4B params). The only faithful option for full essays, LORs, dissertations. Latency ~25–90s on free ARM CPU. (No sub-1B model can faithfully rewrite long form — every alternative tested either summarized, hallucinated fake facts, or degraded into repetition.)
- **AI Detector**: `fakespot-ai/roberta-base-ai-text-detection-v1` (RoBERTa-base, 125M params) — runs automatically after every humanize and shows the verdict inline below the result.
- **Hosting**: maintainer's free Oracle Cloud ARM (Ampere A1) VPS. ~70ms detect.
- **Privacy**: your text goes straight from the Vercel frontend to the Oracle VPS over HTTPS. The API keys live in Vercel env vars and never reach the browser.

Want to use it on your own deployment? Set these three env vars (see `.env.example`):

```
RUDRA_API_BASE_URL=https://129-159-229-170.sslip.io
RUDRA_HUMANIZER_API_KEY=...
RUDRA_DETECTOR_API_KEY=...
```

Prefer a different default? Set `NEXT_PUBLIC_DEFAULT_PROVIDER=gemini` (or any other provider id).

> **Backend swap note (v2.4.0 → v2.4.1 → v2.4.2):**
> - v2.4.0 used `amicus-humanizer-v1-onnx` (T5, 60M) — produced lossy 19-word summaries. Swapped out.
> - v2.4.1 used `gemma3:4b` for everything — slow on short text.
> - v2.4.2 auto-routes: `cive202/humanize-ai-text-bart-large` (406M sub-1B specialized humanizer) for ≤150 words, `gemma3:4b` for long text. The only honest mapping of "fast sub-1B where safe, faithful larger model where required."

---

## What's new in 2.3

A focused quality + reliability pass. The headline change: **the output no longer breaks.**

- **Natural, complete sentences.** Rewrote the re-humanize prompt and removed the post-processing steps that injected orphan fragments ("Honestly?", "But get this—?"), mangled em-dashes into broken punctuation ("word—?" → "word,?"), and force-lowercased proper nouns. Every sentence is now grammatical and complete, with a final capitalization safety net.
- **Real human tone, less AI footprint.** Collocations now respect word boundaries (no more "make easierd"), context-blind swaps like `thing→stuff` are gone, and empty AI-phrase replacements no longer leave dangling commas.
- **GPTZero API scoring removed from the UI.** Without an API key it only showed a confusing local fallback — so detection stays local (Human Score, heatmap, readability) and external checks are one-click links to GPTZero, ZeroGPT, and Copyleaks.
- **Simpler, calmer UI.** Advanced options collapsed by default, the redundant stats grid replaced with a slim footer, cleaner action labels, and no more silent clipboard writes or runaway auto-refine loops. Refinement is now opt-in (button) and bounded.
- **`npm run lint` and the CLI runner work again** (Next 16 dropped `next lint`; flat ESLint 9 config added; Windows `.mjs` CLI spawn fixed).

See the [full changelog](./CHANGELOG.md#230---2026-06-28) for details.

---

## Why StealthHumanizer?

AI detectors (GPTZero, Originality.ai, CopyLeaks) catch AI text through statistical fingerprints:
- **Low perplexity** — predictable, boring word choices
- **Low burstiness** — uniform sentence lengths
- **AI-typical phrases** — "furthermore," "it is important to note," "delve into"
- **Rigid structure** — same paragraph pattern throughout

**StealthHumanizer disrupts all of these signals** with a 4-layer pipeline that produces text reading like a real person wrote it.

---

## Features

| Feature | Description |
|---------|-------------|
| **35 AI Providers** | Gemini (free), Google Gemini OAuth, OpenAI, Claude, Groq (free), Mistral, Cohere, Together, OpenRouter, Cerebras, DeepInfra, HuggingFace, Cloudflare, ZAI, Codebuff (free), Command Code, OpenCode Zen, OpenCode Go, Ollama, LM Studio, vLLM, and more |
| **4 Rewrite Levels** | Light (subtle fixes), Medium (natural rewrite), Aggressive (complete rewrite), Ninja (maximum stealth) |
| **6 Writing Styles** | Humanize, Academic, Professional, Casual, Creative, Technical |
| **9 Text Purposes** | Essay, Article, Blog, Email, Marketing, Report, Story, Social Media, General |
| **13 Tone Presets** | Conversational, Journalistic, Persuasive, Storytelling, Humorous, Analytical, and more |
| **Refinement Mode** | One-click "Refine further" to push flagged sentences toward a higher human score |
| **Style-Aware Processing** | Post-processing adapts to academic vs casual context |
| **Local AI Detection** | 12-metric on-device scoring with confidence intervals, heatmap, and readability — plus one-click links to GPTZero / ZeroGPT / Copyleaks for external verification |
| **File Upload** | Paste text or upload PDF/DOCX files |
| **Grammar Check** | Built-in grammar and spell checking |
| **16+ Languages** | English, Chinese (Simplified + Traditional), Spanish, French, German, Japanese, Korean, Arabic, Hindi, and more |
| **Batch Processing** | Humanize multiple texts at once |
| **Export** | Download as TXT, DOCX, or PDF |
| **100% Private** | API keys stored in your browser only. No server-side data storage. |

---

## Supported Providers Matrix

StealthHumanizer fully integrates the following AI providers, matching the provider and capability matrix of the Codex Launcher:

| Provider | API | Works with Codex? |
|----------|-----|-------------------|
| OpenAI | Responses API | ✅ |
| Gemini CLI OAuth | Code Assist | ✅ |
| Z.AI | Chat Completions | ✅ |
| OpenCode | Chat Completions | ✅ |
| Anthropic | Messages API | ✅ |
| Command Code | Custom /alpha/generate | ✅ |
| Ollama | Chat Completions | ✅ |
| OpenRouter | Chat Completions | ✅ |
| NVIDIA NIM | Chat Completions | ✅ |
| Crof.ai | Chat Completions | ✅ |
| Nous Research | Chat Completions | ✅ |
| Ocenza | Chat Completions | ✅ |
| MiMo | Chat Completions | ✅ |
| Perplexity | Chat Completions | ✅ |
| Cohere | Chat Completions | ✅ |
| Hugging Face | Chat Completions | ✅ |
| Together AI | Chat Completions | ✅ |
| Groq | Chat Completions | ✅ |
| Fireworks AI | Chat Completions | ✅ |
| OpenAdapter | Chat Completions | ✅ |
| Kilo.ai Gateway | Chat Completions | ✅ |
| Freebuff (Free DeepSeek/Kimi) | Freebuff API | ✅ |
| LM Studio (local) | Chat Completions | ✅ |
| vLLM (self-hosted) | Chat Completions | ✅ |
| Google Gemini (API Key) | Chat Completions / SDK | ✅ |
| Mistral AI | Chat Completions | ✅ |
| Cerebras | Chat Completions | ✅ |
| DeepInfra | Chat Completions | ✅ |
| Cloudflare Workers AI | Chat Completions | ✅ |
| Claude Code (CLI) | Claude Code CLI | ✅ |
| OpenAI Codex (CLI) | Codex CLI | ✅ |

---

## How It Works

### 4-Layer Humanization Pipeline

```
Input Text → Layer 1: LLM Rewrite → Layer 2: Post-Processing → Layer 3: Multi-Model Chain → Layer 4: Final Polish → Output
```

**Layer 1 — LLM Rewrite**: Your chosen AI provider rewrites the text using anti-detection prompts that enforce burstiness, perplexity injection, and structural disruption.

**Layer 2 — Non-LLM Post-Processing**: 500+ synonym swaps, 230+ collocation replacements, AI vocabulary removal, sentence length manipulation, typographic variation. Style-aware — academic text stays formal, casual text gets personality.

**Layer 3 — Multi-Model Chain (Optional)**: Pass text through multiple AI providers to mix statistical fingerprints. Each model adds different patterns.

**Layer 4 — Final Polish**: Light cleanup pass. Readability guard ensures quality doesn't degrade.

### Detection Metrics

The built-in detector analyzes:
- Perplexity (word choice unpredictability)
- Burstiness (sentence length variation)
- Vocabulary diversity
- AI phrase density
- Passive voice ratio
- Transition word frequency
- Sentence start diversity
- Hedging language
- Quantifier overuse
- Pronoun usage patterns

---

## Quick Start

```bash
git clone https://github.com/rudra496/StealthHumanizer.git
cd StealthHumanizer
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and add your API key in Settings. **Gemini is free** — get a key at [Google AI Studio](https://aistudio.google.com/apikey).

Or use it live at [stealthhumanizer.vercel.app](https://stealthhumanizer.vercel.app/).

> 💡 **Troubleshooting?** See our [comprehensive troubleshooting guide](./docs/TROUBLESHOOTING.md) for common issues and solutions.

---

## CLI

StealthHumanizer now ships an initial command-line interface for local
humanization and detector checks.

```bash
# Run without installing a global binary
npm run cli -- detect --text "Furthermore, it is important to note that..."

# Humanize from stdin with the Gemini provider
export GEMINI_API_KEY="your-key"
echo "Draft text..." | npm run cli -- humanize --model gemini --level medium

# Read and write files
npm run cli -- humanize --input draft.txt --output humanized.txt --style academic
```

The package exposes both `stealthhumanizer` and `stealth-humanize` binaries
when built or linked:

```bash
npm run cli:build
npm link
stealthhumanizer providers
```

Useful commands:

- `humanize` - runs the full multi-pass rewriting pipeline
- `detect` - scores text with the built-in AI-signal detector, no API key needed
- `providers` - lists provider ids, default models, and API key environment variables

Run `npm run cli -- --help` for the full option list.

### Local CLI-runner providers (no API key)

Two providers run a local CLI you already have logged in, as a subprocess,
instead of calling an HTTP API. They use the binary's own auth, so no API key
is required:

```bash
# Uses your local Claude Code login
stealthhumanizer humanize --model claude-code -i draft.txt

# Uses your local OpenAI Codex login
echo "Draft text..." | stealthhumanizer humanize --model codex
```

- `--model claude-code` spawns your local `claude` CLI (Claude Code)
- `--model codex` spawns your local `codex` CLI (OpenAI Codex)
- Point at a non-default binary with `STEALTHHUMANIZER_CLAUDE_CODE_BIN` or
  `STEALTHHUMANIZER_CODEX_BIN`
- CLI-only: these are skipped by auto-selection and are not available in the
  browser or serverless runtimes (they spawn a subprocess). The web API rejects
  them (including in model chains) so a browser user can't make a self-hosted
  server spawn its logged-in CLI.

**Security note — untrusted input.** The text being humanized is treated as
untrusted (it can contain prompt-injection). The runners are confined so an
injected instruction can't make the agent act:

- `claude-code` runs with `--tools ""`, which fully disables all tools — it
  cannot read/write files or run commands. Preferred for untrusted input.
- `codex` has no "disable all tools" switch, so it is confined as tightly as
  the platform allows: `--sandbox read-only` (no writes/network), an isolated
  empty working directory, and no inherited environment. A determined injection
  could still read absolute paths via a read-only command, so prefer
  `claude-code` when the input is fully untrusted.

Run `npm run test:cli` to build the packaged CLI entry point and execute the
CLI regression suite.

---

## Groq (Free) Setup & Demo Walkthrough

This walkthrough is specifically for the **Groq (Free)** provider flow.

1. Open **Settings**, then go to **Danger Zone** and clear old keys if you want a clean reset.
   ![Groq Free Step 1](./steps/1.jpg)

2. In provider selection, choose **Groq (FREE)**.
   ![Groq Free Step 2](./steps/2.jpg)

3. In the Groq settings card, click **Get API Key**.
   ![Groq Free Step 3](./steps/3.jpg)

4. In Groq Console, create a key (set name + expiration setting).
   ![Groq Free Step 4](./steps/4.jpg)

5. Copy the generated Groq key (usually visible once).
   ![Groq Free Step 5](./steps/5.jpg)

6. Paste it into StealthHumanizer’s Groq API key field and press **Save**.
   ![Groq Free Step 6](./steps/6.jpg)

7. Click **Test Key** and confirm the key is valid.
   ![Groq Free Step 7](./steps/7.jpg)

8. Return to provider selection and keep **Groq (Free)** active.
   ![Groq Free Step 8](./steps/8.jpg)

9. Configure Humanizer options (rewrite level, style, tone, target score, max words).
   ![Groq Free Step 9](./steps/9.jpg)

10. Paste/upload your text and run the pipeline.
    ![Groq Free Step 10](./steps/10.jpg)

11. Review output, re-humanize if needed, and export.
    ![Groq Free Step 11](./steps/11.jpg)

> **Safety note:** Never share API keys in public chats, screenshots, repos, or screen recordings. To remove stored keys, use **Settings → Danger Zone → Clear All API Keys**.

---

## Comparison

| | **StealthHumanizer** | **QuillBot** | **StealthWriter** | **Undetectable.ai** |
|---|:---:|:---:|:---:|:---:|
| Price | **Free** | $9.99/mo | $19/mo | $14.99/mo |
| Open Source | **Yes (MIT)** | No | No | No |
| AI Providers | **35** | 1 | 1 | 1 |
| No Login Required | **Yes** | No | No | No |
| Data Privacy | **Browser-only keys** | Server-side | Server-side | Server-side |
| Multi-Language | **16+** | Limited | English only | English only |
| Purpose Selector | **9 purposes** | No | No | No |
| Style Presets | **6 styles** | 4 modes | 3 modes | 3 modes |
| Tone Options | **13 tones** | 2 modes | No | No |
| File Upload | **PDF, DOCX** | No | No | No |
| Batch Processing | **Yes** | No | No | No |
| Grammar Check | **Built-in** | Separate tool | No | No |
| Custom Writing Sample | **Yes** | No | No | No |
| Self-Hostable | **Yes** | No | No | No |

---

## Architecture

> **Production Deployment & Inference Optimization:** Engineered as a live deployment of optimized LLM endpoints serving real-world users at scale. It operates on a high-availability API designed for zero-downtime inference with load-balanced LLM request scheduling, integrating internal safety alignment and ethical constraints directly into the prompt-routing architecture.

```
stealthhumanizer/
├── app/                    # Next.js app router
│   ├── api/                # API routes (humanize, detect, grammar, upload)
│   ├── layout.tsx          # Root layout with SEO + structured data
│   └── page.tsx            # Main page
├── components/             # React components
│   ├── Humanizer.tsx       # Main humanizer UI
│   ├── BatchHumanizer.tsx  # Batch processing UI
│   ├── Detector.tsx        # Standalone detector UI
│   ├── Settings.tsx        # API key management
│   └── Navbar.tsx          # Navigation
├── lib/                    # Core logic
│   ├── detector.ts         # 12-metric AI detection engine
│   ├── prompts.ts          # Anti-detection prompt system (EN + ZH)
│   ├── postprocess.ts      # Non-LLM post-processing engine
│   ├── providers.ts        # 35 AI provider integrations
│   ├── readability.ts      # Flesch, Kincaid, Coleman-Liau metrics
│   └── server/             # Server-side modules
│       ├── humanization-governance.ts  # Safety + regression guard
│       ├── model-runtime.ts            # Logistic regression scorer
│       └── text-utils.ts               # Tokenization utilities
└── public/                 # Static assets + style models
```

---

## Contributing

We love contributions! This is a community project and every PR helps.

### Good First Issues

Start with issues tagged [`good first issue`](https://github.com/rudra496/StealthHumanizer/labels/good%20first%20issue) — these are specifically scoped for new contributors.

### How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes and test locally with `npm run dev`
4. Commit with conventional style: `feat: add your feature`
5. Push and open a Pull Request

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for full guidelines.

### Contributors

[![Contributors](https://contrib.rocks/image?repo=rudra496/StealthHumanizer)](https://github.com/rudra496/StealthHumanizer/graphs/contributors)

---

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Charts**: [Recharts](https://recharts.org/)
- **Deployment**: [Vercel](https://vercel.com/)

---

## Roadmap

- [x] Browser extension (Chrome/Firefox)
- [x] CLI tool (`stealthhumanizer`, initial local/package binary)
- [ ] Fine-tuned local models for offline use
- [x] Real detector benchmarking dashboard
- [x] API service layer for programmatic access
- [ ] Collaborative editing with version history

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=rudra496/StealthHumanizer&type=Date)](https://star-history.com/#rudra496/StealthHumanizer&Date)

---

## Author

### Rudra Sarker

[Portfolio](https://rudra496.github.io/site) &middot;
[GitHub](https://github.com/rudra496) &middot;
[LinkedIn](https://www.linkedin.com/in/rudrasarker) &middot;
[Twitter/X](https://x.com/Rudra496)

---

## Alternatives (SEO)

If you're searching for any of these, **StealthHumanizer is the free, open-source alternative**:

QuillBot alternative, Undetectable.ai alternative, StealthWriter alternative, Hix Bypass alternative, Bypass AI detection, AI humanizer free, Humanize AI text free, Free AI detector bypass, Open source AI humanizer, GPTZero bypass, AI text rewriter free, Make AI text undetectable, AI to human text converter

---

## License

[MIT License](./LICENSE) &copy; 2024 Rudra Sarker. Free for personal and commercial use.

---

## More Open Source Projects

| Project | Stars | Description |
|---------|-------|-------------|
| [EdgeBrain](https://github.com/rudra496/EdgeBrain) | ![Stars](https://img.shields.io/github/stars/rudra496/EdgeBrain?style=social) | Edge AI inference — sub-100ms, no cloud |
| [DevRoadmaps](https://github.com/rudra496/devroadmaps) | ![Stars](https://img.shields.io/github/stars/rudra496/devroadmaps?style=social) | 17 career paths, 1700+ free resources |
| [CodeVista](https://github.com/rudra496/codevista) | ![Stars](https://img.shields.io/github/stars/rudra496/codevista?style=social) | AI code analysis & security scanner |
| [Nexus Agent](https://github.com/rudra496/nexus-agent) | ![Stars](https://img.shields.io/github/stars/rudra496/nexus-agent?style=social) | Self-evolving local AI agent framework |
| [MindWell](https://github.com/rudra496/mindwell) | ![Stars](https://img.shields.io/github/stars/rudra496/mindwell?style=social) | Free mental health support platform |
| [ScienceLab 3D](https://github.com/rudra496/sciencelab3d) | ![Stars](https://img.shields.io/github/stars/rudra496/sciencelab3d?style=social) | 40+ virtual STEM experiments |
| [SightlineAI](https://github.com/rudra496/sightlineai) | ![Stars](https://img.shields.io/github/stars/rudra496/sightlineai?style=social) | AI smart glasses for the blind |

---

<div align="center">

**[⭐ Star this repo](../../stargazers) · [🍴 Fork it](../../fork) · [👤 Follow @rudra496](https://github.com/rudra496)**

</div>

## Implemented roadmap capabilities

- **Real-time streaming endpoint:** `POST /api/humanize/stream` returns Server-Sent Events with `progress`, `result`, `error`, and `done` events so web or API clients can show live pipeline status.
- **Semantic fidelity validation:** every humanization result now includes a BERTScore-inspired semantic report with keyword recall, length alignment, sentence alignment, warnings, and a preserved/review/drift verdict.
- **Client-side Privacy Mode:** the Humanizer UI can run a local deterministic rewrite with no provider API key and no network model call, useful for sensitive drafts or offline local-model workflows.
- **Observability & cost dashboard:** the Dashboard tab tracks run count, estimated cost, latency, human score, semantic score, and recent run history in browser storage.
- **API service layer:** `POST /api/v1/humanize` supports programmatic use with optional `STEALTHHUMANIZER_API_TOKEN` service authentication and provider-key environment fallback.
- **Browser extension starter:** `extension/` contains a Manifest V3 Chrome/Firefox-compatible companion that sends selected page text to a local or hosted StealthHumanizer instance.
- **Detector benchmarking dashboard:** the Dashboard tab includes a built-in benchmark runner that compares detector scores before and after the offline privacy rewrite.
- **Screenshot without Playwright download:** use `npm run screenshot -- http://localhost:3000 /tmp/stealthhumanizer-dashboard.png` after starting the dev server; it uses an installed Chrome/Chromium binary and avoids registry downloads.

## More Projects
<table>
<tr>
<td width="50%" align="center">

### 🗺️ DevRoadmaps
**Free developer roadmaps**
20 career paths, 870+ topics, 1,880+ free resources.

[⭐ Star](https://github.com/rudra496/devroadmaps) · [🌐 Live](https://rudra496.github.io/devroadmaps)

</td>
<td width="50%" align="center">

### 🧠 EdgeBrain
**Edge AI inference engine**
Run ML models locally with sub-100ms latency.

[⭐ Star](https://github.com/rudra496/EdgeBrain)

</td>
</tr>
<tr>
<td width="50%" align="center">

### 🤖 awesome-ai-humanizers
**Curated AI humanizer list**
Tools, detectors, research papers & resources.

[⭐ Star](https://github.com/rudra496/awesome-ai-humanizers)

</td>
<td width="50%" align="center">

### 🔬 ScienceLab 3D
**Virtual STEM experiments**
40+ interactive physics, chemistry & biology labs.

[⭐ Star](https://github.com/rudra496/sciencelab3d) · [🌐 Live](https://sciencelab-two.vercel.app)

</td>
</tr>
</table>

## Connect

- [![GitHub](https://img.shields.io/badge/GitHub-rudra496-181717?logo=github)](https://github.com/rudra496)
- [![LinkedIn](https://img.shields.io/badge/LinkedIn-rudrasarker-0A66C2?logo=linkedin)](https://www.linkedin.com/in/rudrasarker)
- [![X/Twitter](https://img.shields.io/badge/X-@Rudra496-000000?logo=x)](https://x.com/Rudra496)
- [![YouTube](https://img.shields.io/badge/YouTube-@rudrasarker9732-FF0000?logo=youtube)](https://youtube.com/@rudrasarker9732)
- [![Dev.to](https://img.shields.io/badge/Dev.to-rudra__sarker-000000?logo=devdotto)](https://dev.to/rudra_sarker)
