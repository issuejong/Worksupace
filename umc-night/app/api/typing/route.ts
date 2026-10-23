import { NextRequest } from "next/server";
import { z } from "zod";
import { teamRoute } from "../../../lib/server/auth";
import { jsonBody } from "../../../lib/server/errors";
import { typingRequest } from "../../../lib/server/typing";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return teamRoute(request, async team => {
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("ready"), questionId: z.uuid() }),
      z.object({ action: z.literal("submit"), questionId: z.uuid(), turn: z.number().int().min(0).max(9), version: z.number().int().min(0), value: z.string().min(1).max(400), requestId: z.uuid() }),
    ]).parse(await jsonBody(request));
    return typingRequest(team.id, input);
  });
}
