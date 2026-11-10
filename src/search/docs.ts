import { readFileSync } from "node:fs";
import MiniSearch from "minisearch";

// Source: https://www.inngest.com/llms-full.txt (fetched into data/ by `npm run fetch-docs`).
// Pages start with "# Title" followed by "Source: <url>". We split pages on "## " headings.

export type DocChunk = { id: number; title: string; section: string; url: string; text: string };

function chunk(raw: string): DocChunk[] {
  const lines = raw.split("\n");
  const chunks: DocChunk[] = [];
  let title = "", url = "", section = "", buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (url && text.length > 40) chunks.push({ id: chunks.length, title, section, url, text: text.slice(0, 4000) });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("# ") && lines[i + 1]?.startsWith("Source: ")) {
      flush(); title = l.slice(2).trim(); url = lines[i + 1].slice(8).trim(); section = ""; i++; continue;
    }
    if (l.startsWith("## ")) { flush(); section = l.slice(3).trim(); }
    buf.push(l);
  }
  flush();
  return chunks;
}

let index: MiniSearch<DocChunk> | null = null;
function getIndex() {
  if (index) return index;
  const chunks = chunk(readFileSync(new URL("../../data/llms-full.txt", import.meta.url), "utf8"));
  index = new MiniSearch<DocChunk>({
    fields: ["title", "section", "text"],
    storeFields: ["title", "section", "url", "text"],
    searchOptions: { boost: { title: 3, section: 2 }, prefix: true, fuzzy: 0.15 },
  });
  index.addAll(chunks);
  return index;
}

export function searchDocs(query: string, k = 6) {
  return getIndex().search(query, { combineWith: "OR" }).slice(0, k).map((r) => ({
    title: r.title as string, section: r.section as string, url: r.url as string,
    text: (r.text as string).slice(0, 1500), score: r.score,
  }));
}
