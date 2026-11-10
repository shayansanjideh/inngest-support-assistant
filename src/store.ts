// In-memory state for the demo UI. Inngest holds the durable state; this is just what the page shows.
export type Thread = {
  id: string; messages: string[]; status: string; steps: { name: string; at: number }[];
  cleaned?: string; sources?: { title: string; url: string }[];
  draft?: { text: string; citations: { n: number; title: string; url: string; fixes?: { title: string; url: string }[] }[]; confidence: number; docsGap: string | null; whyUnsure: string | null; lowConfidence: boolean };
  final?: string; runId?: string; sourceUrl?: string;
};
export const threads = new Map<string, Thread>();

export function update(id: string, patch: Partial<Thread>, step?: string) {
  const t = threads.get(id) ?? { id, messages: [], status: "queued", steps: [] };
  Object.assign(t, patch);
  if (step) t.steps.push({ name: step, at: Date.now() });
  threads.set(id, t);
}
