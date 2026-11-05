#!/usr/bin/env python
"""Mine RAID (rows API, free) for real (AI-generation -> human-text) pairs.

Rows sharing a source_id are the same source: one human generation + several
model generations. Pair = (model generation as input, human generation as target).
"""
import json
import os
import sys
import time


def _assert_safe_url(url):
    """Defense-in-depth for outbound calls: https/http only, host must not be
    loopback / private / reserved (blocks SSRF-class mistakes)."""
    import ipaddress
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise ValueError("blocked non-http(s) URL: %r" % url)
    host = parsed.hostname or ""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local):
        raise ValueError("blocked private/reserved target host: %r" % host)
    if ip is None and host in ("localhost", "", "0.0.0.0"):
        raise ValueError("blocked loopback target host: %r" % host)


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_pairs import OUT, truncate_sentences  # noqa: E402

TARGET_ROWS = 12000
LENGTH = 100
API_BASE = "https://datasets-server.huggingface.co/rows?dataset=liamdugan/raid&config=raid&split=train&length=100&offset="


def fetch(offset, tries=4):
    try:
        import requests
    except ImportError:
        raise SystemExit("mine_raid requires the requests package: pip install requests")
    for a in range(tries):
        try:
            url = f"{API_BASE}{int(offset)}"
            _assert_safe_url(url)
            resp = requests.get(url, timeout=45)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"fetch {offset} attempt {a}: {e}", flush=True)
            time.sleep(3 * (a + 1))
    return None


def main():
    by_source = {}
    off = 0
    n_rows = 0
    while n_rows < TARGET_ROWS:
        d = fetch(off)
        if not d or "rows" not in d:
            print("no more rows at", off)
            break
        batch = d["rows"]
        if not batch:
            break
        for item in batch:
            row = item["row"]
            n_rows += 1
            if row.get("attack") not in (None, "none"):
                continue
            sid = row.get("source_id")
            if not sid:
                continue
            gen = (row.get("generation") or "").strip()
            if len(gen) < 200 or len(gen) > 3000:
                continue
            by_source.setdefault(sid, {"human": None, "ai": []})
            if row.get("model") == "human":
                by_source[sid]["human"] = gen
            else:
                m = str(row.get("model") or "?")
                by_source[sid]["ai"].append((m, gen))
        off += LENGTH
        if n_rows % 1000 == 0:
            print(f"rows={n_rows} sources={len(by_source)}", flush=True)

    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["id"])
                except Exception:
                    pass

    added = 0
    with open(OUT, "a", encoding="utf-8") as out:
        for sid, v in by_source.items():
            if added >= 4500:
                break
            pid = f"raid-{sid[:18]}"
            if pid in done or not v["human"]:
                continue
            if not v["ai"]:
                continue
            m, ai_gen = v["ai"][0]
            human = truncate_sentences(v["human"])
            ai = truncate_sentences(ai_gen)
            if not (200 <= len(human) <= 2500 and 150 <= len(ai) <= 2500):
                continue
            out.write(json.dumps({"id": pid, "ai": ai, "human": human,
                                  "gen_model": f"raid-real-{m}"}) + "\n")
            added += 1
    print(f"rows={n_rows} sources={len(by_source)} added={added}")


if __name__ == "__main__":
    main()
