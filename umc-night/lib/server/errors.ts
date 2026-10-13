import { ZodError } from "zod";

export class AppError extends Error {
  constructor(message: string, public status = 400, public code = "BAD_REQUEST") { super(message); }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: "입력값을 확인해 주세요.", code: "INVALID_INPUT", issues: error.issues }, { status: 400 });
  console.error("UMC-Night API error", error);
  return Response.json({ error: "서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "SERVER_ERROR" }, { status: 500 });
}

export async function jsonBody(request: Request): Promise<unknown> {
  const size = Number(request.headers.get("content-length") ?? "0");
  if (size > 1_000_000) throw new AppError("요청 크기가 너무 큽니다.", 413);
  try { return await request.json(); }
  catch { throw new AppError("올바른 JSON 요청이 아닙니다."); }
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppError("요청 출처를 확인할 수 없습니다.", 403, "BAD_ORIGIN");
  if (origin !== new URL(request.url).origin) throw new AppError("요청 출처가 일치하지 않습니다.", 403, "BAD_ORIGIN");
}

export function noStore(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
