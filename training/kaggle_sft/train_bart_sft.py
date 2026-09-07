#!/usr/bin/env python
"""StealthHumanizer SFT: fine-tune facebook/bart-large on (AI-text -> human-text) pairs.
Kaggle kernel script. Input dataset: /kaggle/input/stealthhumanizer-pairs/pairs.jsonl
Output: /kaggle/working/bart-humanizer  (model + tokenizer)
"""
import json
import os
import subprocess
import sys

import torch

# Kaggle's modern torch builds dropped Pascal (P100, sm_60) kernels. If we land
# on a P100, install a cu118 torch build that still supports it, then re-exec.
# The flag file prevents an infinite re-exec loop on the second entry.
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
from torch.utils.data import Dataset
from transformers import (
    AutoModelForSeq2SeqLM,
    AutoTokenizer,
    DataCollatorForSeq2Seq,
    Seq2SeqTrainer,
    Seq2SeqTrainingArguments,
    set_seed,
)
UNUSED = [
]
MODEL_NAME = "facebook/bart-large"
OUT_DIR = "/kaggle/working/bart-humanizer"
MAX_LEN = 256
SEED = 42
set_seed(SEED)
candidates = []
for root, _, files in os.walk("/kaggle/input"):
    if "pairs.jsonl" in files:
        candidates.append(os.path.join(root, "pairs.jsonl"))
if not candidates:
    raise FileNotFoundError(f"pairs.jsonl not under /kaggle/input: {os.listdir('/kaggle/input')}")
data_path = sorted(candidates)[0]
print("data:", data_path)
pairs = [json.loads(l) for l in open(data_path, encoding="utf-8")]
pairs = [p for p in pairs if 200 <= len(p["human"]) <= 2500 and 30 <= len(p["ai"]) <= 2500]
print(f"usable pairs: {len(pairs)}")
val = pairs[-500:]
train = pairs[:-500]
print(f"train={len(train)} val={len(val)}")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME)
model.gradient_checkpointing_enable()
model.config.forced_bos_token_id = None  # allow natural endings, not force </s>
class PairDataset(Dataset):
    def __init__(self, rows):
        self.rows = rows
    def __len__(self):
        return len(self.rows)
    def __getitem__(self, i):
        r = self.rows[i]
        model_in = tokenizer(r["ai"], max_length=MAX_LEN, truncation=True)
        labels = tokenizer(text_target=r["human"], max_length=MAX_LEN, truncation=True)
        return {
            "input_ids": model_in["input_ids"],
            "attention_mask": model_in["attention_mask"],
            "labels": labels["input_ids"],
        }
collator = DataCollatorForSeq2Seq(tokenizer, model=model)
common = dict(
    output_dir="/kaggle/working/checkpoints",
    per_device_train_batch_size=8,
    gradient_accumulation_steps=2,
    learning_rate=5e-5,
    num_train_epochs=3,
    warmup_steps=100,
    lr_scheduler_type="linear",
    weight_decay=0.01,
    fp16=torch.cuda.is_available(),
    logging_steps=100,
    save_strategy="no",
    report_to=[],
    seed=SEED,
    dataloader_num_workers=2,
)
targs = Seq2SeqTrainingArguments(**common)
trainer = Seq2SeqTrainer(
    model=model,
    args=targs,
    train_dataset=PairDataset(train),
    data_collator=collator,
)
trainer.train()
# post-hoc validation loss
model.eval()
val_losses = []
with torch.no_grad():
    for i in range(0, len(val), 16):
        batch_rows = val[i : i + 16]
        enc = collator([PairDataset(batch_rows)[j] for j in range(len(batch_rows))])
        enc = {k: v.to(model.device) for k, v in enc.items()}
        out = model(**enc)
        val_losses.append(out.loss.item())
print(f"VAL_LOSS={sum(val_losses)/len(val_losses):.4f}")
# generation sanity check on 3 val inputs
model.eval()
for r in val[:3]:
    enc = tokenizer(r["ai"], return_tensors="pt", max_length=MAX_LEN, truncation=True).to(model.device)
    gen = model.generate(**enc, max_length=MAX_LEN, num_beams=4)
    print("SAMPLE AI>  ", r["ai"][:120])
    print("SAMPLE OUT> ", tokenizer.decode(gen[0], skip_special_tokens=True)[:120])
    print("SAMPLE HUMAN>", r["human"][:120])
    print("---")
os.makedirs(OUT_DIR, exist_ok=True)
model.save_pretrained(OUT_DIR)
tokenizer.save_pretrained(OUT_DIR)
print("saved to", OUT_DIR)
