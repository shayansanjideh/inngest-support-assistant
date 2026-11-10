import { RetryAfterError } from "inngest";

// GitHub issue search across Inngest's public repos (REST search API).
// `before` and `exclude` exist for the eval: they stop a question from finding its own answer.

const STOP = new Set("with that this when what does from have into your about there their would should could using after before than then them they will just like also only been were which while because".split(" "));
const REPOS = ["inngest/inngest", "inngest/inngest-js", "inngest/inngest-py"];

export async function searchIssues(query: string, opts: { k?: number; before?: string; exclude?: string[] } = {}) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  // The cleanup step already writes short keyword queries, so try them as-is (GitHub ANDs terms: precise).
  // If that finds too little, fall back to OR-ing the most specific words (recall).
  const words = [...new Set(query.toLowerCase().replace(/[^\w\s.-]/g, " ").split(/\s+/))]
    .filter((w) => w.length > 3 && !STOP.has(w) && w !== "inngest");
  const scope = [...REPOS.map((r) => `repo:${r}`), "is:issue", opts.before ? `created:<${opts.before}` : ""].join(" ").trim();
  const run = async (terms: string) => {
    const res = await ghFetch(`https://api.github.com/search/issues?per_page=10&q=${encodeURIComponent(`${terms} ${scope}`)}`, headers);
    if (!res.ok) throw await githubError(res); // thrown => Inngest retries the step
    return ((await res.json()) as { items: any[] }).items.filter((it) => !opts.exclude?.includes(it.html_url));
  };
  let items = words.length ? await run(words.slice(0, 4).join(" ")) : [];
  if (items.length < (opts.k ?? 5)) {
    const more = await run([...words].sort((a, b) => b.length - a.length).slice(0, 6).join(" OR "));
    items = [...items, ...more.filter((m) => !items.some((i) => i.id === m.id))];
  }
  const body = { items };
  const top = body.items.slice(0, opts.k ?? 5);
  // The answer to an issue lives in the maintainers' replies, not the opening post, so fetch those too.
  return Promise.all(top.map(async (it) => {
    const [replies, fixes] = await Promise.all([
      it.comments > 0 ? maintainerReplies(it.comments_url, headers, opts.before) : "",
      fixLinks(it.timeline_url ?? `${it.url}/timeline`, it.repository_url, headers, opts.before),
    ]);
    return {
      title: it.title as string, url: it.html_url as string, state: it.state as string, fixes,
      text: `Issue: ${String(it.body ?? "").slice(0, 700)}${replies ? `\n\nMaintainer replies:\n${replies}` : ""}` +
        (fixes.length ? `\n\nFixed by: ${fixes.map((f) => `${f.title} (${f.url})`).join("; ")}` : ""),
    };
  }));
}

const STAFF = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);
async function maintainerReplies(url: string, headers: Record<string, string>, before?: string) {
  const res = await ghFetch(`${url}?per_page=30`, headers);
  if (!res.ok) throw await githubError(res);
  const comments = (await res.json()) as any[];
  return comments
    .filter((c) => STAFF.has(c.author_association) && !c.user.login.endsWith("[bot]") && (!before || c.created_at < before))
    .map((c) => String(c.body).slice(0, 800))
    .join("\n---\n")
    .slice(0, 1600);
}

export type Fix = { title: string; url: string };

/** Merged PRs or commits that closed/referenced an issue, before the cutoff date. */
async function fixLinks(timelineUrl: string, repoApiUrl: string, headers: Record<string, string>, before?: string): Promise<Fix[]> {
  const res = await ghFetch(`${timelineUrl}?per_page=100`, headers);
  if (!res.ok) return []; // fix links are a bonus; never fail the step over them
  const events = (await res.json()) as any[];
  const repo = String(repoApiUrl).replace("https://api.github.com/repos/", "");
  const ok = (t?: string) => !!t && (!before || t < before);
  const fixes: Fix[] = [];
  for (const e of events) {
    const src = e.source?.issue;
    if (e.event === "cross-referenced" && src?.pull_request?.merged_at && ok(src.pull_request.merged_at)
        && String(src.repository_url ?? "").includes("/repos/inngest/"))
      fixes.push({ title: `PR #${src.number}: ${src.title}`, url: src.html_url });
    if (e.event === "closed" && e.commit_id && ok(e.created_at))
      fixes.push({ title: `commit ${e.commit_id.slice(0, 7)}`, url: `https://github.com/${repo}/commit/${e.commit_id}` });
  }
  return fixes.slice(0, 3);
}

/** Merged PRs in Inngest's repos that match the query: how similar problems were actually fixed. */
export async function searchFixPRs(query: string, opts: { k?: number; before?: string } = {}) {
  const words = [...new Set(query.toLowerCase().replace(/[^\w\s.-]/g, " ").split(/\s+/))]
    .filter((w) => w.length > 3 && !STOP.has(w) && w !== "inngest").slice(0, 4);
  if (!words.length) return [];
  const q = [words.join(" "), ...REPOS.map((r) => `repo:${r}`), "is:pr", "is:merged", opts.before ? `merged:<${opts.before}` : ""].join(" ").trim();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await ghFetch(`https://api.github.com/search/issues?per_page=5&q=${encodeURIComponent(q)}`, headers);
  if (!res.ok) throw await githubError(res);
  const body = (await res.json()) as { items: any[] };
  return body.items.slice(0, opts.k ?? 2).map((it) => ({
    title: `Merged PR: ${it.title}`, url: it.html_url as string, text: `Merged fix PR. Description: ${String(it.body ?? "").slice(0, 900)}`,
  }));
}

/** Batch jobs (the eval) set GITHUB_WAIT_ON_LIMIT=1 to sleep through rate limits instead of throwing. */
export async function ghFetch(url: string, headers: Record<string, string>): Promise<Response> {
  for (;;) {
    const res = await fetch(url, { headers });
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if (process.env.GITHUB_WAIT_ON_LIMIT && (res.status === 403 || res.status === 429) && reset) {
      await new Promise((r) => setTimeout(r, Math.max(1000, reset * 1000 - Date.now() + 1500)));
      continue;
    }
    return res;
  }
}

/** On a rate limit, tell Inngest exactly when to retry (GitHub's reset time) instead of using the default backoff. */
async function githubError(res: Response) {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const msg = `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`;
  if ((res.status === 403 || res.status === 429) && reset) return new RetryAfterError(msg, new Date(reset * 1000 + 1000));
  return new Error(msg);
}

/** Answered GitHub Discussions (Inngest's Q&A forum), via GraphQL search (separate rate limit from REST search). */
export async function searchDiscussions(query: string, opts: { k?: number; before?: string; exclude?: string[] } = {}) {
  const words = [...new Set(query.toLowerCase().replace(/[^\w\s.-]/g, " ").split(/\s+/))]
    .filter((w) => w.length > 3 && !STOP.has(w) && w !== "inngest").slice(0, 4);
  if (!words.length) return [];
  const q = `${words.join(" ")} repo:inngest/inngest ${opts.before ? `created:<${opts.before}` : ""}`.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!process.env.GITHUB_TOKEN) return []; // GraphQL needs a token
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const body = JSON.stringify({ query: `query($q:String!){ search(type: DISCUSSION, query: $q, first: 8) { nodes { ... on Discussion {
    title url createdAt body answer { body createdAt } comments(first: 6) { nodes { body createdAt authorAssociation } } } } } }`, variables: { q } });
  const res = await fetch("https://api.github.com/graphql", { method: "POST", headers, body }); // read-only query
  if (!res.ok) throw await githubError(res);
  const nodes = ((await res.json()) as any).data?.search?.nodes ?? [];
  const ok = (t?: string) => !!t && (!opts.before || t < opts.before);
  return nodes
    .filter((n: any) => n?.url && !opts.exclude?.includes(n.url))
    .map((n: any) => {
      const answer = n.answer && ok(n.answer.createdAt) ? n.answer.body : "";
      const staff = (n.comments?.nodes ?? []).filter((c: any) => STAFF.has(c.authorAssociation) && ok(c.createdAt)).map((c: any) => c.body);
      const replies = [answer, ...staff].filter(Boolean).join("\n---\n").slice(0, 1600);
      return { title: `Discussion: ${n.title}`, url: n.url as string,
        text: `Question: ${String(n.body).slice(0, 600)}${replies ? `\n\nMaintainer answer:\n${replies}` : ""}`, hasAnswer: !!replies };
    })
    .filter((d: any) => d.hasAnswer)
    .slice(0, opts.k ?? 2)
    .map(({ hasAnswer, ...d }: any) => d);
}
