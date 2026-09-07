#!/usr/bin/env python3
"""Generate (AI-version -> human-original) training pairs from the Q1 OA corpus.

Concurrent, multi-model (per-model rate buckets => ~3x throughput).
Free-tier safe: Groq per-model 8000 TPM, exponential backoff on 429.
Usage: python gen_pairs.py --limit N [--start N]   (full batch: omit --limit)
"""
import argparse
import json
import os
import sys
import threading
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, "data", "papers", "corpus", "papers.jsonl")
OUT = os.path.join(ROOT, "training", "pairs.jsonl")
MODELS = ["qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b"]
REASONING = {"qwen/qwen3.8-27b": "none", "qwen/qwen3.6-27b": "none",
             "openai/gpt-oss-20b": "low", "openai/gpt-oss-120b": "low"}
MAX_TOKENS = 600
HEADERS_BASE = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) stealthhumanizer-train/1.0",
}
PROMPT = (
    "Rewrite the following academic abstract the way a busy researcher would "
    "when lightly AI-polishing it: fluent, formal, slightly generic phrasing, "
    "typical LLM style. Keep the same facts, length and technical terms. "
    "Output ONLY the rewritten abstract, no preamble.\n\n{abstract}"
)
_write_lock = threading.Lock()
_rr = {"i": 0}


def load_done_ids():
    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["id"])
                except Exception:
                    pass
    return done


def truncate_sentences(text, limit=1200):
    """Cap text near `limit` chars at a sentence boundary (keeps pairs consistent)."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in (". ", "! ", "? "):
        pos = cut.rfind(sep)
        if pos > limit // 2:
            return cut[: pos + 1]
    return cut


def call_model(api_key, model, abstract, use_reasoning_flag):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPT.format(abstract=abstract)}],
        "max_tokens": MAX_TOKENS,
        "temperature": 0.75,
    }
    if use_reasoning_flag:
        body["reasoning_effort"] = REASONING.get(model, "low")
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {api_key}", **HEADERS_BASE},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.loads(r.read())
    return d["choices"][0]["message"]["content"].strip()


def rewrite(api_key, model, abstract):
    low_flag = True
    for attempt in range(8):
        try:
            return call_model(api_key, model, abstract, low_flag)
        except urllib.error.HTTPError as e:
            if e.code == 400 and low_flag:  # param unsupported -> retry without
                low_flag = False
                continue
            if e.code in (429, 500, 502, 503) and attempt < 7:
                time.sleep(min(120, (2 ** attempt) * 3))
                continue
            raise
    return None


def next_model():
    with _write_lock:
        m = MODELS[_rr["i"] % len(MODELS)]
        _rr["i"] += 1
        return m


def clean(text):
    # strip <think>...</think> blocks (qwen3.6 leaks them into content)
    while "<think>" in text and "</think>" in text:
        pre, _, rest = text.partition("<think>")
        _, _, post = rest.partition("</think>")
        text = (pre + post).strip()
    return text.strip()


def work(api_key, p):
    model = next_model()
    try:
        human = truncate_sentences(p["text"])
        ai = rewrite(api_key, model, human)
        if ai:
            ai = clean(ai)
        if ai and 30 < len(ai) < len(human) * 3:
            with _write_lock:
                with open(OUT, "a", encoding="utf-8") as out:
                    out.write(json.dumps({
                        "id": p["id"], "ai": ai, "human": human, "gen_model": model,
                    }) + "\n")
            return True
    except Exception as e:
        print(f"  [{model.split('/')[-1]}] {type(e).__name__}: {str(e)[:80]}", flush=True)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--workers", type=int, default=7)
    args = ap.parse_args()

    api_key = os.environ.get("GROQ_API_KEY") or open(
        os.path.expanduser("~/.groq_api_key"), encoding="utf-8"
    ).read().strip()

    done = load_done_ids()
    todo = []
    with open(CORPUS, encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i < args.start:
                continue
            p = json.loads(line)
            if p["id"] not in done and len(p.get("text", "")) >= 300:
                todo.append(p)
    if args.limit:
        todo = todo[: args.limit]

    print(f"todo={len(todo)} done_before={len(done)} models={MODELS}", flush=True)
    n_ok = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(work, api_key, p): p for p in todo}
        for fut in as_completed(futs):
            if fut.result():
                n_ok += 1
                if n_ok % 50 == 0:
                    rate = n_ok / max(1e-9, (time.time() - t0) / 60)
                    print(f"{n_ok}/{len(todo)} pairs ({rate:.0f}/min)", flush=True)
    print(f"DONE: {n_ok} new pairs in {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
