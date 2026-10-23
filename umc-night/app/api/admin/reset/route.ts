import { NextRequest } from "next/server";
import { z } from "zod";
import { hostRoute } from "../../../../lib/server/auth";
import { jsonBody } from "../../../../lib/server/errors";
import { stateFor } from "../../../../lib/server/game";
import { resetPreview, resetTeamsAndGames } from "../../../../lib/server/reset";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return hostRoute(request, resetPreview);
}
export async function POST(request: NextRequest) {
  return hostRoute(request, async () => {
    const input = z.object({ confirmation: z.literal("팀 초기화"), snapshot: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await jsonBody(request));
    const result = await resetTeamsAndGames(input.snapshot);
    return { ...result, state: await stateFor("host") };
  });
}
