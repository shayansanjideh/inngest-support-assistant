import express from "express";
import { randomUUID } from "node:crypto";
import { serve } from "inngest/express";
import { inngest } from "./client";
import { answerQuestion } from "./functions";
import { threads, update } from "./store";
import { questionAsked, draftReviewed } from "./events";
import { openUnansweredIssues, issueFromUrl } from "./openIssues";

const app = express();

// Optional password for showing the demo through a tunnel: DEMO_PASSWORD=... (username "demo").
// Tunnel requests carry cf-connecting-ip; the Inngest endpoint is only for the local dev server.
if (process.env.DEMO_PASSWORD) {
  const expected = "Basic " + Buffer.from(`demo:${process.env.DEMO_PASSWORD}`).toString("base64");
  app.use((req, res, next) => {
    const viaTunnel = !!req.headers["cf-connecting-ip"];
    if (!viaTunnel) return next();
    if (req.path.startsWith("/api/inngest")) return res.status(403).send("Forbidden");
    if (req.headers.authorization === expected) return next();
    res.set("WWW-Authenticate", 'Basic realm="support-brain"').status(401).send("Password required");
  });
}
app.use(express.json({ limit: "4mb" }));
app.use("/api/inngest", serve({ client: inngest, functions: [answerQuestion] }));
app.use(express.static(new URL("../public", import.meta.url).pathname));

// A user message. Several quick messages on one thread are debounced into one run.
app.post("/api/ask", async (req, res) => {
  const threadId: string = req.body.threadId ?? randomUUID();
  let text = String(req.body.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "empty question" });
  // A pasted GitHub issue link becomes the issue's title + body.
  let pasted: { url: string; text: string } | null = null;
  try { pasted = await issueFromUrl(text); } catch (e) { return res.status(502).json({ error: String(e) }); }
  if (pasted) { text = pasted.text; req.body.sourceUrl = pasted.url; }
  const t = threads.get(threadId);
  const messages = [...(t?.messages ?? []), text];
  update(threadId, { messages, status: "queued" }, t ? "Follow-up message (debounced)" : "Question received");
  const sourceUrl = req.body.sourceUrl ?? t?.sourceUrl;
  if (sourceUrl) update(threadId, { sourceUrl });
  await inngest.send(questionAsked.create({ threadId, text: messages.join("\n\n"), ...(sourceUrl ? { sourceUrl } : {}) }));
  res.json({ threadId });
});

// Demo picker: current open issues with no maintainer reply (read-only; nothing is posted to GitHub).
app.get("/api/open-issues", async (_req, res) => {
  try { res.json(await openUnansweredIssues()); } catch (e) { res.status(502).json({ error: String(e) }); }
});

app.get("/api/threads/:id", (req, res) => res.json(threads.get(req.params.id) ?? null));

// The Approve / Edit buttons. This event resumes the waiting run for this thread.
app.post("/api/threads/:id/review", async (req, res) => {
  const action = req.body.action === "edit" ? "edit" : "approve";
  await inngest.send(draftReviewed.create({ threadId: req.params.id, action, ...(req.body.text ? { text: String(req.body.text) } : {}) }));
  res.json({ ok: true });
});

app.listen(3000, "127.0.0.1", () => console.log("listening on http://127.0.0.1:3000"));
