#!/usr/bin/env python
"""Download HC3 (real human vs ChatGPT pairs, free) and append to pairs.jsonl.

Format matches gen_pairs.py output: {"id","ai","human","gen_model"}.
Pairs: input = ChatGPT answer, target = human answer on the SAME question.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_pairs import OUT, truncate_sentences  # noqa: E402

TARGET_HC3 = 4500

try:
    from huggingface_hub import hf_hub_download
except ImportError:
    os.system(f"{sys.executable} -m pip install -q huggingface_hub")
    from huggingface_hub import hf_hub_download


def main():
    done = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["id"])
                except Exception:
                    pass
    print(f"existing pairs: {len(done)}")

    path = hf_hub_download("Hello-SimpleAI/HC3", "all.jsonl", repo_type="dataset")
    with open(path, encoding="utf-8") as f:
        rows = [json.loads(l) for l in f]
    print(f"HC3 rows: {len(rows)}")
    added = 0
    with open(OUT, "a", encoding="utf-8") as out:
        for i, row in enumerate(rows):
            if added >= TARGET_HC3:
                break
            humans = row.get("human_answers") or []
            ais = row.get("chatgpt_answers") or []
            if not humans or not ais:
                continue
            human = truncate_sentences(max(humans, key=len).strip())
            ai = truncate_sentences(ais[0].strip())
            if not (200 <= len(human) <= 2500 and 100 <= len(ai) <= 2500):
                continue
            pid = f"hc3-{i}"
            if pid in done:
                continue
            out.write(json.dumps({"id": pid, "ai": ai, "human": human, "gen_model": "hc3-real"}) + "\n")
            added += 1
    print(f"added {added} HC3 pairs")


if __name__ == "__main__":
    main()
