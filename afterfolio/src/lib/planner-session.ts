import { z } from "zod";
import { blankHousehold, draftSchema } from "./input";
import { householdSchema, solutionSchema, type Household } from "./household";
import type { AgentReply } from "./household-agent";

export const sessionKey = "young-planner:session:v1";

export type Origin = "manual" | "chat" | "example" | "file";
export type Message = {
  revision?: number;
  question: string;
  reply: AgentReply & { intake?: { patch: Partial<Household> } };
  snapshot: string;
};

const messageSchema = z.object({
  revision: z.number().int().nonnegative().optional(),
  question: z.string(),
  snapshot: z.string(),
  reply: z.object({
    answer: z.string(),
    candidates: z.array(
      z.object({
        name: z.string(),
        household: householdSchema,
        plan: solutionSchema,
        metrics: z.object({
          firstNegative: z.string().nullable(),
          minAssets: z.number(),
          minMonth: z.string(),
          endAssets: z.number(),
          lifeNet: z.number(),
          reserve: z.number(),
          passes: z.boolean(),
          warnings: z.array(z.string()),
        }),
      }),
    ),
    tools: z.array(z.string()),
    searched: z.number(),
    intake: z.object({ patch: draftSchema }).optional(),
  }),
});

const sessionSchema = z.object({
  household: z.record(z.string(), z.unknown()),
  solutions: solutionSchema,
  origins: z.record(z.string(), z.enum(["manual", "chat", "example", "file"])),
  messages: z.array(z.unknown()),
  question: z.string().max(1500),
  tab: z.enum(["result", "plan", "basis"]),
  ai: z.boolean(),
  revision: z.number().int().nonnegative(),
  snapshot: z.string(),
});

export function readPlannerSession(raw: string) {
  const stored = sessionSchema.parse(JSON.parse(raw));
  const household = blankHousehold();
  // Preserve unfinished edits and restore the blank numeric fields serialized as null.
  for (const [key, value] of Object.entries(stored.household)) {
    if (key === "hasSpouse") {
      if (typeof value === "boolean") household.hasSpouse = value;
    } else if (
      Object.hasOwn(household, key) &&
      value !== null &&
      typeof value === typeof household[key as keyof Household]
    ) {
      Object.assign(household, { [key]: value });
    } else if (
      value === null &&
      typeof household[key as keyof Household] === "number"
    ) {
      Object.assign(household, { [key]: NaN });
    }
  }
  const snapshot = JSON.stringify({ h: household, s: stored.solutions });
  const messages = stored.messages.flatMap((value): Message[] => {
    const parsed = messageSchema.safeParse(value);
    if (!parsed.success) return [];
    const message = parsed.data;
    if (message.snapshot === stored.snapshot) {
      return [{ ...message, snapshot }];
    }
    try {
      // Past analysis cards also read the old scenario snapshot.
      const previous = JSON.parse(message.snapshot);
      return previous?.h && previous?.s ? [message] : [];
    } catch {
      return [];
    }
  });
  return { ...stored, household, messages };
}
