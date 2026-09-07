#!/usr/bin/env python
"""Benchmark: raw AI text vs cive202 BART vs our SFT/RAFT model.

Runs on the Oracle VPS inside the stealth-models container (torch + HF cached).
Metrics per system on N held-out pairs:
  - detector AI-probability (fakespot-ai/roberta-base-ai-text-detection-v1, lower=better)
  - word-F1 vs human target (fidelity, higher=better)
  - burstiness (stdev/mean of sentence lengths, higher=more human-like)

Usage: python benchmark.py <model_dir_or_id> [--n 50]
"""
import argparse
import json
import statistics

import torch
from transformers import (
    AutoModelForCausalLM,  # noqa: F401  (detector is AutoModelForSequenceClassification)
    AutoModelForSeq2SeqLM,
    AutoModelForSequenceClassification,
    AutoTokenizer,
)

VAL_TAIL = 500  # pairs[-500:] is the held-out val split


def load_pairs(n):
    # benchmark runs where pairs.jsonl is mounted/copied
    for cand in ("/models/pairs.jsonl", "/opt/stealth-models/pairs.jsonl", "pairs.jsonl"):
        try:
            rows = [json.loads(l) for l in open(cand, encoding="utf-8")]
            return rows[-VAL_TAIL:][:n]
        except OSError:
            continue
    raise FileNotFoundError("pairs.jsonl not found")


@torch.no_grad()
def ai_probs(det, det_tok, texts, bs=16):
    out = []
    for i in range(0, len(texts), bs):
        enc = det_tok(texts[i : i + bs], return_tensors="pt", padding=True,
                      truncation=True, max_length=512)
        probs = torch.softmax(det(**enc).logits, dim=-1)
        label1 = det.config.id2label[1].lower()
        ai_idx = 1 if any(k in label1 for k in ("machine", "ai", "fake", "generated")) else 0
        out.extend(probs[:, ai_idx].tolist())
    return out


def burstiness(text):
    sents = [s for s in text.replace("!", ".").replace("?", ".").split(". ") if len(s.split()) > 2]
    lens = [len(s.split()) for s in sents]
    if len(lens) < 2:
        return 0.0
    return statistics.stdev(lens) / max(1e-9, statistics.mean(lens))


def word_f1(a, b):
    aw, bw = a.lower().split(), b.lower().split()
    common = set(aw) & set(bw)
    if not common:
        return 0.0
    p, r = len(common) / max(1, len(aw)), len(common) / max(1, len(bw))
    return 2 * p * r / max(1e-9, p + r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--out", default="benchmark_results.json")
    args = ap.parse_args()

    pairs = load_pairs(args.n)
    det = AutoModelForSequenceClassification.from_pretrained(
        "fakespot-ai/roberta-base-ai-text-detection-v1").eval()
    det_tok = AutoTokenizer.from_pretrained("fakespot-ai/roberta-base-ai-text-detection-v1")

    systems = {"raw_ai": [p["ai"] for p in pairs],
               "human_target": [p["human"] for p in pairs]}

    # candidate humanizer models
    for name, mid in [("cive202", "cive202/humanize-ai-text-bart-large"),
                      ("ours", args.model)]:
        try:
            tok = AutoTokenizer.from_pretrained(mid)
            mdl = AutoModelForSeq2SeqLM.from_pretrained(mid).eval()
            outs = []
            for p in pairs:
                enc = tok(p["ai"], return_tensors="pt", truncation=True, max_length=256)
                gen = mdl.generate(**enc, max_length=256, num_beams=4)
                outs.append(tok.decode(gen[0], skip_special_tokens=True))
            systems[name] = outs
            print(f"generated {len(outs)} outputs for {name}")
        except Exception as e:
            print(f"skip {name}: {e}")

    results = {}
    for name, texts in systems.items():
        probs = ai_probs(det, det_tok, texts)
        f1s = [word_f1(t, p["human"]) for t, p in zip(texts, pairs)]
        burst = [burstiness(t) for t in texts]
        results[name] = {
            "detector_ai_prob_mean": round(statistics.mean(probs), 4),
            "word_f1_vs_human": round(statistics.mean(f1s), 4),
            "burstiness": round(statistics.mean(burst), 4),
        }
        print(name, results[name])

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1)
    print("saved", args.out)


if __name__ == "__main__":
    main()
