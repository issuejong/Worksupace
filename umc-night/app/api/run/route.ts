import { NextRequest } from "next/server";
import { z } from "zod";
import { hostRoute } from "../../../lib/server/auth";
import { jsonBody } from "../../../lib/server/errors";
import { startRun, transitionRun } from "../../../lib/server/game";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return hostRoute(request, async userId => {
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("create"), mode: z.enum(["rehearsal", "event"]) }),
      z.object({ action: z.enum(["start", "pause", "resume", "close", "reveal", "void", "finish"]), version: z.number().int().min(0), answer: z.string().optional() }),
    ]).parse(await jsonBody(request));
    return input.action === "create" ? startRun(input.mode) : transitionRun(input, userId);
  });
}
