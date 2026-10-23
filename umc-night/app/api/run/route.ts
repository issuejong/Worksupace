import { NextRequest } from "next/server";
import { z } from "zod";
import { hostRoute } from "../../../lib/server/auth";
import { jsonBody } from "../../../lib/server/errors";
import { startRun, stateFor, transitionRun } from "../../../lib/server/game";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return hostRoute(request, async userId => {
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("create"), mode: z.enum(["rehearsal", "event"]) }),
      z.object({ action: z.enum(["start", "pause", "resume", "close", "reveal", "void", "finish", "startTyping", "forceClose", "revealAndGrade", "showRoundResults"]), version: z.number().int().min(0), answer: z.string().optional(), questionId: z.uuid().optional(), verdicts: z.record(z.uuid(), z.boolean()).optional(), reason: z.string().trim().min(1).max(200).optional() }),
    ]).parse(await jsonBody(request));
    const result = input.action === "create" ? await startRun(input.mode) : await transitionRun(input, userId);
    return { ...result, state: await stateFor("host") };
  });
}
