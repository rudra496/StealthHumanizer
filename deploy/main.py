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


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("loading detector=%s ; long humanizer=ollama:%s at %s",
                DETECTOR_MODEL_ID, LONG_MODEL, OLLAMA_BASE_URL)
    t0 = time.perf_counter()
    state["detector_tokenizer"], state["detector_model"] = _load_detector()

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

    # gemma3:4b direct for ALL lengths — verified in live A/B checks:
    # gemma with this prompt scored 0% AI ("human written") on ZeroGPT where
    # the sampled BART outputs varied 0-100%.
    try:
        payload = {
            "model": LONG_MODEL,
            "stream": False,
            "keep_alive": -1,
            "messages": [
                {"role": "system", "content": HUMANIZE_SYSTEM_PROMPT},
                {"role": "user", "content": req.text},
            ],
            "options": {"temperature": max(0.7, min(1.0, req.temperature)),
                        "top_p": 0.95, "num_predict": max(700, len(req.text) // 2)},
        }
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = None
            for attempt in range(2):  # ride out transient ollama load errors
                r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload,
                                      headers={"Content-Type": "application/json"})
                if r.status_code == 200:
                    break
                logger.error("OLLAMA_DEBUG status=%s body=%s", r.status_code, r.text[:200])
                await asyncio.sleep(2)
        out = r.json().get("message", {}).get("content", "").strip() if r is not None else ""
        if not out:
            raise ValueError("empty ollama response")
    except Exception:
        logger.exception("humanization failed; returning input unchanged")
        out = req.text

    # Post-cleanup: strip wrapped quotes, collapse duplicated words ("It it"),
    # fix spacing/duplicated punctuation, guarantee sentence closure.
    out = re.sub(r"([a-z])([A-Z][a-z])", r"\1 \2", out)
    out = re.sub(r"\b(\w+)( \1)+\b", r"\1", out, count=3, flags=re.I)
    out = re.sub(r"\s+([,.;:!?])", r"\1", out)
    out = re.sub(r"([,.;:!?]){2,}", r"\1", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"^(?:and|but|so|also|moreover|furthermore)[, ]+", "", out, flags=re.I)
    out = ". ".join(s[:1].upper() + s[1:] for s in out.split(". "))
    if out and out[-1] not in ".!?":
        out += "."
    used_model = f"ollama:{LONG_MODEL}"

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
