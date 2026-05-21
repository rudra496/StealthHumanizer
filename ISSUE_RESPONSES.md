# GitHub Issue Responses (Verified)

Use the following professional replies for the currently open issues after verifying against the current codebase.

---

## Issue #95: API key invalid issue

Hi @Joseph1705 — thanks for reporting this.

I reviewed the API-key flow and applied a reliability improvement so keys are now trimmed before runtime use. This helps avoid false failures caused by accidental whitespace in local values.

Please try this:
1. Pull latest changes.
2. Open Settings and re-save your API key.
3. Click **Test Key**.

If it still fails, please share:
- Provider name (Gemini/OpenAI/Groq/etc.)
- Exact error text from the UI
- Whether the key works in the provider’s own dashboard/API tool

Thanks again — your report helped improve this flow.

---

## Issue #91: Add more AI phrases to the detection blacklist

Hi @rudra496 — great suggestion.

This has already been implemented in `lib/postprocess.ts`, and I also expanded coverage for a common phrasing variant:
- `it is worth noting`
- `it is worth noting that`

The blacklist now better catches this class of AI-style framing without changing existing behavior elsewhere.

---

## Issue #90: Add CONTRIBUTING.md with setup instructions

Hi @rudra496 — confirmed this is already complete.

`CONTRIBUTING.md` already exists and includes:
- setup instructions
- validation steps (`npm run lint`, `npm run test:integration`, `npm run build`)
- PR workflow guidance

This issue can be closed as already implemented.

---

## Issue #89: Add dark/light theme toggle

Hi @rudra496 — confirmed this is already implemented.

The app already supports:
- dark/light switching
- persisted theme preference
- system preference handling (`prefers-color-scheme`)

This issue can be closed as already implemented.

---

## Issue #88: Add demo GIF to README

Hi @rudra496 — great growth idea.

This one is still open and is mainly a content task (recording + optimizing a short demo). Recommended next step is to keep this issue open and tag it as a documentation/community contribution task.

---

## Issue #87: Add browser extension scaffold (Chrome)

Hi @rudra496 — this is still open and is a larger scoped feature.

Recommended approach:
1. Open a scoped “Phase 1 scaffold” issue (manifest + popup + basic structure only).
2. Keep full integration in a follow-up issue.

This keeps onboarding easy and improves the chance of successful external contributions.

---

## Suggested future issues (growth + contributor engagement)

If you want stronger contributor engagement and higher-quality stars/follows, consider opening these:

1. **“First-run provider diagnostics panel”**  
   Add a lightweight diagnostics card that checks key format, connectivity hints, and actionable troubleshooting.

2. **“Interactive example presets in README + docs”**  
   Add copy-paste examples for academic, blog, and email use-cases with expected output style.

3. **“Public benchmark dashboard refresh workflow”**  
   Automate benchmark artifact refresh + publish summary badges for transparency and trust.

4. **“Beginner-friendly extension scaffold”**  
   Keep only manifest/popup/content skeleton in first PR and label it `good first issue`.
