import { randomUUID } from "node:crypto";
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
import { providerStatus } from "../../../lib/ai-reliability";
import {
  diagnosticFetch,
  privateFragments,
  redactDiagnostic,
} from "../../../lib/ai-diagnostics";
import {
  createModelRouter,
  groqParameters,
  modelErrorCode,
  type ModelTarget,
} from "../../../lib/model-router";
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
  const requestId = randomUUID(),
    started = Date.now();
  const secrets = [
    process.env.GEMINI_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.GROQ_API_KEY,
    process.env.AI_ACCESS_TOKEN,
  ].filter((v): v is string => Boolean(v));
  const context = {
    requestId,
    provider: process.env.GEMINI_API_KEY
      ? "gemini"
      : process.env.GROQ_API_KEY
        ? "groq"
        : "openai",
    model: redactDiagnostic(
      process.env.GEMINI_API_KEY
        ? process.env.GEMINI_MODEL
        : process.env.GROQ_API_KEY
          ? process.env.GROQ_MODEL || "openai/gpt-oss-120b"
          : process.env.OPENAI_MODEL,
      secrets,
    ),
    region: process.env.VERCEL_REGION || "local",
    operation: "unknown",
  };
  let errorName: string | undefined;
  let fallbackUsed = false;
  function respond(body: Record<string, unknown>, init: ResponseInit = {}) {
    const status = init.status || 200;
    const record = {
      ...context,
      status,
      code: body.code,
      errorName,
      elapsedMs: Date.now() - started,
      fallbackUsed,
    };
    if (status >= 400) console.error("Young Planner AI request failed", record);
    else console.info("Young Planner AI request completed", record);
    const headers = new Headers(init.headers);
    headers.set("X-Request-Id", requestId);
    headers.set("Cache-Control", "no-store");
    return Response.json({ ...body, requestId }, { ...init, headers });
  }
  try {
    const text = await req.text();
    if (text.length > 100000)
      return respond(
        { error: "요청이 너무 큽니다.", code: "request_too_large" },
        { status: 413 },
      );
    const parsed = inputSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      return respond(
        { error: "질문과 입력 조건을 확인해 주세요.", code: "invalid_request" },
        { status: 400 },
      );
    context.operation = parsed.data.operation;
    const gemini =
        Boolean(process.env.GEMINI_API_KEY) &&
        (!process.env.GROQ_API_KEY || parsed.data.operation === "analyze"),
      groq = !gemini && Boolean(process.env.GROQ_API_KEY),
      apiKey = gemini
        ? process.env.GEMINI_API_KEY
        : groq
          ? process.env.GROQ_API_KEY
          : process.env.OPENAI_API_KEY,
      model = gemini
        ? process.env.GEMINI_MODEL
        : groq
          ? process.env.GROQ_MODEL || "openai/gpt-oss-120b"
          : process.env.OPENAI_MODEL;
    if (!apiKey || !model)
      return respond(
        {
          error:
            "AI 에이전트가 아직 연결되지 않았어요. 서버의 API 키와 모델 설정이 필요합니다.",
          code: "ai_not_configured",
        },
        { status: 503 },
      );
    if (
      process.env.AI_ACCESS_TOKEN &&
      req.headers.get("authorization") !==
        `Bearer ${process.env.AI_ACCESS_TOKEN}`
    )
      return respond(
        { error: "AI 접근 토큰을 확인해 주세요.", code: "unauthorized" },
        { status: 401 },
      );
    const key = req.headers.get("x-forwarded-for")?.split(",")[0] || "local",
      now = Date.now(),
      prev = requests.get(key);
    if (prev && now - prev.time < 60000 && prev.count >= 8)
      return respond(
        {
          error: "질문이 많아 잠시 쉬고 있어요. 1분 뒤 다시 시도해 주세요.",
          code: "request_rate_limit",
        },
        { status: 429 },
      );
    if (requests.size > 2000) requests.clear();
    requests.set(key, {
      time: prev && now - prev.time < 60000 ? prev.time : now,
      count: prev && now - prev.time < 60000 ? prev.count + 1 : 1,
    });
    const signal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(parsed.data.operation === "collect" ? 22000 : 50000),
    ]);
    function target(
      provider: string,
      targetModel: string,
      key: string,
    ): ModelTarget & { client: OpenAI } {
      const baseURL =
        provider === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai/"
          : provider === "groq"
            ? "https://api.groq.com/openai/v1"
            : undefined;
      const client = new OpenAI({
        apiKey: key,
        ...(baseURL ? { baseURL } : {}),
        timeout: 45000,
        maxRetries: 0,
        fetch: diagnosticFetch(
          (diagnostic) =>
            console.warn("Young Planner AI provider response", {
              ...context,
              ...diagnostic,
            }),
          [...secrets, ...privateFragments(parsed.data)],
        ),
      });
      return {
        client,
        provider,
        model: targetModel,
        request: (params, attemptSignal) =>
          client.chat.completions.create(
            provider === "groq" ? groqParameters(params) : params,
            { signal: attemptSignal },
          ),
      };
    }
    const primary = target(
      gemini ? "gemini" : groq ? "groq" : "openai",
      model,
      apiKey,
    );
    const targets: ModelTarget[] = [primary];
    if (gemini && process.env.GROQ_API_KEY)
      targets.push(
        target(
          "groq",
          process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          process.env.GROQ_API_KEY,
        ),
      );
    else if (groq && process.env.GEMINI_API_KEY) {
      const fallback = (
        process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite"
      ).trim();
      if (fallback)
        targets.push(target("gemini", fallback, process.env.GEMINI_API_KEY));
    } else if (gemini) {
      const fallback = (
        process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite"
      ).trim();
      if (fallback) targets.push(target("gemini", fallback, apiKey));
    }
    const router = createModelRouter({
      targets,
      signal,
      timeoutMs: parsed.data.operation === "collect" ? 8000 : 12000,
      validate:
        parsed.data.operation === "collect"
          ? (reply) => {
              parseIntakeResponse(reply.choices[0]?.message.content || "{}");
            }
          : undefined,
      onAttempt: (active) => {
        context.model = redactDiagnostic(active.model, secrets);
        context.provider = active.provider;
      },
      onSwitch: (event) => {
        fallbackUsed = true;
        console.warn("Young Planner AI model fallback", {
          ...context,
          ...event,
          elapsedMs: Date.now() - started,
        });
      },
    });
    // Candidate numbers from the browser are not trusted: only full inputs are reused and recalculated by tools.
    const input = {
      ...parsed.data,
      previousCandidates: parsed.data.previousCandidates.map(
        ({ name, household, plan }) => ({ name, household, plan }),
      ),
    };
    if (input.operation === "collect") {
      const response = await router.complete({
        model,
        max_tokens: 1600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `한국어 은퇴 준비 입력 상담. 오늘 한국 날짜 ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}. JSON {"answer":"짧은 상담과 다음 질문","patch":{}}로 답한다. 허용 필드 ${JSON.stringify(Object.keys(draftSchema.shape))}, 이름 ${JSON.stringify(inputLabels)}. 현재 입력 ${JSON.stringify(input.household)}. 최신 사용자 발언에 명시된 정보만 patch에 넣는다. 금액은 만원, 비율은 소수, 날짜는 YYYY-MM. 사용자 개인정보나 누락값을 추정하거나 보고서 예시값을 채우지 않는다. 금액·세전/세후·배우자·월/연·합계 포함 여부·월이 모호하면 먼저 물어보고 해당 값을 patch에 넣지 않는다. 모름은 0이 아니다. 미확인 항목은 추측하지 않는다. 출력 스키마에서 필수 키이면 null을 사용하고, 생략 가능하면 patch에서 키를 생략한다. 빈 문자열은 보내지 않는다. 추가 질문은 한번에 1~2개만 한다. 추출한 값은 사용자의 반영 버튼으로만 적용된다. 필수 정보: 본인/배우자 출생연월, 은퇴월, 세후소득, 배우자근로종료월(소득있는경우), 금융자산, 대출잔액(있으면 금리/잔여개월), 월생활비, 세후퇴직금, 부부 예상 월연금. 이미 있는 값은 반복해 묻지 않는다. 계산과 자격 판정은 하지 않는다.`,
          },
          ...input.history,
          { role: "user", content: input.question },
        ],
      });
      const proposal = parseIntakeResponse(
        response.choices[0]?.message.content || "{}",
      );
      return respond({
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
      return respond(
        {
          error: "계산에 필요한 정보를 먼저 확인해 주세요.",
          code: "incomplete_input",
        },
        { status: 400 },
      );
    return respond(
      await runHouseholdAgent(
        primary.client,
        model,
        {
          ...input,
          household: ready,
          unavailableFields: (
            Object.keys(householdSchema.shape) as (keyof Household)[]
          ).filter((k) => input.household[k] === undefined),
        },
        signal,
        router.complete,
      ),
    );
  } catch (e) {
    if (e instanceof SyntaxError)
      return respond(
        { error: "입력 형식을 확인해 주세요.", code: "invalid_request" },
        { status: 400 },
      );
    // Free-form SDK errors can include request payloads; provider errors are
    // captured separately from the raw HTTP response with an explicit allowlist.
    errorName = e instanceof Error ? e.name : "UnknownError";
    if (providerStatus(e) === 429)
      return respond(
        {
          error: "AI 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
          code: "provider_rate_limit",
        },
        { status: 429 },
      );
    if ([500, 502, 503, 504].includes(providerStatus(e) || 0))
      return respond(
        {
          error:
            "AI 제공자가 일시적으로 요청을 처리하지 못했어요. 잠시 후 다시 보내주세요. 입력한 내용은 유지돼요.",
          code: "provider_unavailable",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      );
    if (
      e instanceof IntakeResponseError ||
      modelErrorCode(e) === "json_validate_failed"
    )
      return respond(
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
      return respond(
        {
          error:
            "AI 응답 시간이 초과됐어요. 입력한 내용은 유지돼요. 잠시 후 다시 보내주세요.",
          code: "ai_timeout",
        },
        { status: 504 },
      );
    return respond(
      {
        error:
          "AI 분석을 완료하지 못했어요. 입력한 내용은 유지돼요. 다시 시도해 주세요.",
        code: "analysis_failed",
      },
      { status: 502 },
    );
  }
}
