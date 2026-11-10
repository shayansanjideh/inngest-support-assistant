// Blind grading: the judge sees the question, the maintainer's real answer, and ONE candidate answer.
// It never sees which arm produced it. Arms are graded in separate calls.
import { readFileSync, writeFileSync } from "node:fs";
import { askJson } from "../src/llm";

const JUDGE = process.env.JUDGE_MODEL ?? "opus";
const rows: any[] = JSON.parse(readFileSync(new URL(process.env.ANSWERS ?? "./answers.json", import.meta.url), "utf8"));

const RUBRIC = `You grade a support answer against the answer an Inngest maintainer actually gave.
Scores:
 2 = reaches the same resolution as the maintainer (same fix/explanation), with no materially wrong claims
 1 = partially right: points in the right direction but misses the key fix, or mixes in a wrong claim
 0 = wrong, irrelevant, or would mislead the user
Also flag "hallucinated_api": true if the answer relies on an Inngest API, option, or behavior that does not exist or contradicts the maintainer.
Judge substance, not style or length. If the maintainer's answer is now outdated, still grade against it.
Return JSON only: {"score": 0|1|2, "hallucinated_api": true|false, "why": "<one sentence>"}`;

async function grade(r: any, ans: string) {
  return askJson<{ score: number; hallucinated_api: boolean; why: string }>(
    `QUESTION:\n${r.title}\n${r.question.slice(0, 4000)}\n\nMAINTAINER'S ANSWER (summary):\n${r.gold_answer}\n\nMAINTAINER'S ACTUAL REPLIES:\n${r.gold_thread}\n\nCANDIDATE ANSWER:\n${ans}`,
    { model: JUDGE, system: RUBRIC },
  );
}

const graded: any[] = [];
for (const r of rows) {
  const [a, b, c] = await Promise.all([grade(r, r.withDocs.text), grade(r, r.control.text),
    r.firstDraft && r.firstDraft.text !== r.withDocs.text ? grade(r, r.firstDraft.text) : null]);
  graded.push({ source: r.source, url: r.url, withDocs: { ...a, confidence: r.withDocs.confidence, citations: r.withDocs.citations.length },
    control: { ...b, confidence: r.control.confidence },
    // Same run, before the review step: isolates what the review step changed.
    ...(r.firstDraft ? { draftOnly: { ...(c ?? a), confidence: r.firstDraft.confidence } } : {}) });
  console.log(r.source, "docs:", a.score, "control:", b.score);
}
writeFileSync(new URL(process.env.GRADED ?? "./graded.json", import.meta.url), JSON.stringify(graded, null, 1));

const sum = (k: "withDocs" | "control" | "draftOnly") => {
  const s = graded.map((g) => g[k].score);
  return { meanScore: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2), fullyCorrect: s.filter((x) => x === 2).length,
    wrong: s.filter((x) => x === 0).length, hallucinated: graded.filter((g) => g[k].hallucinated_api).length, n: s.length };
};
// Does low confidence actually predict a bad answer? (the "docs gap" flag)
const low = graded.filter((g) => g.withDocs.confidence < 0.6), high = graded.filter((g) => g.withDocs.confidence >= 0.6);
const avg = (xs: any[]) => (xs.length ? +(xs.reduce((a, g) => a + g.withDocs.score, 0) / xs.length).toFixed(2) : null);
const conf = (k: "withDocs" | "draftOnly") => { const h = graded.filter((g) => g[k].confidence >= 0.6);
  return { confidentN: h.length, confidentAndFullyCorrect: h.filter((g) => g[k].score === 2).length, confidentButWrong: h.filter((g) => g[k].score === 0).length }; };
console.log(JSON.stringify({ withDocs: sum("withDocs"), control: sum("control"),
  ...(graded[0]?.draftOnly ? { draftOnly: sum("draftOnly"), sorterReviewed: conf("withDocs"), sorterDraftOnly: conf("draftOnly") } : {}),
  flag: { lowConfidenceN: low.length, lowConfidenceMeanScore: avg(low), highConfidenceN: high.length, highConfidenceMeanScore: avg(high) } }, null, 1));
