import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearTeamCookie, hash, newToken, setTeamCookie, teamIdentity } from "../../../lib/server/auth";
import { db } from "../../../lib/server/db";
import { AppError, errorResponse, jsonBody, requireSameOrigin } from "../../../lib/server/errors";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const team = await teamIdentity(request);
    return NextResponse.json({ team: { id: team.id, number: team.number, name: team.name } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError && error.code === "JOIN_REQUIRED") return NextResponse.json({ team: null }, { headers: { "Cache-Control": "no-store" } });
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("join"), name: z.string().trim().min(1).max(32) }),
      z.object({ action: z.literal("leave") }),
    ]).parse(await jsonBody(request));
    if (input.action === "leave") {
      const token = request.cookies.get("umc_team_session")?.value;
      if (token) await db()`update public.team_sessions set revoked_at=now() where token_hash=${hash(token)} and revoked_at is null`;
      const response = NextResponse.json({ ok: true }); clearTeamCookie(response); return response;
    }
    try {
      const existing = await teamIdentity(request);
      return NextResponse.json({ team: { id: existing.id, number: existing.number, name: existing.name } }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (!(error instanceof AppError && error.code === "JOIN_REQUIRED")) throw error;
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const key = hash(ip);
    const attempts = await db()`insert into public.join_attempts(key_hash,count,window_start) values (${key},1,now()) on conflict(key_hash) do update set count=case when public.join_attempts.window_start < now()-interval '15 minutes' then 1 else public.join_attempts.count+1 end,window_start=case when public.join_attempts.window_start < now()-interval '15 minutes' then now() else public.join_attempts.window_start end returning count`;
    if (attempts[0].count > 100) throw new AppError("등록 시도가 많습니다. 잠시 후 다시 시도해 주세요.", 429, "TOO_MANY_ATTEMPTS");
    const token = newToken();
    const team = await db().begin(async tx => {
      // Serialize creation so both the display number and name stay unique.
      await tx`select pg_advisory_xact_lock(20261014, 1)`;
      const duplicate = await tx`select id from public.teams where lower(name)=lower(${input.name}) limit 1`;
      if (duplicate.length) throw new AppError("이미 등록된 팀 이름입니다. 팀 이름을 다르게 입력해 주세요.", 409, "TEAM_NAME_TAKEN");
      const rows = await tx`insert into public.teams(number,name) select coalesce(max(number),0)+1,${input.name} from public.teams returning id,number,name`;
      await tx`insert into public.team_sessions(team_id,token_hash,expires_at) values (${rows[0].id},${hash(token)},now()+interval '12 hours')`;
      return rows[0];
    });
    const response = NextResponse.json({ team }, { headers: { "Cache-Control": "no-store" } });
    setTeamCookie(response, token);
    return response;
  } catch (error) { return errorResponse(error); }
}
