import OpenAI from "openai";
import { z } from "zod";
import { configSchema } from "../../../lib/finance";
import { runAgent } from "../../../lib/agent/run";
export const runtime = "nodejs";
export const maxDuration = 60;
const requests = new Map<string, { time: number; count: number }>();
const inputSchema = z.object({
  question: z.string().min(1).max(1500),
  config: configSchema,
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      }),
    )
    .max(10)
    .default([]),
});
export async function POST(request: Request) {
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const model = gemini ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL;
  if (
    !model ||
    !(gemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)
  )
    return Response.json(
      {
        error:
          "서버에 GEMINI_API_KEY와 GEMINI_MODEL 또는 OpenAI 환경변수를 설정해 주세요.",
      },
      { status: 503 },
    );
  if (
    process.env.AI_ACCESS_TOKEN &&
    request.headers.get("authorization") !==
      `Bearer ${process.env.AI_ACCESS_TOKEN}`
  )
    return Response.json(
      { error: "AI 접근 토큰을 확인해 주세요." },
      { status: 401 },
    );
  const key = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  const entry = requests.get(key);
  if (requests.size > 1000) requests.clear();
  if (entry && now - entry.time < 60000 && entry.count >= 8)
    return Response.json(
      { error: "잠시 후 다시 질문해 주세요." },
      { status: 429 },
    );
  requests.set(
    key,
    entry && now - entry.time < 60000
      ? { time: entry.time, count: entry.count + 1 }
      : { time: now, count: 1 },
  );
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "질문 또는 조건이 올바르지 않습니다." },
        { status: 400 },
      );
    const { question, config, history } = parsed.data;
    const client = new OpenAI({
      apiKey: gemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
      ...(gemini
        ? {
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
          }
        : {}),
      timeout: 43000,
      maxRetries: 0,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      return Response.json(
        await runAgent(
          client,
          model,
          question,
          config,
          history,
          controller.signal,
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 429)
      return Response.json(
        {
          error:
            "AI 무료 사용량 또는 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 429 },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error:
            "AI가 제안한 변경값이 허용 범위를 벗어났습니다. 조건을 구체적으로 입력해 주세요.",
        },
        { status: 422 },
      );
    return Response.json(
      {
        error:
          "AI 요청을 완료하지 못했습니다. 설정과 연결을 확인하고 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
