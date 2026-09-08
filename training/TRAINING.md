# Training Pipeline — self-trained humanizer

How StealthHumanizer's own BART humanizer (`rudra496/stealthhumanizer-bart`) was
built on 100% free resources (Kaggle GPU + Groq free tier + Hugging Face).

## Data recipe (~7K pairs, `pairs.jsonl` format: {"id","ai","human","gen_model"})

| Source | Type | Count | How |
|---|---|---|---|
| HC3 (`Hello-SimpleAI/HC3`) | real human vs ChatGPT, same prompts | 4,500 | `build_hc3.py` (direct jsonl download) |
| RAID (`liamdugan/raid`) | real human vs model generations, 11 domains | 493+ | `mine_raid.py` (rows API, joins by source_id) |
| Q1 OA abstracts | synthetic: LLM-polish each abstract -> (AI version, human original) | ~1,900 | `gen_pairs.py` (Groq qwen3.8/3.6 no-think + gpt-oss-20b/120b low) |

## Training
1. **SFT** — full fine-tune of `facebook/bart-large` (406M), 3 epochs, lr 5e-5,
   fp16, on Kaggle P100 (`kaggle_sft/`). ~50 min per 6.3K pairs.
2. **RAFT round** — generate N sampled candidates per training input, keep the
   least-AI-detected ones with a fidelity gate, continue training (`kaggle_raft/`).

## Kaggle kernel gotchas (each cost us a failed push — learn from them)
- CLI-pushed kernels always get **P100**; modern torch builds lack sm_60 kernels →
  install `torch==2.2.2+cu118 + torchvision==0.17.2+cu118`, re-exec with a flag file.
- New transformers refuses `.bin` weights on torch<2.6 (CVE-2025-32434) →
  pin `transformers==4.44.2 + accelerate + huggingface_hub<1.0`.
- Dataset mount path varies → `os.walk("/kaggle/input")` for the file.
- `accelerator` metadata field does not change the assigned GPU.

## Benchmark (40 held-out academic pairs, detector = fakespot RoBERTa)

| System | AI-prob (lower=better) | Word-F1 vs human (higher=better) |
|---|---|---|
| raw AI text | 0.9998 | 0.191 |
| cive202 BART (old default) | 0.9893 | 0.182 |
| **ours SFT v2** | **0.9830** | **0.194** |
| real human | 0.0074 | 0.673 |

Single-shot generation only marginally beats cive202 — but with **sampling
best-of-8 + detector-picked candidate** at serving time, mean AI-probability
drops to **~0.38** (beam search alone scores ~0.996). The deployed API
(`deploy/main.py`) implements exactly that: sample 8, filter degenerate
candidates, rank by `ai_prob − 0.5·fidelity(candidate, input)`, return the winner.

## Deploy
`deploy/main.py` replaces the model-server's short-text path
(env-overridable `SHORT_HUMANIZER_ID`, `HUMANIZER_BEST_OF_N`).
Rollback = recreate the container from the previous image tag.

## Free-resource budget used
- Kaggle: ~3 GPU-hours of the 30/week free quota
- Groq: within per-model daily free caps (429s handled with backoff)
- Hugging Face / datasets-server: free tiers
