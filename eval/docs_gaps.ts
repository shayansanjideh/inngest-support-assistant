// Docs-gap list: for each eval question, does today's documentation actually state the maintainer's answer?
// We search the docs with the maintainer's answer itself (best case for retrieval) and ask a model to check.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { searchDocs } from "../src/search/docs";
import { askJson } from "../src/llm";

const items: any[] = JSON.parse(readFileSync(new URL("./eval-set.json", import.meta.url), "utf8"));
// Docs-arm score per question across all eval versions.
const runs = readdirSync(new URL(".", import.meta.url)).filter((d) => /^v\d$/.test(d) && existsSync(new URL(`./${d}/graded.json`, import.meta.url)));
const scores: Record<string, number[]> = {};
for (const v of runs) for (const g of JSON.parse(readFileSync(new URL(`./${v}/graded.json`, import.meta.url), "utf8")))
  (scores[g.source] ??= []).push(g.withDocs.score);

const out: any[] = [];
for (const it of items) {
  const pages = searchDocs(it.gold_answer, 5);
  const r = await askJson<{ coverage: "covered" | "partial" | "missing"; topic: string; docs_should_say: string }>(
    `A developer asked Inngest:\n${it.title}\n${it.question.slice(0, 2000)}\n\nThe maintainer's answer:\n${it.gold_answer}\n\nThe most relevant pages in today's Inngest docs:\n` +
      pages.map((p, i) => `[${i + 1}] ${p.title} > ${p.section} (${p.url})\n${p.text}`).join("\n\n") +
      `\n\nDo these docs pages state the maintainer's answer clearly enough that a developer could find it? Return JSON only:
{"coverage": "covered" | "partial" | "missing", "topic": "<3-6 word topic>", "docs_should_say": "<one sentence the docs should add, or empty if covered>"}`,
    { model: "sonnet", system: "You output JSON only." },
  );
  const s = scores[it.source] ?? [];
  out.push({ source: it.source, url: it.url, ...r, botMeanScore: s.length ? +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : null });
  console.log(it.source, r.coverage, "|", r.topic);
}
writeFileSync(new URL("./docs-gaps.json", import.meta.url), JSON.stringify(out, null, 1));
const by = (c: string) => out.filter((o) => o.coverage === c);
console.log({ covered: by("covered").length, partial: by("partial").length, missing: by("missing").length });
