"""StealthHumanizer model server.

Single-model routing behind separate API keys validated by nginx:
  POST /humanize/  - gemma3:4b via Ollama for ALL lengths (ZeroGPT-verified
                     best in live A/B checks: 0% AI "human written" vs the
                     BART ensemble's variance and Granite's 100%)
  POST /detect/    - fakespot-ai/roberta-base-ai-text-detection-v1 (RoBERTa, 125M)
  GET  /health     - liveness probe (no auth)

Designed for Oracle Cloud ARM (Ampere A1), CPU-only, free-tier RAM/disk.

Why an instruct model instead of the fine-tuned BART for everything: live A/B
on identical text showed gemma3:4b with the anti-detection prompt preserves
facts AND passes ZeroGPT (0% AI), while small seq2seq models either stay too
close to the AI structure (flagged) or drift (meaning damage). keep_alive
pins the model so repeated calls never pay a load penalty.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Literal

import httpx
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoTokenizer, AutoModelForSequenceClassification

logger = logging.getLogger("stealth-models")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

DETECTOR_MODEL_ID = "fakespot-ai/roberta-base-ai-text-detection-v1"
ENSEMBLE_DETECTOR_ID = os.environ.get("ENSEMBLE_DETECTOR_ID", "Hello-SimpleAI/chatgpt-detector-roberta")

# Ollama is installed natively on the host. The container reaches it via the
# docker bridge gateway (the host's bridge IP on the `homelab` network resolves
# to 172.18.0.1). Override via OLLAMA_BASE_URL env if needed.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://172.18.0.1:11434")
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "120"))
LONG_MODEL = os.environ.get("OLLAMA_HUMANIZER_LONG", "gemma3:4b")

HUMANIZE_SYSTEM_PROMPT = (
    "You are an AI text humanizer. Rewrite the user's text so it reads like a real person wrote it. "
    "RULES:\n"
    "1. Preserve ALL meaning, facts, names, numbers, code, URLs, and citations.\n"
    "2. Keep the approximate length — do NOT summarize or shorten.\n"
    "3. Vary sentence length and structure (mix short and long).\n"
    "4. Use simple, everyday words and contractions (it's, don't, you're) where natural.\n"
    "5. Replace AI clichés: furthermore, moreover, additionally, delve, tapestry, navigate, complexities, "
    "in the realm of, it is important to note, a testament to, underscores, vibrant, multifaceted, "
    "unprecedented, crucial, pivotal, fostering, leveraging.\n"
    "6. Use casual transitions where they fit (but, so, then, anyway).\n"
    "7. Do NOT add personal pronouns (I, you, we, us, our) or fillers (you know, basically, honestly, folks, "
    "well) unless the original text already has them.\n"
    "8. Do NOT add new examples, opinions, analogies, or explanations that are not in the original.\n"
    "9. Output ONLY the rewritten text. No preamble. No explanation. No quotes around the output."
)

state: dict = {}


class HumanizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)
    temperature: float = Field(0.7, ge=0.1, le=2.0)
    num_beams: int = Field(4, ge=1, le=8)  # accepted for backwards compat, ignored by Ollama


class HumanizeResponse(BaseModel):
    humanized: str
    model: str
    elapsed_ms: int


class DetectRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)


class DetectResponse(BaseModel):
    label: Literal["human", "ai"]
    ai_probability: float
    human_probability: float
    model: str
    elapsed_ms: int


def _load_detector():
    tokenizer = AutoTokenizer.from_pretrained(DETECTOR_MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(DETECTOR_MODEL_ID)
    model.eval()
    return tokenizer, model


def _load_detector2():
    """Second detector for ranking — the mean of two detectors generalizes
    better to unseen checkers (ZeroGPT/Turnitin) than a single model."""
    try:
        tokenizer = AutoTokenizer.from_pretrained(ENSEMBLE_DETECTOR_ID)
        model = AutoModelForSequenceClassification.from_pretrained(ENSEMBLE_DETECTOR_ID)
        model.eval()
        return tokenizer, model
    except Exception:
        logger.exception("ensemble detector %s failed to load — single-detector ranking", ENSEMBLE_DETECTOR_ID)
        return None, None


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("loading detector=%s (+%s) ; long humanizer=ollama:%s at %s",
                DETECTOR_MODEL_ID, ENSEMBLE_DETECTOR_ID, LONG_MODEL, OLLAMA_BASE_URL)
    t0 = time.perf_counter()
    state["detector_tokenizer"], state["detector_model"] = _load_detector()
    state["detector2_tokenizer"], state["detector2_model"] = _load_detector2()

    # Warm up Ollama so the first long-input request doesn't eat the cold start.
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            tags = r.json() if r.status_code == 200 else {}
            available = {m.get("name", "") for m in tags.get("models", [])}
            if LONG_MODEL in available or any(a.startswith(LONG_MODEL) for a in available):
                logger.info("Ollama model %s available", LONG_MODEL)
            else:
                logger.warning("Ollama model %s not in %s — first call will pull it", LONG_MODEL, available)
    except Exception as e:
        logger.warning("Ollama warmup probe failed (will retry on first request): %s", e)

    logger.info("models loaded in %.1fs", time.perf_counter() - t0)
    yield
    state.clear()


app = FastAPI(
    title="StealthHumanizer Models",
    version="3.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "ok", "loaded": bool(state)}


@app.post("/humanize/", response_model=HumanizeResponse)
async def humanize(req: HumanizeRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    t0 = time.perf_counter()

    # ===== gemma3:4b best-of-2 + detector-ensemble ranking =====
    # Single-shot gemma is a lottery (verified 0-100% AI across runs on the
    # same text). Two concurrent samples at different temperatures + the
    # two-detector ensemble pick turn every click into best-of-2 within the
    # same wall-clock budget (ollama runs the samples in parallel).
    async def _one_sample(temp: float):
        payload = {
            "model": LONG_MODEL,
            "stream": False,
            "keep_alive": -1,
            "messages": [
                {"role": "system", "content": HUMANIZE_SYSTEM_PROMPT},
                {"role": "user", "content": req.text},
            ],
            "options": {"temperature": temp, "top_p": 0.95,
                        "num_predict": max(700, len(req.text) // 2)},
        }
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = None
            for attempt in range(2):
                r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload,
                                      headers={"Content-Type": "application/json"})
                if r.status_code == 200:
                    break
                logger.error("OLLAMA_DEBUG status=%s body=%s", r.status_code, r.text[:200])
                await asyncio.sleep(2)
        txt = r.json().get("message", {}).get("content", "").strip() if r is not None else ""
        return txt

    try:
        base_temp = max(0.7, min(1.0, req.temperature))
        tasks = [
            asyncio.ensure_future(_one_sample(base_temp)),
            asyncio.ensure_future(_one_sample(min(1.15, base_temp + 0.25))),
        ]
        # HARD BUDGET: wait at most 42s — Vercel Hobby kills functions at 60s.
        # Ship whichever samples finished; cancel the stragglers.
        done, pending = await asyncio.wait(tasks, timeout=42)
        for t in pending:
            t.cancel()
        cands = []
        for t in done:
            try:
                p = t.result()
            except Exception:
                continue
            if p:
                cands.append(p)
        if not cands:
            raise ValueError("all ollama samples failed")
    except Exception:
        logger.exception("humanization failed; returning input unchanged")
        cands = [req.text]

    # Post-cleanup on every candidate: glue-split, dup-word collapse
    # (case-insensitive), punct spacing, sentence closure + capitalization.
    def _clean(c: str) -> str:
        c = re.sub(r"([a-z])([A-Z][a-z])", r"\1 \2", c)
        c = re.sub(r"\b(\w+)( \1)+\b", r"\1", c, count=3, flags=re.I)
        c = re.sub(r"\s+([,.;:!?])", r"\1", c)
        c = re.sub(r"([,.;:!?]){2,}", r"\1", c)
        c = re.sub(r"[ \t]{2,}", " ", c)
        c = re.sub(r"^(?:and|but|so|also|moreover|furthermore)[, ]+", "", c, flags=re.I)
        c = ". ".join(s[:1].upper() + s[1:] for s in c.split(". "))
        if c and c[-1] not in ".!?":
            c += "."
        return c.strip()

    cands = [_clean(c) for c in cands]
    cands = [c for c in cands if c]
    if len(cands) >= 2 and cands[0] == cands[1]:
        cands = cands[:1]  # identical samples — nothing to rank

    # Meaning gate vs the original input: numbers exact, no invented
    # proper-noun entities, negation balance, sane length band.
    _NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
    _ENT_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
    _ENT_STOP = {"the", "this", "that", "these", "those", "it", "in", "on",
                 "if", "furthermore", "moreover", "however", "consequently",
                 "additionally", "ultimately", "nevertheless", "first", "second",
                 "third", "finally", "to", "for", "and", "but", "so", "there",
                 "thus", "hence", "also", "such", "some", "any", "sometimes"}
    _NEG = ("not", "no", "never", "cannot", "can't", "don't", "doesn't", "didn't",
            "won't", "isn't", "aren't", "wasn't", "weren't", "without", "nor")

    def _ents(t: str) -> set:
        return {w for w in _ENT_RE.findall(t) if w.lower() not in _ENT_STOP}

    def _neg_count(t: str) -> int:
        return sum(1 for w in t.lower().split() if w.strip(".,;:!'\"") in _NEG)

    def _f1(c: str) -> float:
        aw, bw = req.text.lower().split(), c.lower().split()
        common = set(aw) & set(bw)
        if not common:
            return 0.0
        p = len(common) / max(1, len(aw))
        r = len(common) / max(1, len(bw))
        return 2 * p * r / max(1e-9, p + r)

    def _meaning_ok(c: str) -> bool:
        sl = max(1, len(req.text))
        if not (0.6 <= len(c) / sl <= 1.6):
            return False
        if sorted(_NUM_RE.findall(req.text)) != sorted(_NUM_RE.findall(c)):
            return False
        if _ents(c) - _ents(req.text):
            return False
        if abs(_neg_count(c) - _neg_count(req.text)) > 1:
            return False
        return _f1(c) >= 0.30

    safe = [c for c in cands if _meaning_ok(c)]
    pool = safe or [c for c in cands if _f1(c) >= 0.25] or cands

    # Rank by the detector ensemble (mean AI-probability, lower = better).
    det_tok = state["detector_tokenizer"]
    det_model = state["detector_model"]
    det2_tok = state.get("detector2_tokenizer")
    det2_model = state.get("detector2_model")

    def _one_prob(tok_, mdl_, txt: str) -> float:
        enc = tok_(txt, return_tensors="pt", truncation=True, max_length=512)
        with torch.no_grad():
            probs = torch.softmax(mdl_(**enc).logits, dim=-1)[0].tolist()
        id2l = mdl_.config.id2label
        human_p = max((p for lbl, p in zip(id2l.values(), probs)
                       if any(a in lbl.lower() for a in ("human", "real"))), default=0.0)
        return 1.0 - human_p

    def _ai_prob(txt: str) -> float:
        p = _one_prob(det_tok, det_model, txt)
        if det2_model is not None:
            p = (p + _one_prob(det2_tok, det2_model, txt)) / 2.0
        return p

    out = min(pool, key=_ai_prob) if pool else req.text
    used_model = f"ollama:{LONG_MODEL}+bo2{'x2' if det2_model is not None else ''}"

    # Strip accidental surrounding quotes (some models wrap output).
    if len(out) >= 2 and out[0] == out[-1] and out[0] in ('"', "'", "`"):
        out = out[1:-1].strip()

    return HumanizeResponse(
        humanized=out,
        model=used_model,
        elapsed_ms=int((time.perf_counter() - t0) * 1000),
    )


@app.post("/detect/", response_model=DetectResponse)
async def detect(req: DetectRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    tokenizer = state["detector_tokenizer"]
    model = state["detector_model"]
    t0 = time.perf_counter()
    inputs = tokenizer(
        req.text,
        return_tensors="pt",
        truncation=True,
        max_length=512,
        padding=True,
    )
    with torch.no_grad():
        logits = model(**inputs).logits
    probs = torch.softmax(logits, dim=-1)[0].tolist()
    id2label = model.config.id2label
    label_to_prob = {id2label[i].lower(): probs[i] for i in range(len(probs))}

    # Normalize label naming conventions across detectors.
    human_aliases = ("human", "real", "label_0", "0")
    ai_aliases = ("ai", "ai-generated", "chatgpt", "fake", "label_1", "1")
    human_p = max((label_to_prob.get(a, 0.0) for a in human_aliases), default=0.0)
    ai_p = max((label_to_prob.get(a, 0.0) for a in ai_aliases), default=0.0)
    if human_p + ai_p <= 0:
        human_p = label_to_prob.get(id2label[0].lower(), 0.0)
        ai_p = label_to_prob.get(id2label[-1].lower(), 1.0 - human_p)
    label = "ai" if ai_p >= human_p else "human"
    return DetectResponse(
        label=label,
        ai_probability=float(ai_p),
        human_probability=float(human_p),
        model=DETECTOR_MODEL_ID,
        elapsed_ms=int((time.perf_counter() - t0) * 1000),
    )
