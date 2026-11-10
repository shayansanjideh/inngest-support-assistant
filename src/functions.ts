import { inngest } from "./client";
import { cleanUpQuestion, draftAnswer, reviewDraft, topDocs, topIssues, topFixPRs, topDiscussions, topCode } from "./answer";
import { update } from "./store";
import { questionAsked, draftReviewed } from "./events";

const LOW_CONFIDENCE = 0.6;

export const answerQuestion = inngest.createFunction(
  {
    id: "answer-support-question",
    triggers: [questionAsked], // typed: event.data is { threadId, text, sourceUrl? }
    retries: 3,
    // One run per conversation thread at a time.
    concurrency: { limit: 1, key: "event.data.threadId" },
    // People often send a question as several quick messages; wait until they stop, then answer the latest.
    debounce: { key: "event.data.threadId", period: "5s" },
  },
  async ({ event, step, runId }) => {
    const threadId = event.data.threadId;
    // When the question is a real GitHub issue, don't let search "find" that same issue.
    const exclude: string[] = event.data.sourceUrl ? [event.data.sourceUrl] : [];
    // Code outside step.run re-executes on every replay, so all side effects live inside steps.
    // Model calls use step.ai.wrap: retried like any step, and the prompt input shows in the trace.
    const cleaned = await step.ai.wrap("clean-up-question", async (text: string) => {
      update(threadId, { status: "working", runId });
      const c = await cleanUpQuestion(text);
      update(threadId, { cleaned: c.question }, "Cleaned up question");
      return c;
    }, event.data.text);

    // All five searches run in parallel; a GitHub rate limit retries only its own step.
    const [docs, issues, fixes, discussions, code] = await Promise.all([
      step.run("search-docs", async () => {
        const r = topDocs(cleaned.queries);
        update(threadId, {}, `Searched docs (${r.length} hits)`);
        return r;
      }),
      step.run("search-github-issues", async () => {
        const r = await topIssues(cleaned.queries, { exclude });
        update(threadId, {}, `Searched GitHub issues (${r.length} hits)`);
        return r;
      }),
      step.run("search-fix-prs", async () => {
        const r = await topFixPRs(cleaned.queries, { exclude });
        update(threadId, {}, `Searched merged fix PRs (${r.length} hits)`);
        return r;
      }),
      step.run("search-discussions", async () => {
        const r = await topDiscussions(cleaned.queries, { exclude });
        update(threadId, {}, `Searched GitHub Discussions (${r.length} hits)`);
        return r;
      }),
      step.run("search-source-code", async () => {
        const r = await topCode(cleaned.codeTerms ?? []);
        update(threadId, {}, `Searched Inngest source code (${r.length} files)`);
        return r;
      }),
    ]);
    const sources = [...docs, ...issues, ...fixes, ...discussions, ...code];

    const firstDraft = await step.ai.wrap("draft-answer", draftAnswer, cleaned.question, sources);

    // Optional second pass (REVIEW_STEP=1): checks claims against the sources and re-scores confidence.
    // In the eval it moved scores within noise (v6: 1.66 -> 1.69) and added ~10 s, so it is off by default.
    const draft = process.env.REVIEW_STEP === "1"
      ? await step.ai.wrap("review-draft", async (q: string, src: typeof sources, d0: typeof firstDraft) => {
          const d = await reviewDraft(q, src, d0);
          return { ...d, lowConfidence: d.confidence < LOW_CONFIDENCE };
        }, cleaned.question, sources, firstDraft)
      : { ...firstDraft, lowConfidence: firstDraft.confidence < LOW_CONFIDENCE };

    await step.run("post-draft-for-review", async () => {
      update(threadId, { status: "awaiting-review", draft, sources: sources.map(({ title, url }) => ({ title, url })) },
        draft.lowConfidence ? `Drafted: flagged (${Math.round(draft.confidence * 100)}%)` : `Drafted: ready to approve (${Math.round(draft.confidence * 100)}%)`);
    });

    const review = await step.waitForEvent("wait-for-human-review", {
      event: draftReviewed, // typed: review.data is { threadId, action, text? }
      timeout: "24h",
      match: "data.threadId", // only a click on this thread resumes this run
    });

    if (!review) {
      update(threadId, { status: "expired" }, "No review within 24h");
      return { status: "expired" };
    }

    const finalText = review.data.action === "edit" && review.data.text ? review.data.text : draft.text;
    await step.run("send-answer", async () => {
      // A real deployment would post to Slack/Discord/the ticket here.
      update(threadId, { status: "sent", final: finalText }, review.data.action === "edit" ? "Edited and sent" : "Approved and sent");
    });
    return { status: review.data.action, confidence: draft.confidence, docsGap: draft.docsGap };
  },
);
