// Shared by the Inngest function and the eval, so both test the same logic.
import { askJson } from "./llm";
import { searchDocs } from "./search/docs";
import { searchIssues, searchFixPRs, searchDiscussions } from "./search/github";
import { searchCode } from "./search/code";

export type Source = { title: string; url: string; text: string; fixes?: { title: string; url: string }[] };
export type Citation = { n: number; title: string; url: string; fixes?: { title: string; url: string }[] };
export type Draft = { text: string; citations: Citation[]; confidence: number; docsGap: string | null; whyUnsure: string | null; reviewNote?: string };

/** Condense a long (often AI-written) question and propose short search queries. */
export async function cleanUpQuestion(raw: string): Promise<{ question: string; queries: string[]; codeTerms: string[] }> {
  return askJson(
    `A developer asked Inngest support the question below. It may be long, rambling, or AI-written.
Return JSON only: {"question": "<the actual question in 1-3 plain sentences, keeping every concrete detail: SDK, language, versions, error messages, config>", "queries": ["<3 short keyword search queries, 2-5 words each, using Inngest API names where relevant>"], "codeTerms": ["<2-5 exact strings likely to appear in Inngest's source code: API/function/option names (e.g. waitForEvent, referenceFunction, maxDuration) or a distinctive fragment of the error message; no generic words>"]}

QUESTION:
${raw.slice(0, 12000)}`,
    { model: "haiku", system: "You output JSON only.", schema: {
      type: "object", required: ["question", "queries", "codeTerms"],
      properties: { question: { type: "string" }, queries: { type: "array", items: { type: "string" } },
        codeTerms: { type: "array", items: { type: "string" } } } } },
  );
}

// Fewer, better sources: v1 passed ~15 chunks and the model did no better than without them.
export const MAX_DOCS = 4, MAX_ISSUES = 3, MAX_FIX_PRS = 2;

// "Inngest" appears on every page, so it only adds noise to a docs query.
const strip = (q: string) => q.replace(/\binngest\b/gi, " ").trim() || q;

export function topDocs(queries: string[]) {
  return dedupe(queries.map(strip).flatMap((q) => searchDocs(q, 4)).sort((a, b) => b.score - a.score)).slice(0, MAX_DOCS);
}

export async function topIssues(queries: string[], opts: { before?: string; exclude?: string[] } = {}) {
  // Round-robin across queries so each query contributes its best hit first.
  const perQuery = await Promise.all(queries.map((q) => searchIssues(q, { ...opts, k: 2 })));
  const merged = [0, 1].flatMap((i) => perQuery.map((r) => r[i]).filter(Boolean));
  return dedupe(merged).slice(0, MAX_ISSUES);
}

/** How the problem was actually fixed in Inngest's open-source repos (merged PRs). */
export async function topFixPRs(queries: string[], opts: { before?: string; exclude?: string[] } = {}) {
  const perQuery = await Promise.all(queries.map((q) => searchFixPRs(q, { k: 1, before: opts.before })));
  return dedupe(perQuery.flat().filter((p) => !opts.exclude?.includes(p.url))).slice(0, MAX_FIX_PRS);
}

/** Answered GitHub Discussions (Q&A forum). */
export async function topDiscussions(queries: string[], opts: { before?: string; exclude?: string[] } = {}) {
  const perQuery = await Promise.all(queries.map((q) => searchDiscussions(q, { k: 1, ...opts })));
  return dedupe(perQuery.flat()).slice(0, 2);
}

/** Inngest's own source code, pinned to the question date when `before` is set. */
export async function topCode(codeTerms: string[], opts: { before?: string } = {}) {
  return searchCode(codeTerms, { before: opts.before, k: 2 });
}

export async function gatherSources(queries: string[], opts: { before?: string; exclude?: string[]; codeTerms?: string[] } = {}) {
  const [issues, fixes, discussions, code] = await Promise.all([topIssues(queries, opts), topFixPRs(queries, opts),
    topDiscussions(queries, opts), topCode(opts.codeTerms ?? [], opts)]);
  return { docs: topDocs(queries), issues: [...issues, ...fixes, ...discussions, ...code] };
}

export function dedupe<T extends Source>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.url + x.text.slice(0, 50)) ? false : (seen.add(x.url + x.text.slice(0, 50)), true)));
}

const SYSTEM = `You draft answers for Inngest's developer support team. A human reviews every draft before it is sent.
Write like a senior support engineer in a chat reply: lead with the answer, keep it under 200 words plus at most one short code snippet.
Use your own knowledge of Inngest AND the sources. Sources are evidence, not a whitelist: if you know the answer, give it directly and cite a source when one supports it.
Do not invent APIs. Do not hedge on things you are confident about; lower the confidence score instead of writing disclaimers.`;

/** Draft a cited answer. `sources` empty = the no-docs control arm. */
export async function draftAnswer(question: string, sources: Source[]): Promise<Draft> {
  const ctx = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text}`).join("\n\n")
    : "(no sources: answer from your own knowledge)";
  const out = await askJson<{ answer: string; cited: number[]; confidence: number; why_unsure: string | null; docs_gap: string | null }>(
    `QUESTION:
${question}

SOURCES:
${ctx}

Return JSON only:
{"answer": "<markdown answer; cite sources inline as [n]>",
 "cited": [<source numbers you relied on>],
 "confidence": <0-1, how sure you are the answer is correct and complete>,
 "why_unsure": <null if confidence >= 0.6, else ONE short line starting with one of: "No doc or past fix matched this", "Sources disagree", "Sources are for an older SDK version", "Needs info from the user's account or logs", "Docs only partly cover this"; you may add a few words after a colon>,
 "docs_gap": <null, or one sentence naming what the docs should say but don't, if the sources did not cover this>}`,
    { system: SYSTEM, schema: {
      type: "object", required: ["answer", "cited", "confidence", "why_unsure", "docs_gap"],
      properties: {
        answer: { type: "string" }, cited: { type: "array", items: { type: "integer" } }, confidence: { type: "number" },
        why_unsure: { type: ["string", "null"] }, docs_gap: { type: ["string", "null"] },
      } } },
  );
  return {
    text: out.answer,
    citations: [...new Set(out.cited ?? [])].sort((a, b) => a - b)
      .filter((n) => sources[n - 1])
      .map((n) => ({ n, title: sources[n - 1].title, url: sources[n - 1].url, fixes: sources[n - 1].fixes })),
    confidence: Number(out.confidence) || 0,
    docsGap: out.docs_gap ?? null,
    whyUnsure: out.why_unsure ?? null,
  };
}

const REVIEW_SYSTEM = `You are a strict senior Inngest support engineer reviewing a colleague's draft before a human sends it.
Check every claim against the sources and your own knowledge of Inngest. Fix anything wrong, remove anything you cannot stand behind,
and fill in a missing key fix if you know it. Keep the same chat style and length limit (under 200 words plus at most one snippet).
Then score confidence honestly: high only if you would send it yourself without changes.`;

/** Second pass: verify claims, fix or drop shaky ones, re-score confidence. Same output shape as draftAnswer. */
export async function reviewDraft(question: string, sources: Source[], draft: Draft): Promise<Draft> {
  const ctx = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text}`).join("\n\n")
    : "(no sources)";
  const out = await askJson<{ answer: string; cited: number[]; confidence: number; why_unsure: string | null; docs_gap: string | null; changes: string }>(
    `QUESTION:
${question}

SOURCES:
${ctx}

DRAFT (confidence ${draft.confidence}):
${draft.text}

Return JSON: the corrected answer (cite sources inline as [n]), the source numbers relied on, your own confidence 0-1,
why_unsure (null if confidence >= 0.6, else one short line starting with one of: "No doc or past fix matched this", "Sources disagree",
"Sources are for an older SDK version", "Needs info from the user's account or logs", "Docs only partly cover this"),
docs_gap (null or one sentence), and changes (one short line on what you changed, or "none").`,
    { system: REVIEW_SYSTEM, schema: {
      type: "object", required: ["answer", "cited", "confidence", "why_unsure", "docs_gap", "changes"],
      properties: {
        answer: { type: "string" }, cited: { type: "array", items: { type: "integer" } }, confidence: { type: "number" },
        why_unsure: { type: ["string", "null"] }, docs_gap: { type: ["string", "null"] }, changes: { type: "string" },
      } } },
  );
  return {
    text: out.answer,
    citations: [...new Set(out.cited ?? [])].sort((a, b) => a - b)
      .filter((n) => sources[n - 1])
      .map((n) => ({ n, title: sources[n - 1].title, url: sources[n - 1].url, fixes: sources[n - 1].fixes })),
    confidence: Number(out.confidence) || 0,
    docsGap: out.docs_gap ?? null,
    whyUnsure: out.why_unsure ?? null,
    reviewNote: out.changes,
  };
}
