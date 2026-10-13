import { NextRequest } from "next/server";
import { z } from "zod";
import { teamRoute } from "../../../lib/server/auth";
import { jsonBody } from "../../../lib/server/errors";
import { submitAnswer } from "../../../lib/server/game";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return teamRoute(request, async team => {
    const input = z.object({ value: z.string(), requestId: z.uuid(), expectedVersion: z.number().int().min(0) }).parse(await jsonBody(request));
    return submitAnswer(team.id, input);
  });
}
