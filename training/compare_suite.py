#!/usr/bin/env python3
"""Comparison suite: 5 text types through the live site pipeline."""
import json
import time
import urllib.request

TEXTS = {
    "T1-bangladesh": "Bangladesh is a beautiful and independent South Asian country with a rich culture, a large population, and a proud history. It gained independence in 1971 after a nine-month liberation war. Covering a land area of 147,570 square kilometers, it is home to a large population of around 17 crore people. Bangladesh is mainly an agricultural country, where rice is the staple food and crops like jute, tea, and various fruits grow abundantly. Known as a land of rivers, major waterways like the Padma, Meghna, and Jamuna flow through the land. The country also features amazing natural wonders, including the Sundarbans mangrove forest and Cox's Bazar sea beach. Today, Bangladesh is a fast-developing nation with growing industries like garments and major infrastructure projects like the Padma Bridge.",
    "T2-technology": "Artificial intelligence has fundamentally transformed the technological landscape of the modern era. Furthermore, organizations that leverage machine learning algorithms consistently demonstrate superior market performance. Moreover, the integration of automated systems facilitates unprecedented operational efficiency across industries. It is important to note that this paradigm shift necessitates comprehensive workforce adaptation. Consequently, enterprises must navigate these multifaceted developments strategically to remain competitive.",
    "T3-health": "Regular physical exercise provides numerous benefits for human health and wellbeing. It is widely acknowledged that consistent physical activity strengthens cardiovascular function and enhances muscular endurance. Additionally, exercise plays a crucial role in weight management and metabolic regulation. Furthermore, studies have demonstrated that physical activity significantly reduces the risk of chronic conditions, including diabetes and hypertension. Ultimately, incorporating regular exercise into daily routines represents a fundamental component of a healthy lifestyle.",
    "T4-history": "The Mughal Empire represented one of the most significant dynasties in South Asian history. Established in the early sixteenth century, the empire expanded to encompass vast territories across the subcontinent. It is important to highlight that Mughal architecture, exemplified by structures such as the Taj Mahal, demonstrated unprecedented artistic achievement. Moreover, the empire fostered economic prosperity through extensive trade networks. Ultimately, the empire's decline in the nineteenth century marked a transformative period in regional history.",
    "T5-environment": "Deforestation constitutes one of the most severe environmental challenges of the contemporary era. It is estimated that millions of hectares of forest are eliminated annually. Furthermore, this widespread destruction precipitates catastrophic consequences, including biodiversity loss, soil erosion, and climate destabilization. Consequently, governments and organizations must delve into comprehensive reforestation initiatives. Ultimately, the preservation of forests underscores the delicate balance between development and environmental stewardship.",
}

PRON = {"i", "me", "my", "mine", "myself", "we", "us", "our", "ours",
        "you", "your", "yours", "yourself", "yourselves", "folks"}


def toks(t):
    s = set()
    for w in t.replace("\u2019", "'").replace("\u2018", "'").split():
        b = w.strip('.,;:!?"').lower().split("'")[0].strip()
        if b in PRON:
            s.add(b)
    return s


def start_job(text):
    body = json.dumps({"text": text, "temperature": 0.85}).encode()
    req = urllib.request.Request("https://stealthhumanizer.vercel.app/api/humanize-job",
                                 data=body, headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
        if not d.get("id"):
            raise RuntimeError(str(d)[:120])
        return d["id"]


def poll(jid, rounds=45):
    for _ in range(rounds):
        time.sleep(4)
        req = urllib.request.Request(f"https://stealthhumanizer.vercel.app/api/humanize-job?id={jid}",
                                     headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            s = json.loads(r.read())
        if s.get("status") != "running":
            return s
    return None


if __name__ == "__main__":
    results = {}
    pending = list(TEXTS.items())
    running = {}
    # server caps 3 concurrent jobs — run in waves
    while pending or running:
        while pending and len(running) < 3:
            name, txt = pending.pop(0)
            try:
                jid = start_job(txt)
                running[name] = (jid, txt)
                print(f"started {name}", flush=True)
            except Exception as e:
                results[name] = {"error": str(e)[:100]}
                print(f"start-fail {name}: {e}", flush=True)
        time.sleep(6)
        for name in list(running):
            jid, txt = running[name]
            req = urllib.request.Request(f"https://stealthhumanizer.vercel.app/api/humanize-job?id={jid}",
                                         headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=20) as r:
                    s = json.loads(r.read())
            except Exception:
                continue
            if s.get("status") == "done":
                out = s["humanized"]
                added = toks(out) - toks(txt)
                results[name] = {
                    "secs": s["elapsed_ms"] // 1000,
                    "ensemble": round(s.get("ai_probability", 0), 2),
                    "pronouns": sorted(added) if added else "NONE",
                    "out": out,
                }
                print(f"done {name}: {results[name]['secs']}s pronouns={results[name]['pronouns']}", flush=True)
                del running[name]
            elif s.get("status") == "error":
                results[name] = {"error": s.get("error", "?")[:100]}
                del running[name]
    with open("zerogpt_test/suite_results.json", "w", encoding="utf-8") as f:
        json.dump({"results": results, "raws": TEXTS}, f, indent=1, ensure_ascii=False)
    print("\n=== SUMMARY ===")
    for n, r in results.items():
        if "error" in r:
            print(f"{n}: ERROR {r['error']}")
        else:
            print(f"{n}: {r['secs']}s | ensemble {r['ensemble']} | pronouns {r['pronouns']}")
