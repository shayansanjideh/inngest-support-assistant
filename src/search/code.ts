// Search Inngest's own source code (local clones of inngest, inngest-js, inngest-py) for the identifiers and error
// strings a question mentions. Many answers (limits, ID formats, which steps support what) live in code, not docs.
// `before` pins each repo to its last commit before that date, so the eval never sees later fixes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";

const run = promisify(execFile);
const ROOT = process.env.INNGEST_SRC ?? new URL("../../../inngest-src", import.meta.url).pathname;
const REPOS = ["inngest-js", "inngest-py", "inngest"];
const EXCLUDE = [":!*_test.go", ":!*.test.ts", ":!*.spec.ts", ":!*test_*.py", ":!vendor", ":!**/generated/**", ":!*.pb.go",
  ":!*_gen.go", ":!*.lock", ":!*lock.json", ":!*.md", ":!*.snap", ":!CHANGELOG*"];

const git = (repo: string, args: string[]) =>
  run("git", ["-C", `${ROOT}/${repo}`, ...args], { maxBuffer: 32 * 1024 * 1024 }).then((r) => r.stdout, (e) => (e.code === 1 ? "" : Promise.reject(e)));

async function commitAt(repo: string, before?: string) {
  return (await git(repo, ["rev-list", "-1", ...(before ? [`--before=${before}`] : []), "HEAD"])).trim();
}

export type CodeHit = { title: string; url: string; text: string };

export async function searchCode(terms: string[], opts: { before?: string; k?: number } = {}): Promise<CodeHit[]> {
  const ts = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 4))].slice(0, 6);
  if (!ts.length || !existsSync(ROOT)) return [];
  const scored: { repo: string; sha: string; path: string; matched: number; total: number }[] = [];
  await Promise.all(REPOS.map(async (repo) => {
    const sha = await commitAt(repo, opts.before);
    if (!sha) return;
    const perFile = new Map<string, { matched: number; total: number }>();
    for (const t of ts) {
      const out = await git(repo, ["grep", "-c", "-I", "-i", "-F", "-e", t, sha, "--", ...EXCLUDE]);
      for (const line of out.split("\n").filter(Boolean)) {
        const [, path, n] = line.match(/^[0-9a-f]+:(.+):(\d+)$/) ?? [];
        if (!path) continue;
        const e = perFile.get(path) ?? { matched: 0, total: 0 };
        e.matched++; e.total += Number(n); perFile.set(path, e);
      }
    }
    for (const [path, e] of perFile) scored.push({ repo, sha, path, ...e });
  }));
  // Files matching the most distinct terms first; prefer non-UI source on ties.
  scored.sort((a, b) => b.matched - a.matched || Number(a.path.startsWith("ui/")) - Number(b.path.startsWith("ui/")) || a.total - b.total);
  const top = scored.slice(0, opts.k ?? 3);
  return Promise.all(top.map(async (f) => {
    const out = await git(f.repo, ["grep", "-n", "-I", "-i", "-F", "-C", "12", ...ts.flatMap((t) => ["-e", t]), f.sha, "--", f.path]);
    const lines = out.split("\n").slice(0, 60).map((l) => l.replace(`${f.sha}:${f.path}`, "").replace(/^[:-]/, ""));
    const firstLine = Number(out.match(/:(\d+):/)?.[1] ?? 1);
    return {
      title: `Source code: ${f.repo}/${f.path}`,
      url: `https://github.com/inngest/${f.repo}/blob/${f.sha}/${f.path}#L${firstLine}`,
      text: `Code from inngest/${f.repo} (${f.path}):\n${lines.join("\n").slice(0, 2200)}`,
    };
  }));
}
