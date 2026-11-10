"""Label each candidate with Claude (dev tooling only, not part of the product)."""
import json, subprocess, concurrent.futures as cf
import sys
IN, OUT = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("candidates.json", "triaged.json")
d = json.load(open(IN))
PROMPT = """You are labeling GitHub threads from Inngest's repos for a support-bot eval.
Return ONLY a JSON object with keys:
 "type": "support_question" (user asked how to do something / why something behaves a certain way, and staff answered with guidance) or "bug_fixed" (resolved by a code change/release) or "feature_request" or "other",
 "gold_answer": 1-3 sentences summarizing the resolution a staff member gave (empty if none),
 "self_contained": true if the question can be understood without screenshots or private account info.

TITLE: {title}
QUESTION:
{q}

REPLIES:
{t}"""
def run(x):
    t = "\n---\n".join(f"[{'STAFF' if c['staff'] or c['staff'] is None else 'user'} {c['who']}]: {c['body'][:1500]}" for c in x["thread"][:12])
    p = PROMPT.format(title=x["title"], q=x["question"][:4000], t=t[:9000])
    r = subprocess.run(["claude", "-p", "--model", "haiku", p], capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL)
    s = r.stdout; s = s[s.find("{"): s.rfind("}") + 1]
    try: x["triage"] = json.loads(s)
    except Exception: x["triage"] = {"type": "parse_error", "raw": r.stdout[:300]}
    return x
with cf.ThreadPoolExecutor(3) as ex:
    out = list(ex.map(run, d))
json.dump(out, open(OUT, "w"), indent=1)
import collections; print(collections.Counter(x["triage"].get("type") for x in out))
