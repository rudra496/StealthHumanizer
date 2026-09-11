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

    # ===== Long input (>SHORT_WORD_CAP words): gemma3:4b via Ollama =====
    # The proven previous structure: the instruction model handles long-form
    # with the anti-detection system prompt (~25-90s); the BART ensemble below
    # handles short text with per-sentence best-of-N.
    if not _is_short(req.text):
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
                            "top_p": 0.95, "num_predict": max(2048, len(req.text) * 2)},
            }
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
                r = None
                for attempt in range(2):  # transient failures while ollama (re)loads a model
                    r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload,
                                          headers={"Content-Type": "application/json"})
                    if r.status_code == 200:
                        break
                    logger.error("OLLAMA_DEBUG status=%s body=%s url=%s", r.status_code, r.text[:200], f"{OLLAMA_BASE_URL}/api/chat")
                    await asyncio.sleep(2)
            out = r.json().get("message", {}).get("content", "").strip() if r is not None else ""
            if not out:
                raise ValueError("empty ollama response")
        except Exception:
            logger.exception("gemma long-path failed; returning input unchanged")
            out = req.text
        if len(out) >= 2 and out[0] == out[-1] and out[0] in ('"', "'", "`"):
            out = out[1:-1].strip()
        return HumanizeResponse(
            humanized=out,
            model=f"ollama:{LONG_MODEL}",
            elapsed_ms=int((time.perf_counter() - t0) * 1000),
        )

    # ===== Per-sentence humanization pipeline =====
    # Each input sentence is rewritten independently with best-of-N sampling;
    # the winner per sentence is chosen by the detector ensemble under a strict
    # per-sentence meaning gate. Sentence count and order are preserved by
    # construction, so structure never changes. Works for every input length.
    tokenizer = state["short_humanizer_tokenizer"]
    model = state["short_humanizer_model"]
    det_tok = state["detector_tokenizer"]
    det_model = state["detector_model"]
    det2_tok = state.get("detector2_tokenizer")
    det2_model = state.get("detector2_model")

    def _model_ai_prob(tok_, mdl_, txt: str) -> float:
        enc = tok_(txt, return_tensors="pt", truncation=True, max_length=512)
        with torch.no_grad():
            probs = torch.softmax(mdl_(**enc).logits, dim=-1)[0].tolist()
        id2l = mdl_.config.id2label
        human_p = max((p for lbl, p in zip(id2l.values(), probs)
                       if any(a in lbl.lower() for a in ("human", "real"))), default=0.0)
        return 1.0 - human_p

    def _ai_prob(txt: str) -> float:
        """Ensemble of two open detectors — generalizes to unseen checkers."""
        p = _model_ai_prob(det_tok, det_model, txt)
        if det2_model is not None:
            p = (p + _model_ai_prob(det2_tok, det2_model, txt)) / 2.0
        return p

    _NEG = ("not", "no", "never", "cannot", "can't", "don't", "doesn't", "didn't",
            "won't", "isn't", "aren't", "wasn't", "weren't", "without", "nor")
    _NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
    _ENT_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
    _ENT_STOP = {"the", "this", "that", "these", "those", "it", "in", "on",
                 "if", "furthermore", "moreover", "however", "consequently",
                 "additionally", "ultimately", "nevertheless", "first", "second",
                 "third", "finally", "to", "for", "and", "but", "so", "there",
                 "thus", "hence", "also", "such", "some", "any", "sometimes",
                 "people"}

    def _ents(t: str) -> set:
        return {w for w in _ENT_RE.findall(t) if w.lower() not in _ENT_STOP}

    def _neg_count(t: str) -> int:
        return sum(1 for w in t.lower().split() if w.strip(".,;:!?'\"") in _NEG)

    def _f1_gen(src: str, c: str) -> float:
        aw, bw = src.lower().split(), c.lower().split()
        common = set(aw) & set(bw)
        if not common:
            return 0.0
        p, r = len(common) / max(1, len(aw)), len(common) / max(1, len(bw))
        return 2 * p * r / max(1e-9, p + r)

    def _split_sentences(text: str) -> list:
        parts = re.split(r"(?<=[.!?])\s+", text.strip())
        return [p.strip() for p in parts if p.strip()]

    def _clean_sentence(c: str) -> str:
        c = c.strip()
        c = re.sub(r"([a-z])([A-Z][a-z])", r"\1 \2", c)
        c = re.sub(r"\b(\w+)( \1)+\b", r"\1", c, count=2, flags=re.I)
        c = re.sub(r"\b([A-Z][a-z]{2,})([A-Z][a-z]{2,})\b", r"\1 \2", c)
        c = re.sub(r"\s+([,.;:!?])", r"\1", c)
        c = re.sub(r"([,.;:!?]){2,}", r"\1", c)
        c = re.sub(r"[ \t]{2,}", " ", c)
        c = re.sub(r"^(?:and|but|so|also|moreover|furthermore)[, ]+", "", c, flags=re.I)
        if not re.search(r"[.!?]$", c):
            c = c.rstrip(",;:") + "."
        if c and c[0].islower():
            c = c[0].upper() + c[1:]
        return c

    def _sentence_ok(src: str, c: str) -> bool:
        """Per-sentence meaning gate — strict on facts, loose on phrasing."""
        sw = len(src.split())
        if abs(sw - len(c.split())) > max(4, int(sw * 0.45)):
            return False
        if sorted(_NUM_RE.findall(src)) != sorted(_NUM_RE.findall(c)):
            return False
        if _ents(c) - _ents(src):
            return False
        if abs(_neg_count(c) - _neg_count(src)) > 1:
            return False
        return _f1_gen(src, c) >= 0.42

    def _pick_sentence(src: str, cands: list) -> str:
        good = [c for c in cands if _sentence_ok(src, c)]
        if good:
            return min(good, key=lambda c: _ai_prob(c) - 0.2 * _f1_gen(src, c))
        safer = [c for c in cands
                 if not (_ents(c) - _ents(src))
                 and _neg_count(c) == _neg_count(src) and len(c.split()) >= 4]
        if safer:
            return max(safer, key=lambda c: _f1_gen(src, c))
        return src  # keep the original sentence — never ship a broken rewrite

    sentences = _split_sentences(req.text)
    if not sentences:
        raise HTTPException(400, "no sentences found")
    # candidate budget: more sentences -> fewer per sentence (batch fits CPU)
    n_per = 5 if len(sentences) <= 14 else 4
    sentences = sentences[:60]  # absolute cap; the tail would exceed budgets

    base_temp = max(0.6, min(1.0, req.temperature + 0.25))
    try:
        enc = tokenizer(sentences, return_tensors="pt", padding=True,
                        truncation=True, max_length=256)
        rep = {k: v.repeat_interleave(n_per, dim=0) for k, v in enc.items()}
        with torch.no_grad():
            outputs = model.generate(
                **rep,
                max_length=120,
                do_sample=True,
                temperature=base_temp,
                top_p=0.95,
                num_beams=1,
                no_repeat_ngram_size=3,
            )
        decs = tokenizer.batch_decode(outputs, skip_special_tokens=True)
    except Exception:
        logger.exception("sentence-wise sampling failed")
        sentences, decs = _split_sentences(req.text), []

    _SHORT_OK = {"a", "an", "in", "on", "it", "is", "be", "to", "of", "we",
                 "he", "as", "at", "by", "or", "if", "do", "no", "so", "up",
                 "us", "my", "me", "am", "tv"}

    def _degenerate(c: str) -> bool:
        letters = sum(ch.isalpha() for ch in c)
        if letters / max(1, len(c)) < 0.78:
            return True
        return any(sym in c for sym in ("+", "=", "#", "~", "^", "<", ">"))

    def _filter_cands(src_sentence: str, cands: list) -> list:
        """Quality filters shared by both sampling passes."""
        src_tokens = {w.lower().strip(".,;:!?") for w in src_sentence.split()}
        out = []
        for c in cands:
            if not c or len(c.split()) < 3 or _degenerate(c):
                continue
            if re.search(r"[a-z]{2}[A-Z][a-z]{2}", c):
                continue
            # split-word fragments ("Ar tic") — short token neither common
            # nor present in the source sentence
            if any(len(w) <= 3 and w.lower().strip(".,;:!?") not in _SHORT_OK
                   and w.lower().strip(".,;:!?") not in src_tokens
                   for w in c.split() if w.isalpha()):
                continue
            # parens in the candidate when the source has none = garbled prefix
            if "(" not in src_sentence and "(" in c:
                continue
            out.append(c)
        return out

    picked_by_index: dict = {}
    for si, src_sentence in enumerate(sentences):
        cands = _filter_cands(src_sentence,
                              [_clean_sentence(c) for c in decs[si * n_per:(si + 1) * n_per]])
        picked_by_index[si] = _pick_sentence(src_sentence, cands)

    # Targeted retry: hard sentences that fell back to the original get one
    # hotter sampling round — more candidates, another chance at a safe rewrite.
    retry_indices = [si for si, s in enumerate(sentences)
                     if picked_by_index.get(si) == s]
    if retry_indices and (time.perf_counter() - t0) < 32:
        for si in retry_indices:
            src_sentence = sentences[si]
            enc_r = tokenizer([src_sentence], return_tensors="pt", truncation=True, max_length=256)
            try:
                with torch.no_grad():
                    outputs_r = model.generate(
                        **enc_r,
                        max_length=192,
                        do_sample=True,
                        temperature=min(1.1, base_temp + 0.15),
                        top_p=0.95,
                        num_beams=1,
                        no_repeat_ngram_size=3,
                        num_return_sequences=8,
                    )
                r_cands = [_clean_sentence(c) for c in tokenizer.batch_decode(outputs_r, skip_special_tokens=True)]
            except Exception:
                continue
            r_cands = _filter_cands(src_sentence, r_cands)
            if r_cands:
                picked_by_index[si] = _pick_sentence(src_sentence, r_cands)

    out = " ".join(picked_by_index.get(si, s) for si, s in enumerate(sentences))
    used_model = f"bart:{SHORT_HUMANIZER_ID}+sent{n_per}{'x2' if det2_model is not None else ''}"

    # ===== Stage 2: Granite casual-voice restyle =====
    # The BART pass preserves structure and facts; Granite (instruction-tuned,
    # thinking disabled) then shifts the register to a natural human voice —
    # the combination measured 0% AI on ZeroGPT. Meaning gate vs the ORIGINAL
    # input decides whether the restyle ships; time-bounded for Vercel.
    if (time.perf_counter() - t0) < 20 and out.strip():
        try:
            granite_payload = {
                "model": LONG_MODEL,
                "stream": False,
                "think": False,
                "keep_alive": -1,
                "messages": [
                    {"role": "system", "content": "Rewrite the text in a casual, natural human voice, like a student explaining to a friend. RULES: 1) Keep EVERY fact, number and point. 2) Keep the same sentence order. 3) Use simple words and contractions. 4) Output ONLY the rewritten text."},
                    {"role": "user", "content": out},
                ],
                "options": {"temperature": 0.9, "top_p": 0.95, "num_predict": 500},
            }
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=granite_payload,
                                      headers={"Content-Type": "application/json"})
            g_raw = r.json().get("message", {}).get("content", "").strip()
            g_text = _clean_sentence(g_raw) if g_raw else ""
            gate_ok = (
                g_text and len(g_text.split()) >= 8
                and 0.6 <= len(g_text) / max(1, len(req.text)) <= 1.6
                and sorted(_NUM_RE.findall(req.text)) == sorted(_NUM_RE.findall(g_text))
                and not (_ents(g_text) - _ents(req.text))
                and _f1_gen(req.text, g_text) >= 0.30
            )
            if gate_ok:
                out = g_text
                used_model += "+granite"
        except Exception:
            logger.exception("granite restyle failed; keeping BART output")

    if not out.strip():
        # last resort: gemma3:4b with the anti-detection prompt
        payload = {
            "model": LONG_MODEL,
            "messages": [
                {"role": "system", "content": HUMANIZE_SYSTEM_PROMPT},
                {"role": "user", "content": req.text},
            ],
            "stream": False,
            "options": {"temperature": req.temperature, "top_p": 0.95,
                        "num_predict": max(2048, len(req.text) * 2)},
        }
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
                r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload,
                                      headers={"Content-Type": "application/json"})
            out = r.json().get("message", {}).get("content", "").strip() or req.text
        except Exception:
            logger.exception("gemma fallback failed")
            out = req.text
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
