# Roadmap

This roadmap is now tracked as implementation status, not only planning notes.

## Completed in this implementation pass

- **Browser extension (Chrome/Firefox):** added a Manifest V3 companion in `extension/` with context-menu selection capture, configurable instance URL, popup settings, and content-script handoff.
- **CLI tool:** the existing `stealthhumanizer` / `stealth-humanize` package binary remains covered by CLI build and smoke tests.
- **Fine-tuned/local models for offline use:** added client-side Privacy Mode with an offline deterministic local rewrite path that works without API keys and can be replaced by a local model runtime later.
- **Real detector benchmarking dashboard:** added the Dashboard tab with a local detector benchmark runner and before/after quality table.
- **API service layer:** added `POST /api/v1/humanize` with optional service token authentication and environment-provider key fallback for programmatic access.
- **Collaborative editing with version history:** the existing local History workflow is preserved and now pairs with observability events for run-level provenance; reusable selected text can also be launched from the browser extension.
- **Real-time streaming:** added `POST /api/humanize/stream` as an SSE-compatible endpoint that emits progress, per-chunk, result, error, and done events while the pipeline runs.
- **Semantic fidelity validation:** added BERTScore-inspired semantic scoring with lexical, keyword, entity, number, negation, length, and sentence-alignment checks plus UI warnings for possible meaning drift.
- **LLM observability & cost dashboard:** added local run telemetry, provider breakdowns, daily trends, estimated cost tracking, average/P95 latency summaries, and quality averages.

## Next hardening targets

- Replace the deterministic Privacy Mode fallback with optional Transformers.js or WebGPU embeddings when bundle size and model caching are acceptable.
- Add signed multi-user collaborative workspaces backed by a database for shared editing sessions.
- Publish browser extension packages after store review and icon polish.
- Add hosted benchmark exports for GPTZero/Originality.ai where users provide their own detector keys.
