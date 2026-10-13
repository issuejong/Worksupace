import { NextRequest } from "next/server";
import { z } from "zod";
import { hostRoute } from "../../../lib/server/auth";
import { db } from "../../../lib/server/db";
import { AppError, jsonBody } from "../../../lib/server/errors";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return hostRoute(request, async () => {
    z.object({ confirmation: z.literal("연습 초기화") }).parse(await jsonBody(request));
    const rows = await db()`select id,mode from public.runs order by created_at desc limit 1`;
    if (!rows.length || rows[0].mode !== "rehearsal") throw new AppError("최근 게임이 연습 모드일 때만 초기화할 수 있습니다.", 409);
    await db()`delete from public.runs where id=${rows[0].id} and mode='rehearsal'`;
    return { reset: true };
  });
}
