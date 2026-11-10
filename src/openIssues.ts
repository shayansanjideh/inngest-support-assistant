// Real, current, unanswered questions from Inngest's public repos, for the demo picker. Read-only.
import { ghFetch } from "./search/github";

const STAFF = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);
let cache: { at: number; items: any[] } | null = null;

export async function openUnansweredIssues() {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.items;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const q = "repo:inngest/inngest repo:inngest/inngest-js repo:inngest/inngest-py is:issue is:open -author:app/github-actions sort:created-desc";
  const res = await ghFetch(`https://api.github.com/search/issues?per_page=40&q=${encodeURIComponent(q)}`, headers);
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const items = ((await res.json()) as { items: any[] }).items.filter((it) => !STAFF.has(it.author_association) && (it.body ?? "").length > 80);
  const out: any[] = [];
  for (const it of items) {
    if (out.length >= 12) break;
    if (it.comments > 0) {
      const c = (await (await ghFetch(`${it.comments_url}?per_page=50`, headers)).json()) as any[];
      if (c.some((x) => STAFF.has(x.author_association))) continue; // a maintainer already answered
    }
    out.push({ url: it.html_url, repo: it.repository_url.split("/").slice(-1)[0], number: it.number, title: it.title,
      createdAt: it.created_at, text: `${it.title}\n\n${String(it.body).slice(0, 6000)}` });
  }
  cache = { at: Date.now(), items: out };
  return out;
}

/** Paste-a-URL support: fetch one public GitHub issue as the question text. */
export async function issueFromUrl(url: string) {
  const m = url.trim().match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?$/);
  if (!m) return null;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await ghFetch(`https://api.github.com/repos/${m[1]}/${m[2]}/issues/${m[3]}`, headers);
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  const it = (await res.json()) as any;
  return { url: it.html_url as string, text: `${it.title}\n\n${String(it.body ?? "").slice(0, 8000)}` };
}
