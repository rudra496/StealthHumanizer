# Technical Review: Prompt-Engineering → ML Pipeline Transition

> **Status:** Architecture audit + concrete upgrade path  
> **Date:** 2025-05-05  
> **Issues:** Closes #61, Closes #55

---

## 1. Current Architecture: Prompt-Engineering System

### What Exists Today

| Layer | Implementation | Type |
|-------|---------------|------|
| Humanization core | `lib/humanizer.ts` — multi-pass LLM rewriting with sentence-level rehumanization | **Prompt engineering** |
| Prompt engine | `lib/prompts.ts` — tone/style/domain-aware system prompts with anti-detection instructions | **Prompt engineering** |
| Post-processing | `lib/postprocess.ts` — regex-based phrase replacement + synonym injection | **Rule-based** |
| Style modeling | `lib/style-model.ts` + `public/corpus-style-model.json` — statistical corpus features injected into prompts | **Hybrid** (stats → prompts) |
| Scoring | `lib/detector.ts`, `lib/readability.ts` — burstiness, lexical diversity, readability | **Heuristic** |
| Training scripts | `scripts/model/train-framework.mjs` — logistic regression on extracted features | **Lightweight ML** |
| Python training | `training/train_model.py` — basic T5 fine-tuning (prototype) | **Prototype ML** |

### Key Insight

**The core humanization loop is 100% prompt-dependent.** Every text transformation goes through an LLM call shaped by prompts. The system's quality ceiling is bounded by:

1. **LLM provider quality** — GPT-4, Claude, etc.
2. **Prompt effectiveness** — anti-detection instructions in `prompts.ts`
3. **Post-processing coverage** — finite regex/synonym rules

There is **no learned model** performing the actual rewriting. The "style model" (`corpus-style-model.json`) provides statistical parameters that get injected *into prompts*, not a neural model that transforms text directly.

### Strengths

- ✅ Fast iteration — prompt changes deploy instantly
- ✅ Multi-provider support (13 providers)
- ✅ Rich tone/style/domain configuration
- ✅ Existing data pipeline infrastructure (`data/`, `scripts/papers/`)

### Limitations

- ❌ No local inference capability — always requires an LLM API
- ❌ Quality varies by provider and model
- ❌ Latency proportional to LLM response time
- ❌ Cost scales with usage (API calls)
- ❌ T5 training script is a minimal prototype, not production-ready
- ❌ No evaluation benchmarking against real AI detectors
- ❌ No experiment tracking or model versioning

---

## 2. ML Pipeline Upgrade Path

### Phase 1: Data Foundation (Current PR — #55)

**Goal:** Build a robust data pipeline that produces high-quality training pairs from 10k+ Q1 open-access papers.

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| Paper ingestion | `data/collector.py` | Fetch from arXiv, PubMed, Semantic Scholar |
| Text cleaning | `data/cleaner.py` | Remove citations, normalize whitespace |
| Pair generation | `data/pair_generator.py` | Create (AI-like → human) rewrite pairs |
| Dataset builder | `data/dataset_builder.py` | Assemble final training corpus |
| Full pipeline | `data/full_pipeline.py` | Orchestrate all stages |
| Configs | `data/models/train.q1-oa-10k.json` | 10k paper training configuration |

**Data sources:** arXiv, PubMed Central, Semantic Scholar, CrossRef (all open-access).

### Phase 2: Model Training Infrastructure (Current PR — #55)

**Goal:** Production-ready training pipeline with experiment tracking and quality gates.

**Components:**

| Component | File | Purpose |
|-----------|------|---------|
| Training config | `data/models/train.config.example.json` | Hyperparameters, thresholds |
| Training script | `training/train_model.py` | T5/BART fine-tuning with proper setup |
| Inference | `inference/local_model.py` | Local model inference |
| Evaluation | `scripts/model/evaluate-framework.mjs` | Metrics + quality gates |
| Experiment tracking | `data/models/lineage/experiments.jsonl` | Reproducibility |

### Phase 3: Hybrid Architecture (Future)

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│  Input Text  │───▶│  ML Rewrite  │───▶│   Scoring    │
│              │    │  (T5/BART)   │    │  + Fallback  │
└─────────────┘    └──────────────┘    └──────┬───────┘
                                                │
                                    ┌───────────▼──────────┐
                                    │  Score < threshold?  │
                                    └──┬───────────────┬───┘
                                  Yes │               │ No
                                      ▼               ▼
                              ┌──────────────┐  ┌──────────┐
                              │  LLM Fallback│  │  Output  │
                              │  (current)   │  │          │
                              └──────────────┘  └──────────┘
```

**Key design decisions:**

1. **ML-first with LLM fallback** — local model handles 80%+ of cases, LLM only for edge cases
2. **Unified scoring** — same metrics for ML and LLM outputs
3. **Gradual rollout** — A/B test ML vs LLM before switching default

### Phase 4: Full ML Replacement (Future)

- Fine-tune larger models (BART-large, T5-3B) on accumulated training data
- Add domain-specific model heads (academic, creative, technical)
- Deploy as ONNX/TensorRT for fast local inference
- Remove LLM dependency entirely for core humanization

---

## 3. Concrete Next Steps

### Immediate (This PR)

- [x] Enhanced ML training pipeline (`training/train_model.py`)
- [x] Data pipeline for 10k Q1 papers (`data/`)
- [x] Evaluation metrics and quality gates
- [x] Configuration files for reproducible training
- [x] Technical review documentation (this file)

### Short-term (Next 1-2 PRs)

- [ ] Integrate local model inference into API routes
- [ ] Add A/B testing between ML and LLM paths
- [ ] Benchmark against GPTZero, Originality.ai, Turnitin
- [ ] Add ONNX export for deployment

### Medium-term (Next quarter)

- [ ] Domain-specific fine-tuning (academic, creative, technical)
- [ ] Continuous learning pipeline (user feedback → retraining)
- [ ] Model serving infrastructure (Docker, GPU support)

---

## 4. Technical Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Training data quality issues | Medium | Multi-source validation, deduplication, quality scoring |
| Model doesn't beat LLM quality | Medium | Hybrid fallback ensures no regression |
| GPU requirements too high | Low | Start with T5-small/base, quantize for inference |
| Data pipeline scaling to 10k papers | Low | Batch processing, incremental updates |

---

## 5. Success Metrics

| Metric | Current (Prompt-only) | Target (ML + Hybrid) |
|--------|----------------------|---------------------|
| GPTZero bypass rate | ~70% (depends on provider) | >85% |
| Latency (p/500 words) | 2-5s (LLM API) | <1s (local ML) |
| Cost per 1000 humanizations | $0.50-2.00 (API) | ~$0 (local) |
| Offline capability | ❌ | ✅ |
