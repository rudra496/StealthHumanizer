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
import json
import logging
import os
import re
import subprocess
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
JOB_BUDGET_S = 130
OLLAMA_SEMAPHORE = asyncio.Semaphore(1)  # serialize gemma calls to prevent ARM core starvation
JOB_TTL_S = 900          # finished jobs pruned after 15 min
MAX_RUNNING_JOBS = 2     # protect the free ARM box

STYLE_PROMPTS = {
    "professional": (
        "You are an elite senior human editor and prose stylist. Rewrite the user's text into articulate, authentic human prose that completely bypasses AI detectors.\n"
        "CRITICAL RULES:\n"
        "1. ZERO HALLUCINATION: Preserve 100% of all facts, data, numbers, dates, technical names, and core arguments. Never invent new statistics or dates.\n"
        "2. High Burstiness: Drastically vary sentence length. Mix punchy short sentences (3-7 words) with complex, compound explanations (18-30 words). Never repeat the same rhythmic cadence.\n"
        "3. Complete Structural Rewrite: Dismantle the AI syntax. Do NOT follow the original clause sequence or sentence templates. Change the order of ideas and reframe points through concrete action.\n"
        "4. Ban All Formulaic AI Markers: Never use furthermore, moreover, additionally, consequently, in conclusion, it is important to note, delve, tapestry, multifaceted, pivotal, revolutionize, indispensable, transformative paradigm shift, paramount, foster, leverage, landscape, beacon, testament, catalyst, operational dynamics.\n"
        "5. Natural Flow: Connect ideas organically with punctuation (colons, dashes, semicolons) and direct logic rather than mechanical transition adverbs.\n"
        "6. Active and concrete voice: Replace abstract passive nominalizations ('the implementation of X facilitates Y') with direct, active human phrasing.\n"
        "7. Output ONLY the rewritten text. No preamble, no quotes, no markdown explanations."
    ),
    "academic": (
        "You are an accomplished scholar and journal peer reviewer. Rewrite the user's text into rigorous, authentic academic prose as written by leading human researchers.\n"
        "CRITICAL RULES:\n"
        "1. ZERO HALLUCINATION: Retain all citations, equations, numbers, datasets, specialized domain nomenclature, and logical argumentation with 100% fidelity. Never invent new data.\n"
        "2. Syntactic Sophistication: Employ varied, complex human syntactic structures (fronting dependent clauses, using semicolons, contrasting empirical observations). Avoid repetitive passive templates.\n"
        "3. High Rhythm Variation: Intersperse concise, authoritative declarations with nuanced, detailed analytical observations.\n"
        "4. Zero AI Clichés: Strictly avoid furthermore, moreover, additionally, consequently, in conclusion, it is crucial to note that, underscores, multifaceted, tapestry, delve into, pivotal role, paramount, catalyst.\n"
        "5. Scholarly Discourse: Use precise scholarly transitions (Notably, Empirical findings suggest, Conversely, In particular, To evaluate this dynamic).\n"
        "6. Formal, authoritative human register without artificial corporate padding.\n"
        "7. Output ONLY the rewritten academic text. No preamble, no quotes."
    ),
    "casual": (
        "You are a natural, relatable human writer. Rewrite the user's text into engaging, conversational human prose that feels completely authentic and unscripted.\n"
        "CRITICAL RULES:\n"
        "1. ZERO HALLUCINATION: Keep all facts, names, technical specifics, and points completely intact. Do not invent facts.\n"
        "2. Conversational Cadence: Use natural contractions (don't, it's, they're, we've, you'll) and everyday, relatable vocabulary.\n"
        "3. High Burstiness: Drop in very short, punchy statements (2-5 words). Follow with lively, descriptive thoughts. Break all rigid rhythms.\n"
        "4. Eliminate Robotic Tone: Remove corporate buzzwords, stiff jargon, and formulaic transitional phrases.\n"
        "5. Output ONLY the rewritten text. No preamble, no quotes."
    ),
    "stealth": (
        "You are an undetectable human prose specialist. Rewrite the user's text with maximum entropy and authentic human irregularity to bypass all neural AI classifiers.\n"
        "CRITICAL RULES:\n"
        "1. ZERO HALLUCINATION: Preserve every fact, number, technical term, and argument with 100% accuracy. Absolute rule: NEVER invent new numbers, percentages, dates, or statistics not in the original text.\n"
        "2. Extreme Asymmetry: Human writing has high burstiness and uneven clause lengths. Pair an abrupt declaration with an expansive, detailed sentence featuring mid-sentence dashes or qualifications.\n"
        "3. Thought Progression: Connect ideas through direct semantic logic rather than predictable transitional adverbs.\n"
        "4. Diction: Banish all overused AI vocabulary (delve, multifaceted, paradigm shift, landscape, crucial, testament, pivotal, foster, leverage, paramount, consequently).\n"
        "5. Output ONLY the final rewritten text. No preamble, no quotes."
    ),
}

HUMANIZE_SYSTEM_PROMPT = STYLE_PROMPTS["professional"]

GRAMMAR_SYSTEM_PROMPT = (
    "You are a grammar and spelling checker. Fix ONLY grammar, spelling, and punctuation errors "
    "in the user's text. RULES:\n"
    "1. Do NOT change the wording, style, or sentence structure beyond the error fixes.\n"
    "2. Preserve ALL meaning, facts, names, numbers, and citations exactly.\n"
    "3. Keep the same length and the same sentences.\n"
    "4. Output ONLY the corrected text. No preamble. No explanation. No quotes."
)

POLISH_SYSTEM_PROMPT = (
    "You are a copy editor. Fix grammar, spelling, punctuation, verb-agreement errors, and comma "
    "splices (split them into separate sentences) in the user's text. RULES:\n"
    "1. Do NOT change wording, style, or meaning beyond these fixes.\n"
    "2. Preserve ALL facts, numbers, and names exactly.\n"
    "3. Keep the same length and sentence order.\n"
    "4. Output ONLY the corrected text. No preamble. No explanation. No quotes."
)

state: dict = {}
jobs: dict = {}
JOBS_FILE = "/tmp/jobs_state.json"


def _load_jobs_file() -> dict:
    if os.path.exists(JOBS_FILE):
        try:
            with open(JOBS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_jobs_file():
    try:
        with open(JOBS_FILE, "w", encoding="utf-8") as f:
            json.dump(jobs, f)
    except Exception:
        pass
_bart_running = asyncio.Lock()  # one BART decode box-wide at any time


# ============================== core logic ==============================

async def _one_gemma_sample(text: str, temp: float, system: str = HUMANIZE_SYSTEM_PROMPT) -> str:
    payload = {
        "model": LONG_MODEL,
        "stream": False,
        "keep_alive": -1,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ],
        "options": {"temperature": temp, "top_p": 0.95,
                    "num_predict": max(700, len(text) // 2)},
    }
    async with OLLAMA_SEMAPHORE:
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
_PRON = {"i", "me", "my", "mine", "myself", "we", "us", "our", "ours",
         "you", "your", "yours", "yourself", "yourselves", "folks"}


def _pron_tokens(t: str) -> set:
    """Pronoun bases, contraction- and unicode-apostrophe-aware:
    we're→we, you'll→you, i'm→i, we\u2019re→we."""
    out = set()
    for w in t.replace("\u2019", "'").replace("\u2018", "'").split():
        base = w.strip(".,;:!?\"'").lower()
        base = base.split("'")[0].strip()
        if base in _PRON:
            out.add(base)
    return out


def _added_pronouns(src: str, c: str) -> set:
    """Personal pronouns present in the candidate but not in the source."""
    return _pron_tokens(c) - _pron_tokens(src)


def _ents(t: str) -> set:
    t_clean = re.sub(r"(?:^|[.!?]\s+)[A-Z][a-z]*\b", " ", t)
    return {w for w in _ENT_RE.findall(t_clean) if w.lower() not in _ENT_STOP}


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


def _meaning_ok(src: str, c: str, style: str = "professional") -> bool:
    sl = max(1, len(src))
    if not (0.5 <= len(c) / sl <= 1.8):
        return False
    if sorted(_NUM_RE.findall(src)) != sorted(_NUM_RE.findall(c)):
        return False
    if _ents(c) - _ents(src):
        return False
    if abs(_neg_count(c) - _neg_count(src)) > 2:
        return False
    return _f1_vs(src, c) >= 0.18


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


async def _run_humanize(text: str, temperature: float, samples: int, engine: str = "", style: str = "professional") -> dict:
    # Explicit legacy opt-in for human corpus
    if engine == "human-corpus" and state.get("hpool"):
        return _hpool_humanize(text)
    """Best-of-N gemma sampling + cleanup + meaning gate + ensemble ranking."""
    t0 = time.perf_counter()
    base_temp = max(0.75, min(0.92, temperature))
    n = min(3, max(1, samples))
    temps = [base_temp, min(0.95, base_temp + 0.08), min(1.0, base_temp + 0.15)][:n]

    resolved_style = (style or engine or "professional").lower()
    if resolved_style in ("gemma", "neural", "default"):
        resolved_style = "professional"
    system_prompt = STYLE_PROMPTS.get(resolved_style, STYLE_PROMPTS["professional"])

    tasks = [asyncio.ensure_future(_one_gemma_sample(text, t, system=system_prompt)) for t in temps]

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

    safe = [c for c in cands if _meaning_ok(text, c, style=resolved_style)]
    if safe:
        pool = safe
    else:
        # If strict meaning gate fails, strictly prioritize candidates matching source numbers
        src_nums = sorted(_NUM_RE.findall(text))
        exact_nums = [c for c in cands if sorted(_NUM_RE.findall(c)) == src_nums]
        f1_cands = [c for c in (exact_nums or cands) if _f1_vs(text, c) >= 0.18]
        pool = f1_cands or exact_nums or cands

    _CLICHES = ("furthermore", "moreover", "additionally", "in conclusion",
                "it is important to note", "delve", "tapestry", "navigate the",
                "underscore", "multifaceted", "unprecedented", "pivotal role",
                "foster", "leverag", "in the realm of", "a testament to",
                "crucial", "comprehensive", "facilitate", "utilize", "paramount",
                "consequently", "operational dynamics")

    _PADDING = ("really", "absolutely", "pretty important", "lots of",
                "anyway", "you know", "very much so")

    def _style_score(c: str) -> float:
        words = max(1, len(c.split()))
        low = c.lower()
        cliche = sum(1 for ph in _CLICHES if ph in low)
        padding = sum(1 for ph in _PADDING if re.search(rf"\b{re.escape(ph)}\b", low))
        sents = [s for s in re.split(r"(?<=[.!?])\s+", c) if len(s.split()) > 2]
        lens = [len(s.split()) for s in sents]
        mean_len = sum(lens) / len(lens) if lens else words
        var = sum((x - mean_len) ** 2 for x in lens) / len(lens) if len(lens) > 1 else 0
        burst = (var ** 0.5) / mean_len if mean_len else 0
        contr = len(re.findall(r"\b\w+(?:'|(?:\u2019))(?:s|t|re|ve|ll|d|m)\b", c, re.I))
        # lower is better: cliché + padding density penalised, burstiness rewarded
        return ((cliche + padding) / words * 100) - burst * 2.5 - min(contr, 4) * 0.5

    def _rank_key(c: str) -> tuple:
        return (round(_style_score(c), 2), round(_ensemble_ai_prob(c), 2))

    out = min(pool, key=_rank_key) if pool else text

    # Global AI-cliché scrub: the strongest detector signals are stock
    # phrases. Deterministic removal/replacement on the final output.
    # Curly apostrophes normalized first so contraction forms match.
    out = out.replace("\u2019", "'").replace("\u2018", "'")
    _SCRUB = [
        (r"\b(?:It|it)(?:'s)?\s+(?:also\s+)?important to (?:note|highlight) that\b", ""),
        (r"\b(?:It|it)(?:'s)?\s+(?:also\s+)?worth noting that\b", ""),
        (r"\b(?:It|it)(?:'s)?\s+(?:also\s+)?essential to (?:note|recognize) that\b", ""),
        (r"\b(?:It|it)(?:'s)?\s+widely (?:acknowledged|recognized) that\b", ""),
        (r"\bIn conclusion,?\s*", ""), (r"\bUltimately,?\s*", ""),
        (r"\bFurthermore,?\s*", "Also, "), (r"\bMoreover,?\s*", "Plus, "),
        (r"\bAdditionally,?\s*", "And "), (r"\bConsequently,?\s*", "So "),
        (r"\bIn today's fast-paced (?:digital )?world,?\s*", "These days, "),
        (r"\bIn the modern (?:digital )?era,?\s*", "Nowadays, "),
        (r"\bfast-paced (?:digital )?landscape\b", "market"),
        (r"\bcutting-edge\b", "new"),
        (r"\brevolutioniz(?:e|es|ed|ing)\b", "changed"),
        (r"\bplays? an? (?:important|crucial|vital|pivotal|key) role in\b", "matters a lot for"),
        (r"\bplay an? (?:important|crucial|vital|pivotal|key) role in\b", "matter a lot for"),
        (r"\ba (?:crucial|vital|pivotal|key) role\b", "a big part"),
        (r"\bWith the help of advanced\b", "Using"),
        (r"\bBy leveraging advanced\b", "Using"),
        (r"\bstreamlined\b", "simplified"), (r"\bstreamline\b", "simplify"),
        (r"\bseamless(?:ly)?\b", "smooth"), (r"\brobust\b", "solid"),
        (r"\bgame-changer\b", "big deal"), (r"\bever-evolving\b", "changing"),
        (r"\bharness(?:es|ed|ing)?\b", "use"),
        (r"\bprecipitated\b", "caused"), (r"\bcascading\b", "chained"),
        (r"\bunprecedented\b", "record"), (r"\bmultifaceted\b", "varied"),
        (r"\bunderscore[sd]?\b", "show"), (r"\bdelve into\b", "dig into"),
        (r"\bfoster(?:ing|s|ed)?\b", "support"), (r"\bleverag(?:ing|e|es|ed)\b", "use"),
        (r"\bpivotal role\b", "key part"), (r"\bin the realm of\b", "in"),
        (r"\ba testament to\b", "proof of"), (r"\bvibrant\b", "lively"),
        (r"\bnavigate the\b", "handle the"), (r"\bnavigating the\b", "handling the"),
        (r"\bfacilitate\b", "help"), (r"\bfacilitates\b", "helps"),
        (r"\bfacilitated\b", "helped"),
        (r"\butilize(?:s|d)?\b", "use"), (r"\bcomprehensive\b", "complete"),
        (r"\bComprehensive\b", "Complete"), (r"\bUnprecedented\b", "Record"),
        (r"\bparadigm shift\b", "big change"),
        (r"\btransformative\b", "major"), (r"\bholistic\b", "complete"),
        (r"\bparamount\b", "vital"), (r"\bcatalyst\b", "driver"),
    ]
    def _scrub_and_tidy(s: str) -> str:
        for pat, rep in _SCRUB:
            s = re.sub(pat, rep, s)
        # Normalize en-dashes to spaced em-dashes (authentic human punctuation)
        s = re.sub(r"([a-zA-Z])\s*[\u2013\u2014]\s*([a-zA-Z])", "\\1 — \\2", s)
        s = re.sub(r"\s{2,}", " ", s).strip()
        s = re.sub(r" ([,.;:!?])", r"\1", s)               # space before punct left by removals
        s = re.sub(r",\s*([.!?])", r"\1", s)               # dangling comma before sentence end
        s = re.sub(r"^(?:[,.]|\bAnd\b|\bAlso\b)\s*", "", s)  # sentence-start cleanup
        s = ". ".join(x[:1].upper() + x[1:] for x in s.split(". ") if x.strip())
        if s and s[-1] not in ".!?":
            s += "."
        return s

    out = _scrub_and_tidy(out)
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


async def _run_job(job_id: str, text: str, temperature: float, samples: int, engine: str = "", style: str = "professional"):
    try:
        jobs[job_id]["result"] = await _run_humanize(text, temperature, samples, engine, style)
        jobs[job_id]["status"] = "done"
    except Exception as e:
        logger.exception("job %s failed", job_id)
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)[:300]
    finally:
        jobs[job_id]["finished_at"] = time.time()
        _save_jobs_file()


def _prune_jobs():
    now = time.time()
    stale = [jid for jid, j in jobs.items()
             if j.get("finished_at") and now - j["finished_at"] > JOB_TTL_S]
    for jid in stale:
        jobs.pop(jid, None)
    if stale:
        _save_jobs_file()


# ============================== models ==============================

# ============================ Human Corpus Engine ============================
# v1 (2026-11-21). Verified live on ZeroGPT: text assembled from REAL human
# sentences with mechanical (non-LLM) entity/number transplants scores
# "Human written, 0% AI", while every LLM-generated rewrite scores 100%.
# This path generates NO LLM tokens: nomic-retrieval from a pool of ~49k
# human sentences + deterministic slot substitution + mechanical scrub.

NUM_RE = re.compile(r"\d[\d,\.%]*")
ENT_RE = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b")
ENT_STOP = {
    "the", "this", "that", "these", "those", "there", "research", "researchers",
    "however", "today", "some", "such", "its", "their", "our", "my", "no", "not",
    "if", "when", "while", "as", "an", "a", "but", "and", "or", "so", "then",
    "also", "plus", "overall", "currently", "now", "one", "two", "it", "they",
}

HPOOL_SCRUB = [
    (r"\b(?:It|it)(?:'s)?\s+(?:also\s+)?important to (?:note|highlight|recognize)\s+(?:that|how|why|whether)\b", ""),
    (r"\bIn today's fast-paced (?:digital )?world,?\s*", "These days, "),
    (r"\bIn the modern (?:digital )?era,?\s*", "Nowadays, "),
    (r"\b(?:rapidly )?evolving (?:digital )?landscape\b", "market"),
    (r"\bdigital landscape\b", "market"),
    (r"\bplays? an? (?:important|crucial|vital|pivotal|key) role in\b", "matters a lot for"),
    (r"\bplay an? (?:important|crucial|vital|pivotal|key) role in\b", "matter a lot for"),
    (r"\bWith the help of advanced\b", "Using"),
    (r"\bBy leveraging advanced\b", "Using"),
    (r"\bpivotal\b", "key"),
    (r"\bcutting-edge\b", "new"),
    (r"\bfurthermore,?\s*", "Also, "), (r"\bmoreover,?\s*", "Plus, "),
    (r"\badditionally,?\s*", "And "), (r"\bin conclusion,?\s*", ""),
    (r"\bdelv(?:e|ing) into\b", "examine"),
    (r"\bunderscore[sd]?\b", "show"),
]


def _load_hpool():
    """Load the human sentence pool + precomputed nomic vectors from /models."""
    try:
        import numpy as np
        texts = []
        with open("/models/pool_texts.jsonl", encoding="utf-8") as f:
            for line in f:
                texts.append(json.loads(line)["text"])
        vecs = np.load("/models/pool_vectors.npy")
        if len(texts) != vecs.shape[0]:
            raise RuntimeError("pool text/vector mismatch")
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        logger.info("human pool loaded: %d sentences, vectors %s", len(texts), tuple(vecs.shape))
        return {"texts": texts, "unit": vecs / norms, "np": np, "n": len(texts)}
    except Exception:
        logger.exception("human pool load failed - human-corpus engine disabled")
        return None


def _nomic_embed(texts):
    """Batch-embed texts via the local ollama nomic endpoint (curl subprocess)."""
    payload = json.dumps({"model": "nomic-embed-text", "input": texts})
    out = subprocess.run(["curl", "-s", "--max-time", "60", "-X", "POST",
                          "-H", "Content-Type: application/json",
                          "-d", payload, OLLAMA_BASE_URL + "/api/embed"],
                         capture_output=True, text=True, timeout=70)
    try:
        return json.loads(out.stdout).get("embeddings") or []
    except Exception:
        logger.exception("nomic embed failed")
        return []


def _hpool_pick(inp, hpool, used, k=8):
    """Best human-corpus sentence for inp with mechanical slot substitution."""
    np_ = hpool["np"]
    embs = _nomic_embed([inp])
    if not embs:
        return None
    q = np_.array(embs[0][:768], dtype=np_.float32)
    qnorm = float(np_.linalg.norm(q)) or 1.0
    q = q / qnorm
    sims = hpool["unit"] @ q
    order = np_.argsort(-sims)[:96]
    in_nums = NUM_RE.findall(inp)
    in_ents = [e for e in ENT_RE.findall(inp) if e.lower() not in ENT_STOP]

    scored = []
    for i in order:
        s = hpool["texts"][int(i)]
        reuse = s in used
        c_nums = NUM_RE.findall(s)
        c_ents = [e for e in ENT_RE.findall(s) if e.lower() not in ENT_STOP]
        score = float(sims[int(i)])
        if in_nums:
            score += 0.10 if c_nums else -0.05
        else:
            score -= 0.08 if c_nums else 0.0
        if in_ents:
            score += 0.06 if c_ents else -0.03
        scored.append((score, s, c_nums, c_ents, reuse))
    scored.sort(key=lambda t: -t[0])

    for score, s, c_nums, c_ents, reuse in scored[:k]:
        out = s
        if not reuse:
            if in_nums and c_nums:
                for a, b in zip(c_nums, in_nums):
                    out = out.replace(a, b, 1)
            elif in_nums and not c_nums:
                out = out.rstrip(".!?") + ", reaching " + in_nums[0] + " in recent measurements."
            for a, b in zip(c_ents, in_ents):
                out = out.replace(a, b)
        for pat, rep in HPOOL_SCRUB:
            out = re.sub(pat, rep, out)
        out = re.sub(r"\s{2,}", " ", out).strip()
        out = out[:1].upper() + out[1:] if out else out
        if out and out[-1] not in ".!?":
            out += "."
        if len(out.split()) < 6:
            continue
        return out
    return None


def _hpool_humanize(text):
    """Human Corpus Engine: 100% human-substrate output, no LLM tokens."""
    t0 = time.perf_counter()
    hpool = state.get("hpool")
    if not hpool:
        return {
            "humanized": text,
            "model": "human-corpus:unavailable",
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
            "ai_probability": 1.0,
            "candidates": 0,
            "engine": "human-corpus",
            "engine_fallback": "pool-unavailable",
        }
    sents = [s for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    used = set()
    outs = []
    for s in sents[:60]:
        pick = _hpool_pick(s, hpool, used)
        if not pick:
            pick = _hpool_pick(s, hpool, set())
        if not pick:
            pick = s
        used.add(pick)
        outs.append(pick)
    out = " ".join(outs)
    out = re.sub(r"\s{2,}", " ", out).strip()
    out_ai_prob = _ensemble_ai_prob(out) if out else 1.0
    return {
        "humanized": out,
        "model": "human-corpus:v1",
        "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        "ai_probability": float(out_ai_prob),
        "candidates": len(outs),
        "engine": "human-corpus",
    }


# ============================== request models ==============================

class HumanizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)
    temperature: float = Field(0.7, ge=0.1, le=2.0)
    samples: int = Field(4, ge=1, le=4)
    engine: str = Field("", max_length=32)
    style: str = Field("professional", max_length=32)


class HumanizeResponse(BaseModel):
    humanized: str
    model: str
    elapsed_ms: int
    ai_probability: float = 0.0


class JobStartRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=32000)
    temperature: float = Field(0.85, ge=0.1, le=2.0)
    samples: int = Field(3, ge=1, le=4)  # 3 keeps the batch ~75s, leaving budget for the pronoun surgical pass
    engine: str = Field("", max_length=32)
    style: str = Field("professional", max_length=32)


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


def _load_bart():
    """v6 self-trained BART (pronoun-free casual style) — extra candidate
    source in the best-of-N pool. Optional: serving continues without it."""
    try:
        from transformers import AutoModelForSeq2SeqLM
        bart_id = os.environ.get("BART_MODEL_ID", "")
        if not bart_id or not os.path.isdir(bart_id):
            return None, None
        tokenizer = AutoTokenizer.from_pretrained(bart_id)
        model = AutoModelForSeq2SeqLM.from_pretrained(bart_id)
        model.eval()
        logger.info("BART candidate model loaded: %s", bart_id)
        return tokenizer, model
    except Exception:
        logger.exception("BART candidate model failed to load")
        return None, None


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("loading detector=%s (+%s) ; humanizer=ollama:%s at %s",
                DETECTOR_MODEL_ID, ENSEMBLE_DETECTOR_ID, LONG_MODEL, OLLAMA_BASE_URL)
    t0 = time.perf_counter()
    state["detector_tokenizer"], state["detector_model"] = _load_detector()
    state["detector2_tokenizer"], state["detector2_model"] = _load_detector2()
    # BART candidate model (v6, self-trained): loaded when BART_MODEL_ID points
    # at its directory. Used POST-gemma only (see _run_humanize) — concurrent
    # BART+gemma saturated the 4 ARM cores and pushed gemma samples past budget.
    state["bart_tokenizer"], state["bart_model"] = _load_bart()
    # Human Corpus Engine pool: ~49k real human sentences + precomputed nomic
    # vectors (pool_texts.jsonl / pool_vectors.npy in the models mount). The
    # engine generates ZERO LLM tokens — retrieval + mechanical transplant —
    # so authorship-fingerprinting detectors read its output as human.
    state["hpool"] = _load_hpool() if os.environ.get("HUMAN_POOL_ENABLED") == "1" else None

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

    loaded = _load_jobs_file()
    if loaded:
        jobs.update(loaded)
        _prune_jobs()
        logger.info("restored %d jobs from %s", len(jobs), JOBS_FILE)

    logger.info("models loaded in %.1fs", time.perf_counter() - t0)
    yield
    state.clear()
    _save_jobs_file()


app = FastAPI(title="StealthHumanizer Models", version="4.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "loaded": bool(state)}


# ============================== endpoints ==============================

@app.post("/humanize/", response_model=HumanizeResponse)
async def humanize(req: HumanizeRequest):
    if not state:
        raise HTTPException(503, "models not loaded yet")
    r = await _run_humanize(req.text, req.temperature, req.samples, req.engine, req.style)
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
    _save_jobs_file()
    asyncio.create_task(_run_job(job_id, req.text, req.temperature, req.samples, req.engine, req.style))
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
