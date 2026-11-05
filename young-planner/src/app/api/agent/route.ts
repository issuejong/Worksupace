import OpenAI from "openai";
import { z } from "zod";
import { householdSchema, solutionSchema } from "../../../lib/household";
import { runHouseholdAgent } from "../../../lib/household-agent";
export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z
  .object({
    question: z.string().trim().min(1).max(1500),
    household: householdSchema,
    solutions: solutionSchema,
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(6000),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    previousCandidates: z
      .array(
        z
          .object({
            name: z.string().max(60),
            household: householdSchema,
            plan: solutionSchema,
            metrics: z.unknown(),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();
const requests = new Map<string, { time: number; count: number }>();
export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > 100000)
      return Response.json({ error: "요청이 너무 큽니다." }, { status: 413 });
    const parsed = inputSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return Response.json(
        { error: "질문과 입력 조건을 확인해 주세요." },
        { status: 400 },
      );
    const gemini = Boolean(process.env.GEMINI_API_KEY),
      apiKey = gemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
      model = gemini ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL;
    if (!apiKey || !model)
      return Response.json(
        {
          error:
            "AI 에이전트가 아직 연결되지 않았어요. 서버의 API 키와 모델 설정이 필요합니다.",
        },
        { status: 503 },
      );
    if (
      process.env.AI_ACCESS_TOKEN &&
      req.headers.get("authorization") !==
        `Bearer ${process.env.AI_ACCESS_TOKEN}`
    )
      return Response.json(
        { error: "AI 접근 토큰을 확인해 주세요." },
        { status: 401 },
      );
    const key = req.headers.get("x-forwarded-for")?.split(",")[0] || "local",
      now = Date.now(),
      prev = requests.get(key);
    if (prev && now - prev.time < 60000 && prev.count >= 8)
      return Response.json(
        { error: "질문이 많아 잠시 쉬고 있어요. 1분 뒤 다시 시도해 주세요." },
        { status: 429 },
      );
    if (requests.size > 2000) requests.clear();
    requests.set(key, {
      time: prev && now - prev.time < 60000 ? prev.time : now,
      count: prev && now - prev.time < 60000 ? prev.count + 1 : 1,
    });
    const client = new OpenAI({
      apiKey,
      ...(gemini
        ? {
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
          }
        : {}),
      timeout: 45000,
      maxRetries: 0,
    });
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(50000)]);
    // Candidate numbers from the browser are not trusted: only full inputs are reused and recalculated by tools.
    const input = {
      ...parsed.data,
      previousCandidates: parsed.data.previousCandidates.map(
        ({ name, household, plan }) => ({ name, household, plan }),
      ),
    };
    return Response.json(await runHouseholdAgent(client, model, input, signal));
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json(
        { error: "입력 형식을 확인해 주세요." },
        { status: 400 },
      );
    if (e instanceof OpenAI.APIError && e.status === 429)
      return Response.json(
        { error: "AI 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요." },
        { status: 429 },
      );
    return Response.json(
      {
        error:
          "AI 분석을 완료하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
