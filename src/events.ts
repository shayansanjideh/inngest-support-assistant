// Typed events (SDK v4 eventType + a Standard Schema). Payloads are checked at compile time and validated at runtime.
import { eventType } from "inngest";
import { z } from "zod";

export const questionAsked = eventType("support/question.asked", {
  schema: z.object({ threadId: z.string(), text: z.string().min(1), sourceUrl: z.string().url().optional() }),
});

export const draftReviewed = eventType("support/draft.reviewed", {
  schema: z.object({ threadId: z.string(), action: z.enum(["approve", "edit"]), text: z.string().optional() }),
});
