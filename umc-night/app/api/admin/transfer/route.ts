import { NextRequest } from "next/server";
import { z } from "zod";
import { hostRoute } from "../../../../lib/server/auth";
import { jsonBody } from "../../../../lib/server/errors";
import { issueTeamTransfer } from "../../../../lib/server/transfer";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return hostRoute(request, async () => {
    const { teamId } = z.object({ teamId: z.uuid() }).parse(await jsonBody(request));
    return issueTeamTransfer(teamId);
  });
}
