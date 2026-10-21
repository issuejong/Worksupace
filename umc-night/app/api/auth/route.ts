import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hostLoginEmail } from "../../../lib/host-login";
import { authClient, clearHostCookies, setHostCookies } from "../../../lib/server/auth";
import { db } from "../../../lib/server/db";
import { AppError, errorResponse, jsonBody, requireSameOrigin } from "../../../lib/server/errors";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("login"), email: hostLoginEmail, password: z.string().min(1) }),
      z.object({ action: z.literal("logout") }),
    ]).parse(await jsonBody(request));
    if (input.action === "logout") {
      const response = NextResponse.json({ ok: true });
      clearHostCookies(response);
      return response;
    }
    const result = await authClient().auth.signInWithPassword({ email: input.email, password: input.password });
    if (result.error || !result.data.session || !result.data.user) throw new AppError("아이디 또는 비밀번호를 확인해 주세요.", 401, "LOGIN_FAILED");
    const rows = await db()`select user_id from public.host_users where user_id=${result.data.user.id}`;
    if (!rows.length) throw new AppError("진행 권한이 없는 계정입니다.", 403, "HOST_REQUIRED");
    const response = NextResponse.json({ ok: true });
    setHostCookies(response, result.data.session);
    return response;
  } catch (error) { return errorResponse(error); }
}
