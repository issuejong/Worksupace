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
  intakeAnswer,
  resolveIntakeSkip,
} from "../../../lib/input";
import { runHouseholdAgent } from "../../../lib/household-agent";
import { retirementExplanation } from "../../../lib/result-explanation";
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
    operation: z.enum(["collect", "analyze", "explain"]).default("analyze"),
    household: draftSchema,
    pendingIntake: z.boolean().default(false),
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
    if (
      process.env.AI_ACCESS_TOKEN &&
      req.headers.get("authorization") !==
        `Bearer ${process.env.AI_ACCESS_TOKEN}`
    )
      return respond(
        { error: "AI 접근 토큰을 확인해 주세요.", code: "unauthorized" },
        { status: 401 },
      );
    if (parsed.data.operation === "collect") {
      const { question, household, solutions, pendingIntake } = parsed.data;
      const h = { ...blankHousehold(), ...household };
      const skip = resolveIntakeSkip(question, h, solutions);
      if (skip) {
        const { patch, skipped, notice } = skip;
        return respond({
          answer: `${notice}\n\n${intakeAnswer(h, solutions, patch, [], skipped.length > 0 || pendingIntake)}`,
          intake: { patch, skipped },
          candidates: [],
          tools: ["collect"],
          searched: 0,
        });
      }
    }
    const gemini =
        Boolean(process.env.GEMINI_API_KEY) &&
        (!process.env.GROQ_API_KEY || parsed.data.operation !== "collect"),
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
    const key = req.headers.get("x-forwarded-for")?.split(",")[0] || "local",
      now = Date.now(),
      prev = requests.get(key);
    const remaining = prev ? 60_000 - (now - prev.time) : 0;
    if (prev && remaining > 0 && prev.count >= 20) {
      const retryAfter = Math.ceil(remaining / 1000);
      return respond(
        {
          error:
            "질문이 많아 잠시 쉬고 있어요. 대기 시간이 지나면 다시 보낼 수 있어요.",
          code: "request_rate_limit",
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    if (requests.size > 2000) requests.clear();
    requests.set(key, {
      time: prev && remaining > 0 ? prev.time : now,
      count: prev && remaining > 0 ? prev.count + 1 : 1,
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
            content: `한국어 은퇴 준비 입력 상담. 오늘 한국 날짜 ${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}. JSON으로 답한다. answer는 짧은 상담과 다음 질문이다. 별도의 출력 형식 안내가 없으면 patch는 확인된 필드와 값의 객체다. 허용 필드 ${JSON.stringify(Object.keys(draftSchema.shape))}, 이름 ${JSON.stringify(inputLabels)}. 현재 입력 ${JSON.stringify(input.household)}. 최신 사용자 발언에 명시된 정보만 patch에 넣는다. 금액은 만원, 비율은 소수, 날짜는 YYYY-MM. 사용자 개인정보나 누락값을 추정하거나 보고서 예시값을 채우지 않는다. 금액·세전/세후·배우자·월/연·합계 포함 여부·월이 모호하면 먼저 물어보고 해당 값을 patch에 넣지 않는다. 모르는 금액의 건너뛰기는 앱이 별도로 처리한다. 혼합 답변에서는 확인된 항목만 추출하고, 미확인 항목은 추측하거나 0으로 채우지 않는다. 추가 질문은 한번에 1~2개만 한다. 추출한 값은 사용자의 반영 버튼으로만 적용된다. 배우자가 없거나 독신이라고 명시하면 hasSpouse에 false를 넣고 배우자 정보는 추출하지 않는다. 대출이 없다고 명시하면 loan에 0을 넣는다. 짧은 답변은 직전 질문이 요청한 항목을 기준으로 해석한다. 앱이 다음 질문을 정하므로 answer에는 짧은 확인만 쓴다. 계산과 자격 판정은 하지 않는다.`,
          },
          ...input.history,
          { role: "user", content: input.question },
        ],
      });
      const proposal = parseIntakeResponse(
        response.choices[0]?.message.content || "{}",
      );
      const h = { ...blankHousehold(), ...input.household };
      const patch = proposal.patch;
      const shortAnswer = input.question.trim().replace(/[.!?。]+$/, "");
      if (
        /^(?:미혼(?:입니다|이에요)?|결혼\s*(?:안\s*함|안\s*했어요|안\s*했습니다)|배우자(?:가|는)?\s*없(?:음|어요|습니다))$/.test(
          shortAnswer,
        )
      )
        patch.hasSpouse = false;
      if (
        /^(?:주택담보)?대출(?:이|은)?\s*없(?:음|어요|습니다)$/.test(shortAnswer)
      )
        patch.loan = 0;
      if (prepareScenario(h, input.solutions).missing[0] === "hasSpouse") {
        if (/^(?:없어요|없습니다|없음|아니요)$/.test(shortAnswer))
          patch.hasSpouse = false;
        if (/^(?:있어요|있습니다|있음|네)$/.test(shortAnswer))
          patch.hasSpouse = true;
      }
      if ((patch.hasSpouse ?? h.hasSpouse) === false) {
        delete patch.spouseBirth;
        delete patch.spouseIncome;
        delete patch.spousePension;
        delete patch.spouseEnd;
      }
      return respond({
        answer: intakeAnswer(
          h,
          input.solutions,
          patch,
          proposal.invalidFields.filter(
            (label) =>
              (patch.hasSpouse ?? h.hasSpouse) !== false ||
              !label.startsWith("배우자"),
          ),
          Object.keys(patch).length > 0 || input.pendingIntake,
        ),
        intake: { patch },
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
    if (input.operation === "explain") {
      const { facts, takeaways } = retirementExplanation(
        ready,
        input.solutions,
      );
      const response = await router.complete({
        model,
        max_tokens: 128,
        messages: [
          {
            role: "system",
            content:
              "은퇴 전망을 처음 보는 사람에게 먼저 보여줄 요점을 고르세요. 자금 부족은 shortfall, 비상자금은 reserve, 기말 잔액은 balance입니다. shortfall, reserve, balance 중 하나만 출력하세요.",
          },
          { role: "user", content: `${facts}\n${JSON.stringify(takeaways)}` },
        ],
      });
      const focus = response.choices[0]?.message.content?.trim().toLowerCase();
      const selected =
        focus === "reserve" || focus === "balance" ? focus : "shortfall";
      return respond({
        answer: `${takeaways[selected]}\n\n${facts}\n\n‘부족’은 시뮬레이션에서 충당하지 못한 생활자금이에요.`,
        candidates: [],
        tools: ["explain"],
        searched: 0,
      });
    }
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
