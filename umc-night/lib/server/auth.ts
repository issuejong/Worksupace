import { createHash, randomBytes } from "node:crypto";
import { createClient, type Session } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { AppError, errorResponse, requireSameOrigin } from "./errors";

const ACCESS = "umc_host_access";
const REFRESH = "umc_host_refresh";
const TEAM = "umc_team_session";

export function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function newToken(): string { return randomBytes(32).toString("base64url"); }
export function newTeamCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(12)].map(byte => alphabet[byte % alphabet.length]).join("");
}
function supabaseUrl(): string { const value = process.env.SUPABASE_URL; if (!value) throw new Error("SUPABASE_URL이 설정되지 않았습니다."); return value; }
function supabaseAnon(): string { const value = process.env.SUPABASE_ANON_KEY; if (!value) throw new Error("SUPABASE_ANON_KEY가 설정되지 않았습니다."); return value; }
export function authClient() { return createClient(supabaseUrl(), supabaseAnon(), { auth: { persistSession: false, autoRefreshToken: false } }); }
export function storageClient() { const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다."); return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } }); }

function setCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge });
}
export function setHostCookies(response: NextResponse, session: Session) {
  setCookie(response, ACCESS, session.access_token, Math.max(30, session.expires_in));
  setCookie(response, REFRESH, session.refresh_token, 60 * 60 * 24);
}
export function clearHostCookies(response: NextResponse) { response.cookies.delete(ACCESS); response.cookies.delete(REFRESH); }
export function setTeamCookie(response: NextResponse, token: string) { setCookie(response, TEAM, token, 60 * 60 * 12); }
export function clearTeamCookie(response: NextResponse) { response.cookies.delete(TEAM); }

async function hostIdentity(request: NextRequest): Promise<{ userId: string; refreshed?: Session }> {
  const client = authClient();
  const access = request.cookies.get(ACCESS)?.value;
  let user = access ? (await client.auth.getUser(access)).data.user : null;
  let refreshed: Session | undefined;
  if (!user) {
    const token = request.cookies.get(REFRESH)?.value;
    if (token) {
      const result = await client.auth.refreshSession({ refresh_token: token });
      refreshed = result.data.session ?? undefined;
      user = result.data.user;
    }
  }
  if (!user) throw new AppError("진행자 로그인이 필요합니다.", 401, "LOGIN_REQUIRED");
  const hosts = await db()`select user_id from public.host_users where user_id = ${user.id} limit 1`;
  if (!hosts.length) throw new AppError("진행 권한이 없는 계정입니다.", 403, "HOST_REQUIRED");
  return { userId: user.id, refreshed };
}

export async function isHost(request: NextRequest): Promise<boolean> {
  try { await hostIdentity(request); return true; } catch { return false; }
}

export async function hostRoute(request: NextRequest, fn: (userId: string) => Promise<unknown>): Promise<Response> {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const identity = await hostIdentity(request);
    const result = await fn(identity.userId);
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    if (identity.refreshed) setHostCookies(response, identity.refreshed);
    return response;
  } catch (error) { return errorResponse(error); }
}

export interface TeamIdentity { id: string; name: string; number: number; sessionId: string; }
export async function teamIdentity(request: NextRequest): Promise<TeamIdentity> {
  const token = request.cookies.get(TEAM)?.value;
  if (!token) throw new AppError("팀 참가가 필요합니다.", 401, "JOIN_REQUIRED");
  const rows = await db()`select s.id as session_id, t.id, t.name, t.number from public.team_sessions s join public.teams t on t.id=s.team_id where s.token_hash=${hash(token)} and s.revoked_at is null and s.expires_at > now() limit 1`;
  if (!rows.length) throw new AppError("팀 접속이 만료되었습니다. 다시 참가해 주세요.", 401, "JOIN_REQUIRED");
  return { id: rows[0].id, name: rows[0].name, number: rows[0].number, sessionId: rows[0].session_id };
}
export async function teamRoute(request: NextRequest, fn: (team: TeamIdentity) => Promise<unknown>): Promise<Response> {
  try {
    if (request.method !== "GET") requireSameOrigin(request);
    const team = await teamIdentity(request);
    return NextResponse.json(await fn(team), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
