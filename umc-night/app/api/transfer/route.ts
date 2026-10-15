import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setTeamCookie } from "../../../lib/server/auth";
import { errorResponse, jsonBody, requireSameOrigin } from "../../../lib/server/errors";
import { inspectTeamTransfer, redeemTeamTransfer } from "../../../lib/server/transfer";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("inspect"), token: z.string().min(40).max(80) }),
      z.object({ action: z.literal("redeem"), token: z.string().min(40).max(80) }),
    ]).parse(await jsonBody(request));
    if (input.action === "inspect") return NextResponse.json(await inspectTeamTransfer(input.token), { headers: { "Cache-Control": "no-store" } });
    const { team, sessionToken } = await redeemTeamTransfer(input.token);
    const response = NextResponse.json({ team }, { headers: { "Cache-Control": "no-store" } });
    setTeamCookie(response, sessionToken);
    return response;
  } catch (error) { return errorResponse(error); }
}
