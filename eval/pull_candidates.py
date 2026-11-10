"""Pull answered questions from Inngest's public GitHub (issues + Q&A discussions).
Keeps items where the opener is outside Inngest and an Inngest member/collaborator replied."""
import json, subprocess

def gh(*args):
    return json.loads(subprocess.check_output(["gh", "api", *args]))

STAFF = {"MEMBER", "OWNER", "COLLABORATOR"}
out = []
import sys
REPOS = sys.argv[1].split(",") if len(sys.argv) > 1 else ["inngest", "inngest-js", "inngest-py"]
QUAL = sys.argv[2] if len(sys.argv) > 2 else "is:closed+reason:completed"
OUT = sys.argv[3] if len(sys.argv) > 3 else "candidates.json"
for repo in REPOS:
    for page in range(1, 4):
        res = gh(f"search/issues?q=repo:inngest/{repo}+is:issue+{QUAL}+comments:>0&per_page=100&page={page}")
        items = res["items"]
        for it in items:
            if it["author_association"] in STAFF:
                continue
            comments = gh(f"repos/inngest/{repo}/issues/{it['number']}/comments?per_page=50")
            staff = [c for c in comments if c["author_association"] in STAFF and "[bot]" not in c["user"]["login"]]
            if not staff:
                continue
            out.append({
                "source": f"inngest/{repo}#{it['number']}", "url": it["html_url"], "title": it["title"],
                "labels": [l["name"] for l in it["labels"]], "created_at": it["created_at"],
                "question": it["body"] or "",
                "thread": [{"who": c["user"]["login"], "staff": c["author_association"] in STAFF, "body": c["body"]} for c in comments],
            })
        if len(items) < 100:
            break

if OUT != "candidates.json":
    json.dump(out, open(OUT, "w"), indent=1); print(len(out)); sys.exit()
q = """query($cursor:String){ repository(owner:"inngest",name:"inngest"){ discussions(first:50, answered:true, after:$cursor){
  nodes{ number url title createdAt body author{login} answer{ body author{login} } } } } }"""
d = json.loads(subprocess.check_output(["gh", "api", "graphql", "-f", f"query={q}"]))
for n in d["data"]["repository"]["discussions"]["nodes"]:
    out.append({"source": f"inngest/inngest discussion #{n['number']}", "url": n["url"], "title": n["title"],
                "labels": ["discussion"], "created_at": n["createdAt"], "question": n["body"],
                "thread": [{"who": (n["answer"]["author"] or {}).get("login"), "staff": None, "body": n["answer"]["body"]}]})

json.dump(out, open(OUT, "w"), indent=1)
print(len(out), "candidates")
