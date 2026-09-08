"""StealthHumanizer model server.

Three-model routing behind separate API keys validated by nginx:
  POST /humanize/  - <=150w: cive202/humanize-ai-text-bart-large (BART, 406M,
                     purpose-built + peer-reviewed, faithful on short text, ~10s)
                     >150w: Ollama gemma3:4b (only faithful option for long text)
  POST /detect/    - fakespot-ai/roberta-base-ai-text-detection-v1 (RoBERTa, 125M)
  GET  /health     - liveness probe (no auth)

Designed for Oracle Cloud ARM (Ampere A1), CPU-only, free-tier RAM/disk.

Why BART-large for short text: it's the only sub-1B specialized humanizer with
a real paper (Paneru 2026, BERTScore 0.924) that ACTUALLY preserves length and
facts. Qwen 0.5B hallucinated fake awards/publications on long inputs; amicus
summarized (84w→19w); Ateeqq produced garbage tokens. None of those are safe.
For long text no sub-1B model works — gemma3:4b is the only faithful option.
"""
from __future__ import annotations

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
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, AutoModelForSequenceClassification

logger = logging.getLogger("stealth-models")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

DETECTOR_MODEL_ID = "fakespot-ai/roberta-base-ai-text-detection-v1"
ENSEMBLE_DETECTOR_ID = os.environ.get("ENSEMBLE_DETECTOR_ID", "Hello-SimpleAI/chatgpt-detector-roberta")
SHORT_HUMANIZER_ID = os.environ.get("SHORT_HUMANIZER_ID", "rudra496/stealthhumanizer-bart")
BEST_OF_N = int(os.environ.get("HUMANIZER_BEST_OF_N", "8"))
# Adaptive resampling: if the best candidate still scores above this ensemble
# AI-probability, sample another round at a higher temperature (max 3 rounds).
RESAMPLE_THRESHOLD = float(os.environ.get("HUMANIZER_RESAMPLE_THRESHOLD", "0.35"))

# Ollama is installed natively on the host. The container reaches it via the
# docker bridge gateway (the host's bridge IP on the `homelab` network resolves
# to 172.18.0.1). Override via OLLAMA_BASE_URL env if needed.
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://172.18.0.1:11434")
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "120"))

# Auto-routing by input length:
# - <=150 words: cive202 BART-large (sub-1B specialized humanizer, ~10s)
# - >150 words: gemma3:4b via Ollama (only faithful option, 25-90s)
LONG_MODEL = os.environ.get("OLLAMA_HUMANIZER_LONG", "gemma3:4b")
SHORT_WORD_CAP = int(os.environ.get("HUMANIZER_SHORT_WORD_CAP", "150"))

HUMANIZE_SYSTEM_PROMPT = (
    "You are an AI text humanizer. Rewrite the user's text so it reads like a real person wrote it. "
    "RULES:\n"
    "1. Preserve ALL meaning, facts, names, numbers, code, URLs, and citations.\n"
    "2. Keep the approximate length — do NOT summarize or shorten.\n"
    "3. Vary sentence length and structure (mix short and long).\n"
    "4. Use contractions (it's, don't, you're) where natural.\n"
    "5. Replace AI clichés: furthermore, moreover, additionally, delve, tapestry, navigate, complexities, "
    "in the realm of, it is important to note, a testament to, underscores, vibrant, multifaceted.\n"
    "6. Use casual transitions where they fit (but, so, then, anyway).\n"
    "7. Output ONLY the rewritten text. No preamble. No explanation. No quotes around the output.\n"
    "8. Do NOT invent any new fact, name, number, award, publication, or quote. If unsure, keep the input as-is."
)


def _is_short(text: str) -> bool:
    """Route to BART for short inputs, Ollama gemma3:4b for long."""
    return len(text.split()) <= SHORT_WORD_CAP


def _chunk_sentences(text: str, max_words: int = 110) -> list:
    """Split at sentence boundaries into <=max_words chunks (for the
    chunked-BART long-text path)."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    chunks, cur, cur_len = [], [], 0
    for s in sentences:
        w = len(s.split())
        if cur_len + w > max_words and cur:
            chunks.append(" ".join(cur))
            cur, cur_len = [], 0
        cur.append(s)
        cur_len += w
    if cur:
        chunks.append(" ".join(cur))
    return chunks


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
    """Second detector for ensemble ranking — generalizes to unseen checkers."""
    try:
        tokenizer = AutoTokenizer.from_pretrained(ENSEMBLE_DETECTOR_ID)
        model = AutoModelForSequenceClassification.from_pretrained(ENSEMBLE_DETECTOR_ID)
        model.eval()
        return tokenizer, model
    except Exception:
        logger.exception("ensemble detector %s failed to load — single-detector mode", ENSEMBLE_DETECTOR_ID)
        return None, None


def _load_short_humanizer():
    """Load cive202 BART-large (406M) — sub-1B specialized humanizer."""
    tokenizer = AutoTokenizer.from_pretrained(SHORT_HUMANIZER_ID)
    model = AutoModelForSeq2SeqLM.from_pretrained(SHORT_HUMANIZER_ID)
    model.eval()
    return tokenizer, model


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("loading detector=%s ; short humanizer=%s ; long humanizer=ollama:%s at %s",
                DETECTOR_MODEL_ID, SHORT_HUMANIZER_ID, LONG_MODEL, OLLAMA_BASE_URL)
    t0 = time.perf_counter()
    state["detector_tokenizer"], state["detector_model"] = _load_detector()
    state["detector2_tokenizer"], state["detector2_model"] = _load_detector2()
    state["short_humanizer_tokenizer"], state["short_humanizer_model"] = _load_short_humanizer()

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
    version="2.0.0",
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

    if _is_short(req.text):
        # Fine-tuned BART humanizer with sampling-based best-of-N: beam search
        # collapses to generic AI-like output (detector ~0.99); sampling N diverse
        # candidates and keeping the least AI-looking one (per the loaded detector)
        # measured ~0.38 mean AI-probability on held-out pairs.
        tokenizer = state["short_humanizer_tokenizer"]
        model = state["short_humanizer_model"]
        det_tok = state["detector_tokenizer"]
        det_model = state["detector_model"]
        det2_tok = state.get("detector2_tokenizer")
        det2_model = state.get("detector2_model")
        inputs = tokenizer(req.text, return_tensors="pt", max_length=1024, truncation=True)

        def _model_ai_prob(tok_, mdl_, txt: str) -> float:
            enc = tok_(txt, return_tensors="pt", truncation=True, max_length=512)
            with torch.no_grad():
                probs = torch.softmax(mdl_(**enc).logits, dim=-1)[0].tolist()
            id2l = mdl_.config.id2label
            human_p = max((p for lbl, p in zip(id2l.values(), probs)
                           if any(a in lbl.lower() for a in ("human", "real"))), default=0.0)
            return 1.0 - human_p

        def _ai_prob(txt: str) -> float:
            """Ensemble: mean of two open detectors generalizes better to
            unseen checkers (ZeroGPT/Turnitin-style) than a single model."""
            p = _model_ai_prob(det_tok, det_model, txt)
            if det2_model is not None:
                p = (p + _model_ai_prob(det2_tok, det2_model, txt)) / 2.0
            return p

        def _f1_gen(src: str, c: str) -> float:
            aw, bw = src.lower().split(), c.lower().split()
            common = set(aw) & set(bw)
            if not common:
                return 0.0
            p, r = len(common) / max(1, len(aw)), len(common) / max(1, len(bw))
            return 2 * p * r / max(1e-9, p + r)

        def _f1_vs_input(c: str) -> float:
            return _f1_gen(req.text, c)

        _NEG = ("not", "no", "never", "cannot", "can't", "don't", "doesn't", "didn't",
                "won't", "isn't", "aren't", "wasn't", "weren't", "without", "nor")
        _NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
        _ENT_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
        _ENT_STOP = {"the", "this", "that", "these", "those", "it", "in", "on",
                     "if", "furthermore", "moreover", "however", "consequently",
                     "additionally", "ultimately", "nevertheless", "first", "second",
                     "third", "finally", "to", "for", "and", "but", "so", "there",
                     "thus", "hence", "also", "such", "some", "any", "sometimes",
                     "people", "governments"}

        def _ents(t: str) -> set:
            return {w for w in _ENT_RE.findall(t) if w.lower() not in _ENT_STOP}

        def _neg_count(t: str) -> int:
            return sum(1 for w in t.lower().split() if w.strip(".,;:!'\"") in _NEG)

        def _meaning_ok(c: str) -> bool:
            """Hard meaning-preservation gate — the detector must never be
            fooled by hallucinated or truncated content."""
            # length: reject anything that lost or grew more than ~35%
            if not (0.65 <= len(c) / src_len <= 1.45):
                return False
            # numbers must survive (a lost "1.5 degrees" inverts facts)
            if _NUM_RE.findall(req.text) != _NUM_RE.findall(c):
                return False
            # no invented proper-noun entities ("UEC", "Federal Electricity Corporation of India")
            if _ents(c) - _ents(req.text):
                return False
            # negations must not appear/disappear (meaning inversion)
            if abs(_neg_count(c) - _neg_count(req.text)) > 1:
                return False
            # core topical overlap
            return _f1_vs_input(c) >= 0.40

        def _meaning_ok_gen(src: str, c: str) -> bool:
            """Meaning gate against an arbitrary source (input or chunk)."""
            sl = max(1, len(src))
            if not (0.65 <= len(c) / sl <= 1.45):
                return False
            if _NUM_RE.findall(src) != _NUM_RE.findall(c):
                return False
            if _ents(c) - _ents(src):
                return False
            if abs(_neg_count(c) - _neg_count(src)) > 1:
                return False
            return _f1_gen(src, c) >= 0.40

        def _meaning_ok(c: str) -> bool:
            return _meaning_ok_gen(req.text, c)

        def _pick_gen(src: str, cands: list) -> str:
            good = [c for c in cands if _meaning_ok_gen(src, c)]
            if good:
                return min(good, key=lambda c: _ai_prob(c) - 0.3 * _f1_gen(src, c))
            safer = [c for c in cands
                     if not (_ents(c) - _ents(src))
                     and _neg_count(c) == _neg_count(src) and c.strip()]
            if safer:
                return max(safer, key=lambda c: _f1_gen(src, c))
            return max(cands, key=lambda c: _f1_gen(src, c)) if cands else src

        def _pick(cands: list) -> str:
            return _pick_gen(req.text, cands)

        src_len = max(1, len(req.text))
        # Cap decode length to input+margin — an uncapped 1024 lets a rambling
        # sample multiply latency several-fold on the ARM CPU.
        gen_max = min(1024, int(inputs["input_ids"].shape[1] * 1.6) + 80)

        def _clean(c: str) -> str:
            c = c.strip()
            c = re.sub(r"([a-z])([A-Z][a-z])", r"\1 \2", c)
            c = re.sub(r"\b(\w+)( \1)+\b", r"\1", c, count=2)
            c = re.sub(r"^\s*(?:\d+\.\s*|[-*]\s+)", "", c)
            c = re.sub(r"\b([A-Z][a-z]{2,})([A-Z][a-z]{2,})\b", r"\1 \2", c)
            c = ". ".join(s[:1].upper() + s[1:] for s in c.split(". "))
            return c

        def _sample_round(temp: float) -> list:
            # longer inputs get fewer candidates so even round 1 fits the budget
            n_eff = BEST_OF_N if len(req.text.split()) <= 80 else 6
            try:
                with torch.no_grad():
                    outputs = model.generate(
                        **inputs,
                        max_length=gen_max,
                        do_sample=True,
                        temperature=temp,
                        top_p=0.95,
                        num_beams=1,
                        no_repeat_ngram_size=3,
                        num_return_sequences=n_eff,
                    )
                cands = [_clean(c) for c in tokenizer.batch_decode(outputs, skip_special_tokens=True)]
            except Exception:
                logger.exception("sampled generation failed")
                return []
            cands = [c for c in cands if c and not re.search(r"[a-z]{2}[A-Z][a-z]{2}", c)]
            return [c for c in cands if 0.45 < len(c) / src_len < 1.7]

        # Adaptive resampling with a MEANING-FIRST gate: candidates that drop
        # numbers, invent entities, flip negations, or drift too far are
        # disqualified outright — detectors cannot tell "human-sounding" from
        # "broken", so the gate does that job. Among safe candidates we take
        # the least AI-looking; resampling continues if none is safe yet.
        # HARD TIME BUDGET: Vercel Hobby clamps functions to 60s and its client
        # aborts upstream at ~110s — never sample past 30s elapsed.
        base_temp = max(0.5, min(1.0, req.temperature + 0.2))
        pool: list = []
        best_c = None
        for round_temp in (base_temp, min(1.15, base_temp + 0.15), min(1.25, base_temp + 0.3)):
            pool.extend(_sample_round(round_temp))
            if pool:
                best_c = _pick(pool)
                if _meaning_ok(best_c) and _ai_prob(best_c) < RESAMPLE_THRESHOLD:
                    break
            if (time.perf_counter() - t0) > 20:
                break

        # No meaning-safe candidate after all rounds? Ship the BEAM output —
        # it is fluent and faithful. Broken text must never ship even if the
        # detector scores broken prose as "human".
        if best_c is None or not (_meaning_ok(best_c) and _f1_vs_input(best_c) >= 0.50):
            try:
                with torch.no_grad():
                    outputs = model.generate(
                        **inputs,
                        max_length=gen_max,
                        num_beams=2,
                        no_repeat_ngram_size=3,
                        length_penalty=1.0,
                        early_stopping=True,
                    )
                beam_c = _clean(tokenizer.decode(outputs[0], skip_special_tokens=True))
                if beam_c:
                    if best_c is None or _meaning_ok(beam_c) or _f1_gen(req.text, beam_c) > _f1_vs_input(best_c):
                        best_c = beam_c
            except Exception:
                logger.exception("beam fallback failed")
        if best_c is None:
            best_c = req.text
        out = best_c
        used_model = f"bart:{SHORT_HUMANIZER_ID}+bon{BEST_OF_N}{'x2' if det2_model is not None else ''}"
    else:
        # Long input: chunk at sentence boundaries and humanize each chunk
        # through the short-text ensemble pipeline (gemma3:4b stays as the
        # fallback if the chunked path fails).
        try:
            chunks = _chunk_sentences(req.text)
            if len(chunks) <= 1 or len(chunks) > 3:
                raise ValueError("chunk count out of batchable range")
            # Batch ALL chunks in ONE generate pass (sequential per-chunk calls
            # blew past Vercel's 110s upstream fetch budget on the ARM CPU).
            n_per = 4
            enc_chunks = tokenizer(chunks, return_tensors="pt", padding=True,
                                   truncation=True, max_length=512)
            in_len = enc_chunks["input_ids"].shape[1]
            ch_max = min(700, int(in_len * 1.6) + 64)
            rep = {k: v.repeat_interleave(n_per, dim=0) for k, v in enc_chunks.items()}
            with torch.no_grad():
                outputs = model.generate(
                    **rep,
                    max_length=ch_max,
                    do_sample=True,
                    temperature=max(0.5, min(1.0, req.temperature + 0.2)),
                    top_p=0.95,
                    num_beams=1,
                    no_repeat_ngram_size=3,
                )
            decs = [_clean(c) for c in tokenizer.batch_decode(outputs, skip_special_tokens=True)]
            parts = []
            for ci, chunk in enumerate(chunks):
                seg = decs[ci * n_per:(ci + 1) * n_per]
                seg = [c for c in seg if c and not re.search(r"[a-z]{2}[A-Z][a-z]{2}", c)]
                seg = [c for c in seg if 0.65 <= len(c) / max(1, len(chunk)) <= 1.45]
                # same meaning-first gate as the short path (per chunk)
                parts.append(_pick_gen(chunk, seg) if seg else chunk)
            out = " ".join(parts)
            used_model = f"bart:{SHORT_HUMANIZER_ID}+bon{n_per}+chunked"
        except Exception:
            logger.exception("chunked short-path failed; falling back to ollama")
            payload = {
                "model": LONG_MODEL,
                "messages": [
                    {"role": "system", "content": HUMANIZE_SYSTEM_PROMPT},
                    {"role": "user", "content": req.text},
                ],
                "stream": False,
                "options": {
                    "temperature": req.temperature,
                    "top_p": 0.95,
                    "num_predict": max(2048, len(req.text) * 2),
                },
            }
            try:
                async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
                    r = await client.post(
                        f"{OLLAMA_BASE_URL}/api/chat",
                        json=payload,
                        headers={"Content-Type": "application/json"},
                    )
            except httpx.HTTPError as e:
                raise HTTPException(502, f"Ollama unreachable: {e}") from e
            if r.status_code != 200:
                raise HTTPException(502, f"Ollama returned {r.status_code}: {r.text[:300]}")
            try:
                data = r.json()
                out = data.get("message", {}).get("content", "").strip()
                if not out:
                    raise HTTPException(502, f"Ollama returned empty content. Full body: {data}")
            except (ValueError, KeyError) as e:
                raise HTTPException(502, f"Malformed Ollama response: {e}") from e
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
