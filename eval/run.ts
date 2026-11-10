// Eval: pipeline (docs + issues) vs. control (same model, same cleaned question, no sources).
// Leakage guard: issue search only sees issues created before the question, never any of the eval issues,
// and only maintainer replies posted before the question date.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { cleanUpQuestion, gatherSources, draftAnswer, reviewDraft } from "../src/answer";

type Item = { source: string; url: string; title: string; created_at: string; question: string; gold_answer: string };
const items: Item[] = JSON.parse(readFileSync(new URL(process.env.EVAL_SET ?? "./eval-set.json", import.meta.url), "utf8"));
const outPath = new URL(process.env.ANSWERS ?? "./answers.json", import.meta.url);
const done: any[] = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : [];
const todo = items.filter((it) => !done.some((d) => d.source === it.source));

async function one(it: Item) {
  const cleaned = await cleanUpQuestion(`${it.title}\n\n${it.question}`);
  const { docs, issues } = await gatherSources(cleaned.queries, { before: it.created_at.slice(0, 10), exclude: items.map((x) => x.url), codeTerms: process.env.MORE_DATA === "0" ? [] : cleaned.codeTerms }); // no eval item can retrieve any eval item
  const sources = [...docs, ...issues];
  const [firstDraft, control] = await Promise.all([draftAnswer(cleaned.question, sources), draftAnswer(cleaned.question, [])]);
  // REVIEW=0 reproduces v4 (no review step).
  const withDocs = process.env.REVIEW === "0" ? firstDraft : await reviewDraft(cleaned.question, sources, firstDraft);
  return { ...it, cleaned, nSources: sources.length, firstDraft, withDocs, control };
}

const CONC = Number(process.env.CONC ?? 2);
let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < todo.length) {
    const it = todo[i++];
    for (let attempt = 1; attempt <= 4; attempt++) {
      try { done.push(await one(it)); console.log(`${done.length}/${items.length}`, it.source); break; }
      catch (e: any) {
        console.error(it.source, "attempt", attempt, String(e).slice(0, 200));
        // Same signal Inngest uses: a RetryAfterError says when GitHub's rate limit resets.
        const wait = e?.retryAfter ? Math.max(0, new Date(e.retryAfter).getTime() - Date.now()) : 5000;
        await new Promise((r) => setTimeout(r, Math.min(wait, 70_000)));
      }
    }
    writeFileSync(outPath, JSON.stringify(done, null, 1));
  }
}));
