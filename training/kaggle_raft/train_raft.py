#!/usr/bin/env python
"""StealthHumanizer RAFT round: generate candidates with the SFT model, keep the
most-human + faithful ones (scored by the production detector), continue training.

Kaggle kernel script. Needs internet (HF model + detector downloads).
Input: /kaggle/input/stealthhumanizer-pairs/pairs.jsonl
Output: /kaggle/working/bart-humanizer-raft
"""
import json
import os
import subprocess
import sys

import torch

# P100 + modern-torch incompatibility fix (see kaggle_sft/train_bart_sft.py)
if os.path.exists("/tmp/.torch_patched"):
    pass
elif torch.cuda.is_available() and "P100" in torch.cuda.get_device_name(0):
    print("P100 detected — installing cu118 torch build", flush=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                    "torch==2.2.2+cu118", "torchvision==0.17.2+cu118",
                    "transformers==4.44.2", "accelerate>=0.33.0", "huggingface_hub<1.0",
                    "--index-url", "https://download.pytorch.org/whl/cu118",
                    "--extra-index-url", "https://pypi.org/simple"],
                   check=True)
    open("/tmp/.torch_patched", "w").close()
    os.execv(sys.executable, [sys.executable] + sys.argv)
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorForSeq2Seq,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
    set_seed,
)

SFT_MODEL = "rudra496/stealthhumanizer-bart"
DETECTOR = "fakespot-ai/roberta-base-ai-text-detection-v1"
DATA = "/kaggle/input/stealthhumanizer-pairs/pairs.jsonl"
OUT_DIR = "/kaggle/working/bart-humanizer-raft"
N_CAND = 4
N_INPUTS = 3000
SEED = 42

set_seed(SEED)
# Locate the dataset wherever Kaggle mounted it
data_candidates = []
for root, _, files in os.walk("/kaggle/input"):
    if "pairs.jsonl" in files and "stealthhumanizer-sft" not in root:
        data_candidates.append(os.path.join(root, "pairs.jsonl"))
if not data_candidates:
    raise FileNotFoundError(f"pairs.jsonl not under /kaggle/input: {os.listdir('/kaggle/input')}")
DATA = sorted(data_candidates)[0]
print("data:", DATA)
# Prefer the SFT kernel's output when attached as a kernel source (avoids HF sync lag).
sft_local = []
for root, _, files in os.walk("/kaggle/input/stealthhumanizer-sft"):
    if "config.json" in files and "model.safetensors" in files:
        sft_local.append(root)
if sft_local:
    SFT_MODEL = sorted(sft_local)[0]
    print("SFT model from kernel output:", SFT_MODEL)
rows = [json.loads(l) for l in open(DATA, encoding="utf-8")]
rows = rows[:N_INPUTS]  # train portion only (val tail untouched)
print(f"RAFT inputs: {len(rows)}")

tok = AutoTokenizer.from_pretrained(SFT_MODEL)
model = AutoModelForSeq2SeqLM.from_pretrained(SFT_MODEL).cuda()
model.eval()

try:
    det_tok = AutoTokenizer.from_pretrained(DETECTOR)
except Exception as e:
    # pinned tokenizers can't parse newer tokenizer.json — fall back to slow tokenizer
    print("fast tokenizer failed (%s) — using slow tokenizer" % str(e)[:60], flush=True)
    det_tok = AutoTokenizer.from_pretrained(DETECTOR, use_fast=False)
det = AutoModelForSequenceClassification.from_pretrained(DETECTOR).cuda()
det.eval()


@torch.no_grad()
def ai_score(texts):
    enc = det_tok(texts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(det.device)
    logits = det(**enc).logits
    probs = torch.softmax(logits, dim=-1)
    # fakespot roberta: label order check at runtime
    ai_label = 1 if det.config.id2label.get(1, "").lower().find("machine") >= 0 or \
        det.config.id2label.get(1, "").lower().find("ai") >= 0 or \
        det.config.id2label.get(1, "").lower().find("fake") >= 0 else 0
    return probs[:, ai_label].tolist()


def word_f1(a, b):
    aw, bw = a.lower().split(), b.lower().split()
    common = set(aw) & set(bw)
    if not common:
        return 0.0
    p, r = len(common) / max(1, len(aw)), len(common) / max(1, len(bw))
    return 2 * p * r / max(1e-9, p + r)


# 1) generate candidates
kept = []
BATCH = 8
for i in range(0, len(rows), BATCH):
    batch = rows[i : i + BATCH]
    enc = tok([r["ai"] for r in batch], return_tensors="pt", padding=True,
              truncation=True, max_length=256).to(model.device)
    with torch.no_grad():
        gen = model.generate(
            **enc, max_length=256, do_sample=True, temperature=0.9, top_p=0.95,
            num_return_sequences=N_CAND,
        )
    texts = tok.batch_decode(gen, skip_special_tokens=True)
    for j, r in enumerate(batch):
        cands = texts[j * N_CAND : (j + 1) * N_CAND]
        scores = ai_score(cands)
        ranked = sorted(zip(cands, scores), key=lambda x: x[1])
        for c, s in ranked:  # first candidate passing fidelity wins
            if word_f1(c, r["human"]) >= 0.30 and 0.4 < len(c) / max(1, len(r["human"])) < 1.8:
                kept.append({"ai": r["ai"], "human": c})
                break
    if (i // BATCH) % 25 == 0:
        print(f"candidates {i}/{len(rows)}, kept={len(kept)}", flush=True)

print(f"RAFT training rows: {len(kept)}")

# 2) continue training on winners
model.gradient_checkpointing_enable()


class PairDataset(torch.utils.data.Dataset):
    def __init__(self, rr):
        self.rr = rr

    def __len__(self):
        return len(self.rr)

    def __getitem__(self, i):
        r = self.rr[i]
        mi = tok(r["ai"], max_length=256, truncation=True)
        lb = tok(text_target=r["human"], max_length=256, truncation=True)
        return {"input_ids": mi["input_ids"], "attention_mask": mi["attention_mask"],
                "labels": lb["input_ids"]}


collator = DataCollatorForSeq2Seq(tok, model=model)
targs = Seq2SeqTrainingArguments(
    output_dir="/kaggle/working/ckpt-raft",
    per_device_train_batch_size=8,
    gradient_accumulation_steps=2,
    learning_rate=2e-5,
    num_train_epochs=1,
    warmup_steps=30,
    fp16=torch.cuda.is_available(),
    logging_steps=100,
    save_strategy="no",
    report_to=[],
    seed=SEED,
)
trainer = Seq2SeqTrainer(model=model, args=targs, train_dataset=PairDataset(kept), data_collator=collator)
trainer.train()

os.makedirs(OUT_DIR, exist_ok=True)
model.save_pretrained(OUT_DIR)
tok.save_pretrained(OUT_DIR)
print("saved to", OUT_DIR)
