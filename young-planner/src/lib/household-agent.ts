import OpenAI from "openai";
import { z } from "zod";
import { withTransientRetry } from "./ai-reliability";
import type { Completion } from "./model-router";
import {
  calculate,
  householdSchema,
  solutionSchema,
  Household,
  Solutions,
  none,
  fmt,
} from "./household";

const householdPatch = z.object(householdSchema.shape).partial().strict();
const planPatch = solutionSchema
  .partial()
  .extend({
    pensionOffset: solutionSchema.shape.pensionOffset
      .describe(
        "정상 국민연금 개시월 대비 이동 개월. -60=60개월 조기, 0=정상, +60=60개월 연기. 퍼센트나 감액률이 아니다.",
      )
      .optional(),
  })
  .strict();
const schemas = {
  inspect: z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
      before: z.boolean().optional(),
    })
    .strict(),
  compare: z
    .object({
      candidates: z
        .array(
          z
            .object({
              name: z.string().min(1).max(60),
              household: householdPatch,
              plan: planPatch,
            })
            .strict(),
        )
        .min(1)
        .max(3),
    })
    .strict(),
  search: z
    .object({
      goal: z.enum(["endAssets", "minAssets"]),
      locks: planPatch,
      avoidShortfall: z.boolean(),
    })
    .strict(),
};
export type Candidate = ReturnType<typeof candidate>;
export type CandidateInput = Pick<Candidate, "name" | "household" | "plan">;
export type AgentReply = {
  answer: string;
  candidates: Candidate[];
  tools: string[];
  searched: number;
};
function metrics(h: Household, s: Solutions, before = false) {
  const r = calculate(h, before ? none : s, !before);
  return {
    firstNegative: r.firstNegative,
    minAssets: r.minAssets,
    minMonth: r.minMonth,
    endAssets: r.endAssets,
    lifeNet: r.lifeNet,
    reserve: r.reserve,
    passes: r.passes,
    warnings: r.warnings,
  };
}
function candidate(name: string, household: Household, plan: Solutions) {
  return { name, household, plan, metrics: metrics(household, plan) };
}
function readable(c: Candidate) {
  return {
    name: c.name,
    household: c.household,
    plan: c.plan,
    metrics: Object.fromEntries(
      Object.entries(c.metrics).map(([k, v]) => [
        k,
        typeof v === "number" ? fmt(v) : v,
      ]),
    ),
  };
}
export function executeHouseholdTool(
  name: string,
  args: unknown,
  h: Household,
  s: Solutions,
  unavailable: (keyof Household)[] = [],
) {
  const unavailablePlan = (plan: Solutions, patch: Partial<Household> = {}) =>
    Object.entries({
      job: ["jobIncome"],
      benefits: ["benefit", "benefitMonths"],
      catchup: ["catchupCost", "catchupPension"],
      home: ["house"],
    }).some(
      ([key, fields]) =>
        plan[key as keyof Solutions] === true &&
        fields.some(
          (field) =>
            unavailable.includes(field as keyof Household) &&
            !Number.isFinite(patch[field as keyof Household]),
        ),
    );
  if (name === "inspect") {
    const a = schemas.inspect.parse(args),
      r = calculate(h, a.before ? none : s, !a.before);
    const row = a.month ? r.rows.find((x) => x.date === a.month) : undefined;
    if (a.month && !row) throw Error("분석 기간에 포함된 월을 입력하세요.");
    return {
      candidates: [] as Candidate[],
      searched: 0,
      data: {
        metrics: metrics(h, s, a.before),
        month: row
          ? {
              date: row.date,
              income: row.income,
              expenses: row.expenses,
              assets: row.assets,
              components: row.components,
            }
          : null,
      },
    };
  }
  if (name === "compare") {
    const a = schemas.compare.parse(args);
    if (
      a.candidates.some((c) =>
        unavailablePlan({ ...s, ...c.plan }, c.household),
      )
    )
      throw Error(
        "해당 준비 방법의 비용·월액 정보가 미확인입니다. 사용자에게 먼저 확인하세요.",
      );
    const candidates = a.candidates.map((c) =>
      candidate(
        c.name,
        householdSchema.parse({ ...h, ...c.household }),
        solutionSchema.parse({ ...s, ...c.plan }),
      ),
    );
    return {
      candidates,
      searched: 0,
      data: { current: metrics(h, s), candidates: candidates.map(readable) },
    };
  }
  if (name === "search") {
    const a = schemas.search.parse(args),
      candidates: Candidate[] = [];
    const keys = ["benefits", "job", "repay", "catchup", "home"] as const;
    // Enumerate every on/off combination, including benefits and catch-up contributions.
    // Rates, living costs and household information remain fixed during this search.
    const years = [
      ...new Set([
        s.homeYear,
        Math.max(
          2026,
          Math.min(
            2120,
            Math.max(+h.birth.slice(0, 4), +h.spouseBirth.slice(0, 4)) + 55,
          ),
        ),
        Math.max(2026, Math.min(2120, s.homeYear + 5)),
      ]),
    ];
    const offsets = [...new Set([s.pensionOffset, -60, 0, 60])];
    let searched = 0;
    for (let mask = 0; mask < 32; mask++)
      for (const homeYear of years)
        for (const pensionOffset of offsets) {
          const plan = solutionSchema.parse({
            ...s,
            ...Object.fromEntries(
              keys.map((key, i) => [key, Boolean(mask & (1 << i))]),
            ),
            homeYear,
            pensionOffset,
            ...a.locks,
          });
          if (!plan.home && !Object.hasOwn(a.locks, "homeYear"))
            plan.homeYear = s.homeYear;
          if (unavailablePlan(plan)) continue;
          const id = JSON.stringify(plan);
          if (candidates.some((c) => JSON.stringify(c.plan) === id)) continue;
          const c = candidate("비교 후보", h, plan);
          searched++;
          candidates.push(c);
        }
    const eligible = candidates.filter(
      (c) =>
        (!a.avoidShortfall || c.metrics.firstNegative === null) &&
        !c.metrics.warnings.some((w) =>
          /주담대 잔액|지원 연령|상환보다 빠릅니다/.test(w),
        ),
    );
    eligible.sort((x, y) => y.metrics[a.goal] - x.metrics[a.goal]);
    const top = eligible.slice(0, 3).map((c, i) => ({
      ...c,
      name: `${a.goal === "endAssets" ? "마지막 자산" : "최저 잔고"} 비교 ${i + 1}`,
    }));
    return {
      candidates: top,
      searched,
      data: {
        goal: a.goal,
        searched,
        feasible: eligible.length,
        scope:
          "5개 준비 방법의 켜기/끄기, 최대 3개 주택연금 연도, 최대 4개 연금 개시월만 비교. 전역 최적 아님. 생활비·수익률 고정. 주택연금은 채무 차감 전 금융자산.",
        candidates: top.map(readable),
      },
    };
  }
  throw Error("지원하지 않는 도구입니다.");
}
export async function runHouseholdAgent(
  client: OpenAI,
  model: string,
  input: {
    question: string;
    household: Household;
    solutions: Solutions;
    history: { role: "user" | "assistant"; content: string }[];
    previousCandidates?: CandidateInput[];
    unavailableFields?: (keyof Household)[];
  },
  signal: AbortSignal,
  complete?: Completion,
): Promise<AgentReply> {
  const { household: h, solutions: s } = input;
  const descriptions = {
    inspect:
      "현재 또는 준비 전 결과와 특정 월의 수입·지출 구성 조회. before=true면 준비 전.",
    compare:
      "사용자가 요청한 변경 조건을 계산하고 현재 안과 비교한다. 후보는 적용 버튼으로만 적용된다.",
    search:
      "자산이 가장 많은 계획을 탐색한다. 최대/최적 질문에 반드시 사용. endAssets는 분석 마지막 명목 금융자산, minAssets는 최저 실질 잔고. 구직급여와 추납을 포함한 5개 방법을 모두 탐색하며 사용자가 고정한 값만 locks에 넣는다. avoidShortfall=true면 자산 소진 없는 안만 반환한다.",
  };
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = Object.entries(
    schemas,
  ).map(([name, schema]) => {
    const { $schema, ...parameters } = z.toJSONSchema(schema, { io: "input" });
    void $schema;
    return {
      type: "function",
      function: {
        name,
        description: descriptions[name as keyof typeof descriptions],
        parameters,
      },
    };
  });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `한국어 은퇴 계획 에이전트. 미확인 항목 ${JSON.stringify(input.unavailableFields || [])}. 해당 항목이 필요한 준비 방법은 사용자에게 먼저 확인한다. 현재 가구 ${JSON.stringify(h)}, 현재 계획 ${JSON.stringify(s)}. 이전 대화 후보 ${JSON.stringify(input.previousCandidates ?? [])}. 현재·선택 계획의 지표를 조회하는 질문은 inspect를 사용하고, 더 나은 계획을 찾아달라고 명시한 경우에만 search를 사용한다. pensionOffset은 정상 개시월 대비 이동 개월이다. -60은 60개월 조기, +60은 60개월 연기이며 퍼센트·감액률이 아니다. 감액·가산률은 임의로 해석하지 않는다. 계산 숫자는 도구로 확인하고 금액은 만원, 소수점 최대 한 자리로 표시한다. 현재 입력이 과거 대화보다 우선한다. 변경 요청은 compare로 후보를 제시하고 화면 적용은 사용자의 버튼 클릭으로만 한다. 임의 적용했다고 말하지 않는다. 가장 많은/최적 질문은 search를 반드시 실행하고 목표(endAssets 기본), 고정 조건, 탐색 범위를 밝힌다. 순자산과 금융자산을 혼동하지 않는다. 물가·수익률을 유리하게 바꿔 최적이라고 하지 않는다. 첫 부족월 null은 자산 소진 없음이며 비상자금 미달과 구분한다. 연금·구직급여 자격을 확정하지 말고 실시간 제도 조회를 했다고 말하지 않는다. 정책 질문은 기관 확인이 필요함을 알린다. 짧은 문단으로 먼저 결론, 이유, 비교 조건 순서로 답한다. 계산 범위 밖 질문은 범위를 설명하고 필요한 조건을 묻는다. 이전 후보 후속 질문은 해당 후보의 전체 조건을 compare에 다시 넣어 계산한다. 도구 오류를 숨기지 말고 수정하거나 추가 질문한다. 답변에서 해법 대신 은퇴 계획 또는 준비 방법을 쓴다.`,
    },
    ...input.history,
    { role: "user", content: input.question },
  ];
  const result: AgentReply = {
    answer: "",
    candidates: [],
    tools: [],
    searched: 0,
  };
  let calls = 0;
  for (let round = 0; round < 4; round++) {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
      {
        model,
        messages: [...messages],
        tools,
        tool_choice:
          round === 0
            ? "required"
            : round === 3 || calls >= 6
              ? "none"
              : "auto",
        max_tokens: 2200,
      };
    const response = complete
      ? await complete(params)
      : await withTransientRetry(
          () => client.chat.completions.create(params, { signal }),
          signal,
        );
    const msg = response.choices[0]?.message;
    if (!msg) throw Error("AI 응답이 비어 있습니다.");
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      if (!msg.content?.trim()) throw Error("AI 답변을 완료하지 못했습니다.");
      if (!result.tools.length)
        throw Error("계산 도구 실행 없이 분석이 종료되었습니다.");
      if (
        /최대|최적|가장.{0,12}(많|높|좋)/.test(input.question) &&
        !result.tools.includes("search")
      )
        throw Error("비교 탐색이 완료되지 않았습니다. 다시 질문해 주세요.");
      return {
        ...result,
        answer: msg.content.trim(),
        candidates: result.candidates.slice(-6),
      };
    }
    for (const call of msg.tool_calls) {
      let output: unknown;
      try {
        if (++calls > 6 || call.type !== "function")
          throw Error("분석 호출 한도입니다.");
        const analysis = executeHouseholdTool(
          call.function.name,
          JSON.parse(call.function.arguments),
          h,
          s,
          input.unavailableFields,
        );
        result.candidates.push(...analysis.candidates);
        result.tools.push(call.function.name);
        result.searched += analysis.searched;
        output = analysis.data;
      } catch (e) {
        output = {
          error:
            e instanceof z.ZodError
              ? "조건의 범위·형식을 확인하세요."
              : e instanceof Error
                ? e.message
                : "도구 오류",
        };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }
  throw Error("분석을 완료하지 못했습니다. 질문을 나누어 다시 시도해 주세요.");
}
