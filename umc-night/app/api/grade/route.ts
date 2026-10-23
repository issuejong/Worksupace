import { NextRequest } from "next/server";
import { z } from "zod";
import { hostRoute } from "../../../lib/server/auth";
import { jsonBody } from "../../../lib/server/errors";
import { correctGrade, gradeCurrent, stateFor } from "../../../lib/server/game";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return hostRoute(request, async userId => {
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("grade"), version: z.number().int().min(0), verdicts: z.record(z.uuid(), z.boolean()) }),
      z.object({ action: z.literal("correct"), runQuestionId: z.uuid(), teamId: z.uuid(), correct: z.boolean(), reason: z.string().trim().min(1).max(200) }),
    ]).parse(await jsonBody(request));
    const result = input.action === "grade" ? await gradeCurrent(userId, input.version, input.verdicts) : await correctGrade(userId, input);
    return { ...result, state: await stateFor("host") };
  });
}
