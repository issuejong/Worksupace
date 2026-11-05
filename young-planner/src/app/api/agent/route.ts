import OpenAI from "openai";
import { z } from "zod";
import {
  householdSchema,
  solutionSchema,
  Household,
} from "../../../lib/household";
import {
  draftSchema,
  parseIntakeResponse,
  IntakeResponseError,
  blankHousehold,
  prepareScenario,
  inputLabels,
} from "../../../lib/input";
import { runHouseholdAgent } from "../../../lib/household-agent";
import {
  providerStatus,
  withTransientRetry,
} from "../../../lib/ai-reliability";
export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z
  .object({
    question: z.string().trim().min(1).max(1500),
    operation: z.enum(["collect", "analyze"]).default("analyze"),
    household: draftSchema,
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
    if (input.operation === "collect") {
      const response = await withTransientRetry(
        () =>
          client.chat.completions.create(
            {
              model,
              max_tokens: 1600,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content: `한국어 은퇴 준비 입력 상담. 오늘 한국 날짜 ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}. JSON {"answer":"짧은 상담과 다음 질문","patch":{}}로 답한다. 허용 필드 ${JSON.stringify(Object.keys(draftSchema.shape))}, 이름 ${JSON.stringify(inputLabels)}. 현재 입력 ${JSON.stringify(input.household)}. 최신 사용자 발언에 명시된 정보만 patch에 넣는다. 금액은 만원, 비율은 소수, 날짜는 YYYY-MM. 사용자 개인정보나 누락값을 추정하거나 보고서 예시값을 채우지 않는다. 금액·세전/세후·배우자·월/연·합계 포함 여부·월이 모호하면 먼저 물어보고 해당 값을 patch에 넣지 않는다. 모름은 0이 아니다. 미확인 항목은 patch에서 키 자체를 생략한다. null이나 빈 문자열을 보내지 않는다. 추가 질문은 한번에 1~2개만 한다. 추출한 값은 사용자의 반영 버튼으로만 적용된다. 필수 정보: 본인/배우자 출생연월, 은퇴월, 세후소득, 배우자근로종료월(소득있는경우), 금융자산, 대출잔액(있으면 금리/잔여개월), 월생활비, 세후퇴직금, 부부 예상 월연금. 이미 있는 값은 반복해 묻지 않는다. 계산과 자격 판정은 하지 않는다.`,
                },
                ...input.history,
                { role: "user", content: input.question },
              ],
            },
            { signal },
          ),
        signal,
      );
      const proposal = parseIntakeResponse(
        response.choices[0]?.message.content || "{}",
      );
      return Response.json({
        answer: proposal.answer,
        intake: { patch: proposal.patch },
        candidates: [],
        tools: ["collect"],
        searched: 0,
      });
    }
    const ready = prepareScenario(
      { ...blankHousehold(), ...input.household },
      input.solutions,
    ).household;
    if (!ready)
      return Response.json(
        { error: "계산에 필요한 정보를 먼저 확인해 주세요." },
        { status: 400 },
      );
    return Response.json(
      await runHouseholdAgent(
        client,
        model,
        {
          ...input,
          household: ready,
          unavailableFields: (
            Object.keys(householdSchema.shape) as (keyof Household)[]
          ).filter((k) => input.household[k] === undefined),
        },
        signal,
      ),
    );
  } catch (e) {
    if (e instanceof SyntaxError)
      return Response.json(
        { error: "입력 형식을 확인해 주세요." },
        { status: 400 },
      );
    let message = e instanceof Error ? e.message : "Unknown AI error";
    for (const secret of [
      process.env.GEMINI_API_KEY,
      process.env.OPENAI_API_KEY,
      process.env.AI_ACCESS_TOKEN,
    ]) {
      if (secret) message = message.split(secret).join("[REDACTED]");
    }
    console.error("Young Planner AI request failed", {
      name: e instanceof Error ? e.name : "UnknownError",
      status: providerStatus(e),
      message: message.slice(0, 1000),
    });
    if (providerStatus(e) === 429)
      return Response.json(
        { error: "AI 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요." },
        { status: 429 },
      );
    if ([500, 502, 503, 504].includes(providerStatus(e) || 0))
      return Response.json(
        {
          error:
            "AI 제공자가 일시적으로 요청을 처리하지 못했어요. 자동으로 한 번 재시도했지만 연결되지 않았어요. 잠시 후 다시 보내주세요.",
          code: "provider_unavailable",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    if (e instanceof IntakeResponseError)
      return Response.json(
        {
          error:
            "AI가 정보를 읽을 수 있는 형식으로 정리하지 못했어요. 입력한 내용은 유지돼요. 다시 보내주세요.",
          code: "invalid_ai_response",
        },
        { status: 502 },
      );
    if (
      e instanceof Error &&
      [
        "AbortError",
        "TimeoutError",
        "APIUserAbortError",
        "APIConnectionTimeoutError",
      ].includes(e.name)
    )
      return Response.json(
        {
          error:
            "AI 응답 시간이 초과됐어요. 입력한 내용은 유지돼요. 잠시 후 다시 보내주세요.",
          code: "ai_timeout",
        },
        { status: 504 },
      );
    return Response.json(
      {
        error:
          "AI 분석을 완료하지 못했어요. 입력한 내용은 유지돼요. 다시 시도해 주세요.",
        code: "analysis_failed",
      },
      { status: 502 },
    );
  }
}
