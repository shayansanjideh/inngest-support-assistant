// LLM calls go through the local Claude Code CLI (`claude -p`), using the logged-in subscription.
// No tools, no MCP servers, no saved session: it is a plain text-in/text-out call.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

export const MODEL = process.env.SUPPORT_MODEL ?? "sonnet";

export type AskOpts = { system?: string; model?: string; timeoutMs?: number; schema?: object };

export function ask(prompt: string, opts: AskOpts = {}): Promise<string> {
  const args = ["-p", "--model", opts.model ?? MODEL, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
    "--output-format", opts.schema ? "json" : "text"];
  if (opts.schema) args.push("--json-schema", JSON.stringify(opts.schema)); // structured output: always valid JSON
  if (opts.system) args.push("--system-prompt", opts.system);
  return new Promise((resolve, reject) => {
    const p = spawn("claude", args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("claude -p timed out")); }, opts.timeoutMs ?? 180_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      clearTimeout(timer);
      // Throwing inside step.run makes Inngest retry the step.
      code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error(`claude -p exited ${code}: ${err.slice(0, 500)}`));
    });
    p.stdin.end(prompt);
  });
}

/** Ask for JSON and parse the first {...} block. */
export async function askJson<T>(prompt: string, opts: AskOpts = {}): Promise<T> {
  if (opts.schema) {
    const env = JSON.parse(await ask(prompt, opts));
    if (env.is_error || !env.structured_output) throw new Error(`no structured output: ${String(env.result).slice(0, 120)}`);
    return env.structured_output as T;
  }
  const raw = (await ask(prompt, opts)).trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```\s*$/);
  for (const c of [raw, fenced?.[1], raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)]) {
    if (!c) continue;
    try { return JSON.parse(c) as T; } catch {}
  }
  throw new Error(`model did not return JSON: ${raw.slice(0, 120)}`); // throws, so the step retries
}
