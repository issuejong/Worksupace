import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearTeamCookie, hash, newToken, setTeamCookie } from "../../../lib/server/auth";
import { db } from "../../../lib/server/db";
import { AppError, errorResponse, jsonBody, requireSameOrigin } from "../../../lib/server/errors";

export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json({ teams: await db()`select id,number,name from public.teams order by number` }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("join"), teamId: z.uuid(), code: z.string().trim().toUpperCase().length(12) }),
      z.object({ action: z.literal("leave") }),
    ]).parse(await jsonBody(request));
    if (input.action === "leave") {
      const token = request.cookies.get("umc_team_session")?.value;
      if (token) await db()`update public.team_sessions set revoked_at=now() where token_hash=${hash(token)} and revoked_at is null`;
      const response = NextResponse.json({ ok: true }); clearTeamCookie(response); return response;
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const key = hash(ip + ":" + input.teamId);
    const attempts = await db()`insert into public.join_attempts(key_hash,count,window_start) values (${key},1,now()) on conflict(key_hash) do update set count=case when public.join_attempts.window_start < now()-interval '15 minutes' then 1 else public.join_attempts.count+1 end,window_start=case when public.join_attempts.window_start < now()-interval '15 minutes' then now() else public.join_attempts.window_start end returning count`;
    if (attempts[0].count > 12) throw new AppError("시도 횟수가 많습니다. 15분 뒤 다시 시도해 주세요.", 429, "TOO_MANY_ATTEMPTS");
    const token = newToken();
    const team = await db().begin(async tx => {
      const teams = await tx`select id,number,name from public.teams where id=${input.teamId} and code_hash=${hash(input.code)} limit 1 for update`;
      if (!teams.length) throw new AppError("참가 코드가 올바르지 않습니다.", 401, "INVALID_CODE");
      await tx`update public.team_sessions set revoked_at=now() where team_id=${input.teamId} and revoked_at is null`;
      await tx`insert into public.team_sessions(team_id,token_hash,expires_at) values (${input.teamId},${hash(token)},now()+interval '12 hours')`;
      return teams[0];
    });
    const response = NextResponse.json({ team }, { headers: { "Cache-Control": "no-store" } });
    setTeamCookie(response, token);
    return response;
  } catch (error) { return errorResponse(error); }
}
