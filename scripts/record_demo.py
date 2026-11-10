"""Record the demo as one .webm with the model's thinking time cut out. Needs ./dev.sh running.
Records separate segments (one browser context each) and joins them with ffmpeg's concat demuxer.
Usage: python scripts/record_demo.py <out_dir> [issue_url]"""
import os, subprocess, sys, time, glob, json, urllib.request
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
ISSUE = sys.argv[2] if len(sys.argv) > 2 else "https://github.com/inngest/inngest/issues/5200"
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")  # needs a full build (concat demuxer + libx264), e.g. pip install imageio-ffmpeg
APP = "http://127.0.0.1:3000"
Q = ("Hey team! Hope you're well. I'm building an AI agent with the Inngest TypeScript SDK. My function needs to pause "
     "until a human approves an action in our dashboard, then continue. Right now I call step.sleep in a loop and poll "
     "my database, which feels wasteful. Is there a more idiomatic way to wait for the approval?")
FOLLOW_UP = "Also: what happens if nobody approves for a few days?"
VIEW = {"width": 1280, "height": 760}
segments = []

def segment(pw, name, fn):
    d = os.path.join(OUT, name); os.makedirs(d, exist_ok=True)
    b = pw.chromium.launch()
    ctx = b.new_context(viewport=VIEW, record_video_dir=d, record_video_size=VIEW)
    p = ctx.new_page(); r = fn(p); path = p.video.path()
    ctx.close(); b.close(); segments.append(path); return r

def status(tid):
    return json.load(urllib.request.urlopen(f"{APP}/api/threads/{tid}")) or {}

def wait_for(tid, s, timeout=300):
    t0 = time.time()
    while status(tid).get("status") != s:
        if time.time() - t0 > timeout: raise TimeoutError(s)
        time.sleep(1)

def tid_of(p): return p.url.split("#", 1)[1]

with sync_playwright() as pw:
    # 1) paste a real open issue; show the first steps start
    def s1(p):
        p.goto(APP); time.sleep(1.5)
        p.click("#q"); p.keyboard.type(ISSUE, delay=15); time.sleep(0.8); p.click("#send")
        p.wait_for_function("location.hash.length > 1"); time.sleep(7)
        return tid_of(p)
    t1 = segment(pw, "s1", s1)
    wait_for(t1, "awaiting-review")                         # cut: model drafting
    # 2) draft ready -> Inngest trace paused on waitForEvent -> edit -> send -> run complete
    def s2(p):
        p.goto(f"{APP}/#{t1}"); p.wait_for_selector("#edit"); time.sleep(3)
        p.mouse.move(900, 400); p.mouse.wheel(0, 350); time.sleep(3); p.mouse.wheel(0, -350); time.sleep(1)
        p.click("#runLink"); time.sleep(7)
        p.goto(f"{APP}/#{t1}"); p.wait_for_selector("#edit"); time.sleep(1)
        p.click("#edit"); time.sleep(0.8); p.click("#editText"); p.keyboard.press("Control+End")
        p.keyboard.type("\n\nCould you also paste the full error text from the screenshot? (edited by a human)", delay=18)
        time.sleep(0.8); p.click("#sendEdit"); p.wait_for_selector("text=Sent. The run resumed", timeout=60000); time.sleep(2)
        p.click("#runLink"); time.sleep(6)
    segment(pw, "s2", s2)
    # 3) typed question in two quick messages (debounced into one run)
    def s3(p):
        p.goto(APP); time.sleep(1)
        p.fill("#q", Q); time.sleep(1); p.click("#send"); time.sleep(1.5)
        p.click("#q"); p.keyboard.type(FOLLOW_UP, delay=15); p.click("#send"); time.sleep(7)
        return tid_of(p)
    t2 = segment(pw, "s3", s3)
    wait_for(t2, "awaiting-review")                         # cut: model drafting
    # 4) confident draft -> approve
    def s4(p):
        p.goto(f"{APP}/#{t2}"); p.wait_for_selector("#approve"); time.sleep(4)
        p.mouse.move(900, 400); p.mouse.wheel(0, 500); time.sleep(3); p.mouse.wheel(0, -500); time.sleep(1)
        p.click("#approve"); p.wait_for_selector("text=Sent. The run resumed", timeout=60000); time.sleep(3)
    segment(pw, "s4", s4)

lst = os.path.join(OUT, "segments.txt")
open(lst, "w").write("".join(f"file '{s}'\n" for s in segments))
final = os.path.join(OUT, "demo.mp4")
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "25", final], check=True)
print("saved", final)
