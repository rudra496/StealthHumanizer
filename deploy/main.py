"""StealthHumanizer model server v4 — background-job architecture.

Endpoints (behind nginx key auth):
  POST /humanize/          - synchronous best-of-N humanization (API users)
  POST /job/start          - start a humanization job, returns {"id"} immediately
  GET  /job/status/{id}    - poll: {"status": "running"|"done"|"error", ...}
  POST /grammar/           - LLM grammar fix (gemma, anti-echo prompt)
  POST /detect/            - two-detector ensemble AI verdict
  GET  /health             - liveness probe (no auth)

Why jobs: browsers on some networks cannot reach this host directly
(no-cors probe rejected — sslip.io DNS/embedded-browser restrictions), and
Vercel Hobby kills functions at 60s. The site therefore starts a job and
polls through its own same-origin Vercel route: each hop is a ~100ms server
call while the 80-100s best-of-4 sampling runs here uninterrupted.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
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

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://172.18.0.1:11434")
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "150"))
LONG_MODEL = os.environ.get("OLLAMA_HUMANIZER_LONG", "gemma3:4b")

# Job lifecycle: hard cap sampling well inside the frontend's poll window.
JOB_BUDGET_S = 100
JOB_TTL_S = 900          # finished jobs pruned after 15 min
MAX_RUNNING_JOBS = 3     # protect the free ARM box

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
    "7. Do NOT add second-person pronouns (you, your, you'll) or the filler 'you know' unless the "
    "original text already has them. Mild spoken words (basically, 'messes up') are fine.\n"
    "8. Output ONLY the rewritten text. No preamble. No explanation. No quotes around the output."
)

GRAMMAR_SYSTEM_PROMPT = (
    "You are a grammar and spelling checker. Fix ONLY grammar, spelling, and punctuation errors "
    "in the user's text. RULES:\n"
    "1. Do NOT change the wording, style, or sentence structure beyond the error fixes.\n"
    "2. Preserve ALL meaning, facts, names, numbers, and citations exactly.\n"
    "3. Keep the same length and the same sentences.\n"
    "4. Output ONLY the corrected text. No preamble. No explanation. No quotes."
)

state: dict = {}
jobs: dict = {}


# ============================== core logic ==============================

async def _one_gemma_sample(text: str, temp: float) -> str:
    payload = {
        "model": LONG_MODEL,
        "stream": False,
        "keep_alive": -1,
        "messages": [
            {"role": "system", "content": HUMANIZE_SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "options": {"temperature": temp, "top_p": 0.95,
                    "num_predict": max(700, len(text) // 2)},
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
    return r.json().get("message", {}).get("content", "").strip() if r is not None else ""


def _clean_candidate(c: str) -> str:
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


def _f1_vs(src: str, c: str) -> float:
    aw, bw = src.lower().split(), c.lower().split()
    common = set(aw) & set(bw)
    if not common:
        return 0.0
    p = len(common) / max(1, len(aw))
    r = len(common) / max(1, len(bw))
    return 2 * p * r / max(1e-9, p + r)


def _meaning_ok(src: str, c: str) -> bool:
    sl = max(1, len(src))
    if not (0.6 <= len(c) / sl <= 1.6):
        return False
    if sorted(_NUM_RE.findall(src)) != sorted(_NUM_RE.findall(c)):
        return False
    if _ents(c) - _ents(src):
        return False
    if abs(_neg_count(c) - _neg_count(src)) > 1:
        return False
    return _f1_vs(src, c) >= 0.30


def _one_detector_prob(tok_, mdl_, txt: str) -> float:
    enc = tok_(txt, return_tensors="pt", truncation=True, max_length=512)
    with torch.no_grad():
        probs = torch.softmax(mdl_(**enc).logits, dim=-1)[0].tolist()
    id2l = mdl_.config.id2label
    human_p = max((p for lbl, p in zip(id2l.values(), probs)
                   if any(a in lbl.lower() for a in ("human", "real"))), default=0.0)
    return 1.0 - human_p


def _ensemble_ai_prob(txt: str) -> float:
    p = _one_detector_prob(state["detector_tokenizer"], state["detector_model"], txt)
    det2_model = state.get("detector2_model")
    if det2_model is not None:
        p = (p + _one_detector_prob(state["detector2_tokenizer"], det2_model, txt)) / 2.0
    return p


async def _run_humanize(text: str, temperature: float, samples: int) -> dict:
    """Best-of-N gemma sampling + cleanup + meaning gate + ensemble ranking."""
    t0 = time.perf_counter()
    base_temp = max(0.7, min(1.0, temperature))
    n = min(4, max(1, samples))
    temps = [base_temp, min(1.15, base_temp + 0.25),
             min(1.25, base_temp + 0.4), min(1.3, base_temp + 0.5)][:n]

    tasks = [asyncio.ensure_future(_one_gemma_sample(text, t)) for t in temps]
    done, pending = await asyncio.wait(tasks, timeout=JOB_BUDGET_S)
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
        logger.error("all %d samples failed within %ss budget", n, JOB_BUDGET_S)
        cands = [text]

    cands = [_clean_candidate(c) for c in cands]
    cands = [c for c in cands if c]
    if len(cands) >= 2 and cands[0] == cands[1]:
        cands = cands[:1]

    safe = [c for c in cands if _meaning_ok(text, c)]
    pool = safe or [c for c in cands if _f1_vs(text, c) >= 0.25] or cands

    out = min(pool, key=_ensemble_ai_prob) if pool else text
    out_ai_prob = _ensemble_ai_prob(out) if out else 1.0
    if len(out) >= 2 and out[0] == out[-1] and out[0] in ('"', "'", "`"):
        out = out[1:-1].strip()

    n_ok = len(cands)
    return {
        "humanized": out,
        "model": f"ollama:{LONG_MODEL}+bo{n}{'x2' if state.get('detector2_model') is not None else ''}",
        "ai_probability": float(out_ai_prob),
        "candidates": n_ok,
        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
    }


async def _run_job(job_id: str, text: str, temperature: float, samples: int):
    try:
        jobs[job_id]["result"] = await _run_humanize(text, temperature, samples)
        jobs[job_id]["status"] = "done"
    except Exception as e:
        logger.exception("job %s failed", job_id)
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)[:300]
    finally:
        jobs[job_id]["finished_at"] = time.time()


def _prune_jobs():
    now = time.time()
    stale = [jid for jid, j in jobs.items()
             if j.get("finished_at") and now - j["finished_at"] > JOB_TTL_S]
    for jid in stale:
        jobs.pop(jid, None)


# ============================== models ==============================

class HumanizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)
    temperature: float = Field(0.7, ge=0.1, le=2.0)
    samples: int = Field(4, ge=1, le=4)


class HumanizeResponse(BaseModel):
    humanized: str
    model: str
    elapsed_ms: int
    ai_probability: float = 0.0


class JobStartRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)
    temperature: float = Field(0.85, ge=0.1, le=2.0)
    samples: int = Field(4, ge=1, le=4)


class DetectRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)


class DetectResponse(BaseModel):
    label: Literal["human", "ai"]
    ai_probability: float
    human_probability: float
    model: str
    elapsed_ms: int


class GrammarRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)


class GrammarResponse(BaseModel):
    corrected: str
    model: str
    elapsed_ms: int


def _load_detector():
    tokenizer = AutoTokenizer.from_pretrained(DETECTOR_MODEL_ID)
    model = AutoModelForSequenceClassification.from_pretrained(DETECTOR_MODEL_ID)
    model.eval()
    return tokenizer, model


def _load_detector2():
    try:
        tokenizer = AutoTokenizer.from_pretrained(ENSEMBLE_DETECTOR_ID)
        model = AutoModelForSequenceClassification.from_pretrained(ENSEMBLE_DETECTOR_ID)
        model.eval()
        return tokenizer, model
    except Exception:
        logger.exception("ensemble detector %s failed to load", ENSEMBLE_DETECTOR_ID)
        return None, None


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("loading detector=%s (+%s) ; humanizer=ollama:%s at %s",
                DETECTOR_MODEL_ID, ENSEMBLE_DETECTOR_ID, LONG_MODEL, OLLAMA_BASE_URL)
    t0 = time.perf_counter()
    state["detector_tokenizer"], state["detector_model"] = _load_detector()
    state["detector2_tokenizer"], state["detector2_model"] = _load_detector2()

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            tags = r.json() if r.status_code == 200 else {}
            available = {m.get("name", "") for m in tags.get("models", [])}
            if LONG_MODEL in available or any(a.startswith(LONG_MODEL) for a in available):
                logger.info("Ollama model %s available", LONG_MODEL)
            else:
                logger.warning("Ollama model %s not in %s", LONG_MODEL, available)
    except Exception as e:
        logger.warning("Ollama warmup probe failed: %s", e)

    logger.info("models loaded in %.1fs", time.perf_counter() - t0)
    yield
    state.clear()
    jobs.clear()


app = FastAPI(title="StealthHumanizer Models", version="4.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "loaded": bool(state)}


# ============================== endpoints ==============================

@app.post("/humanize/", response_model=HumanizeResponse)
async def humanize(req: HumanizeRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    r = await _run_humanize(req.text, req.temperature, req.samples)
    return HumanizeResponse(**{k: r[k] for k in ("humanized", "model", "elapsed_ms", "ai_probability")})


@app.post("/job/start")
async def job_start(req: JobStartRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    _prune_jobs()
    running = sum(1 for j in jobs.values() if j["status"] == "running")
    if running >= MAX_RUNNING_JOBS:
        raise HTTPException(429, "server busy — try again in a moment")
    job_id = uuid.uuid4().hex[:16]
    jobs[job_id] = {"status": "running", "created_at": time.time()}
    asyncio.create_task(_run_job(job_id, req.text, req.temperature, req.samples))
    return {"id": job_id}


@app.get("/job/status/{job_id}")
async def job_status(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "unknown job")
    resp = {"status": job["status"]}
    if job["status"] == "done":
        resp.update(job["result"])
    elif job["status"] == "error":
        resp["error"] = job.get("error", "unknown error")
    return resp


@app.post("/grammar/", response_model=GrammarResponse)
async def grammar(req: GrammarRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    t0 = time.perf_counter()
    try:
        payload = {
            "model": LONG_MODEL,
            "stream": False,
            "keep_alive": -1,
            "messages": [
                {"role": "system", "content": GRAMMAR_SYSTEM_PROMPT},
                {"role": "user", "content": req.text},
            ],
            "options": {"temperature": 0.3, "top_p": 0.95,
                        "num_predict": max(700, len(req.text) // 2)},
        }
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload,
                                  headers={"Content-Type": "application/json"})
        out = r.json().get("message", {}).get("content", "").strip() if r.status_code == 200 else ""
        if not out or len(out) < len(req.text) // 3:
            raise ValueError("empty or truncated grammar response")
    except Exception:
        logger.exception("grammar fix failed")
        raise HTTPException(502, "grammar model unavailable")
    if len(out) >= 2 and out[0] == out[-1] and out[0] in ('"', "'", "`"):
        out = out[1:-1].strip()
    return GrammarResponse(corrected=out, model=f"ollama:{LONG_MODEL}",
                           elapsed_ms=int((time.perf_counter() - t0) * 1000))


@app.post("/detect/", response_model=DetectResponse)
async def detect(req: DetectRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    t0 = time.perf_counter()
    ai1, human1 = _detector_probs(state["detector_tokenizer"], state["detector_model"], req.text)
    det2_model = state.get("detector2_model")
    if det2_model is not None:
        ai2, human2 = _detector_probs(state["detector2_tokenizer"], det2_model, req.text)
        ai_p = (ai1 + ai2) / 2.0
        used = f"ensemble:{DETECTOR_MODEL_ID}+{ENSEMBLE_DETECTOR_ID}"
    else:
        ai_p = ai1
        used = DETECTOR_MODEL_ID
    label = "ai" if ai_p >= 0.5 else "human"
    return DetectResponse(label=label, ai_probability=float(ai_p),
                          human_probability=float(1.0 - ai_p), model=used,
                          elapsed_ms=int((time.perf_counter() - t0) * 1000))


def _detector_probs(tok_, mdl_, text: str) -> tuple:
    inputs = tok_(text, return_tensors="pt", truncation=True, max_length=512, padding=True)
    with torch.no_grad():
        logits = mdl_(**inputs).logits
    probs = torch.softmax(logits, dim=-1)[0].tolist()
    id2label = mdl_.config.id2label
    label_to_prob = {id2label[i].lower(): probs[i] for i in range(len(probs))}
    human_aliases = ("human", "real", "label_0", "0")
    ai_aliases = ("ai", "ai-generated", "chatgpt", "fake", "label_1", "1")
    human_p = max((label_to_prob.get(a, 0.0) for a in human_aliases), default=0.0)
    ai_p = max((label_to_prob.get(a, 0.0) for a in ai_aliases), default=0.0)
    if human_p + ai_p <= 0:
        ai_p = 1.0 - label_to_prob.get(id2label[0].lower(), 0.0)
    return ai_p, 1.0 - ai_p
