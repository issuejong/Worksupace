import { z } from "zod";
import { Household, Solutions, householdSchema } from "./household";
export const draftSchema = z.object(householdSchema.shape).partial().strict();
export const inputLabels: Partial<Record<keyof Household, string>> = {
  hasSpouse: "배우자 여부",
  birth: "본인 출생연월",
  spouseBirth: "배우자 출생연월",
  retire: "본인 은퇴 예정월",
  spouseEnd: "배우자 근로 종료월",
  income: "본인 세후 월급",
  spouseIncome: "배우자 세후 월급",
  assets: "금융자산",
  loan: "대출 잔액",
  living: "월 생활비",
  severance: "예상 세후 퇴직금",
  pension: "본인 예상 월 연금",
  spousePension: "배우자 예상 월 연금",
  loanRate: "대출 연금리",
  loanMonths: "대출 잔여 개월",
  house: "주택가격",
  jobIncome: "재취업 월급",
  benefit: "구직급여 월액",
  benefitMonths: "구직급여 기간",
  catchupCost: "추납 비용",
  catchupPension: "추납 후 월 연금",
};
export function blankHousehold(): Household {
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  });
  const year = Number(today.slice(0, 4)),
    start = today.slice(0, 7);
  return {
    birth: "",
    spouseBirth: "",
    retire: "",
    spouseEnd: "",
    start: start,
    endYear: year + 34,
    income: NaN,
    spouseIncome: NaN,
    assets: NaN,
    house: NaN,
    loan: NaN,
    loanRate: NaN,
    loanMonths: NaN,
    living: NaN,
    severance: NaN,
    tenure: 0,
    pension: NaN,
    spousePension: NaN,
    catchupPension: NaN,
    catchupCost: NaN,
    child: 0,
    childEnd: start,
    inflation: 0.02,
    wageGrowth: 0.03,
    beforeReturn: 0.02538,
    planReturn: 0.027918,
    jobIncome: NaN,
    jobDelay: 0,
    benefit: NaN,
    benefitMonths: NaN,
    reserveMonths: 5,
    shock: 0,
    shockYear: year,
  };
}
export function cleanDraft(h: Partial<Household>): Partial<Household> {
  return Object.fromEntries(
    Object.entries(h).filter(([, v]) =>
      typeof v === "number" ? Number.isFinite(v) : v === false || Boolean(v),
    ),
  );
}
export function prepareScenario(h: Household, s: Solutions) {
  const single = h.hasSpouse === false;
  const required: (keyof Household)[] = ["birth", "retire"];
  if (h.hasSpouse === undefined && !h.spouseBirth) required.push("hasSpouse");
  required.push("income", "assets", "loan", "living", "severance", "pension");
  if (!single && (h.hasSpouse === true || h.spouseBirth)) {
    required.push("spouseBirth", "spouseIncome", "spousePension");
    if (h.spouseIncome > 0) required.push("spouseEnd");
  }
  if (h.loan > 0) required.push("loanRate", "loanMonths");
  if (s.home) required.push("house");
  if (s.job) required.push("jobIncome");
  if (s.benefits) required.push("benefit", "benefitMonths");
  if (s.catchup && !single) required.push("catchupCost", "catchupPension");
  const missing = required.filter((k) =>
    typeof h[k] === "number"
      ? !Number.isFinite(h[k])
      : h[k] === undefined || h[k] === "",
  );
  if (missing.length) return { missing, household: null };
  const normalized = {
    ...h,
    house: Number.isFinite(h.house) ? h.house : 0,
    spouseBirth: single ? h.birth : h.spouseBirth,
    spouseIncome: single ? 0 : h.spouseIncome,
    spousePension: single ? 0 : h.spousePension,
    spouseEnd: single || h.spouseIncome === 0 ? h.start : h.spouseEnd,
    loanRate: h.loan === 0 ? 0 : h.loanRate,
    loanMonths: h.loan === 0 ? 1 : h.loanMonths,
    jobIncome: Number.isFinite(h.jobIncome) ? h.jobIncome : 0,
    benefit: Number.isFinite(h.benefit) ? h.benefit : 0,
    benefitMonths: Number.isFinite(h.benefitMonths) ? h.benefitMonths : 0,
    catchupCost: Number.isFinite(h.catchupCost) ? h.catchupCost : 0,
    catchupPension: Number.isFinite(h.catchupPension) ? h.catchupPension : 0,
  };
  const parsed = householdSchema.safeParse(normalized);
  return { missing, household: parsed.success ? parsed.data : null };
}
export const proposalSchema = z
  .object({ answer: z.string().min(1).max(2500), patch: draftSchema })
  .strict();

export class IntakeResponseError extends Error {
  readonly code = "invalid_ai_response";
  readonly name = "IntakeResponseError";
}

// Use a list so the strict schema only requires keys on entries the model emits.
export const intakeResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "household_intake_fields",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "patch"],
      properties: {
        answer: { type: "string" },
        patch: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["field", "value"],
            properties: {
              field: { type: "string", enum: Object.keys(draftSchema.shape) },
              value: {
                anyOf: [
                  { type: "number" },
                  { type: "string" },
                  { type: "boolean" },
                ],
              },
            },
          },
        },
      },
    },
  },
};

export function parseIntakeResponse(content: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new IntakeResponseError("AI 응답 형식이 올바르지 않습니다.");
  }
  const envelope = z
    .object({
      answer: z.string().trim().min(1).max(2500),
      patch: z
        .union([
          z.record(z.string(), z.unknown()),
          z
            .array(
              z.object({
                field: z.string(),
                value: z.union([z.number(), z.string(), z.boolean()]),
              }),
            )
            .max(Object.keys(draftSchema.shape).length),
        ])
        .nullish(),
    })
    .safeParse(raw);
  if (!envelope.success)
    throw new IntakeResponseError("AI 응답을 읽을 수 없습니다.");
  const patch: Partial<Household> = {};
  const invalid: string[] = [];
  const updates = envelope.data.patch;
  const entries = Array.isArray(updates)
    ? updates.map(({ field, value }) => [field, value] as const)
    : Object.entries(updates || {});
  const counts = new Map<string, number>();
  for (const [key] of entries) counts.set(key, (counts.get(key) || 0) + 1);
  for (const [key, value] of entries) {
    if (!Object.hasOwn(draftSchema.shape, key)) continue;
    // Unknown values are absent, never zero or an invented month.
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim())
    )
      continue;
    const field = key as keyof Household;
    const checked = draftSchema.shape[field].safeParse(value);
    if (checked.success && counts.get(key) === 1)
      Object.assign(patch, { [field]: checked.data });
    else invalid.push(inputLabels[field] || key);
  }
  const answer = invalid.length
    ? `${envelope.data.answer.slice(0, 2000)}\n\n다음 정보는 형식이나 범위를 확인해야 해서 반영하지 않았어요: ${[...new Set(invalid)].join(" · ")}. 날짜는 연도와 월(YYYY-MM), 금액은 만 원 단위로 알려주세요.`
    : envelope.data.answer;
  return {
    ...proposalSchema.parse({ answer, patch }),
    invalidFields: [...new Set(invalid)],
  };
}

const intakeQuestions: Partial<Record<keyof Household, string>> = {
  birth: "본인 출생연월은 언제인가요? (예: 1970-02)",
  retire: "은퇴 예정월은 언제인가요? (예: 2028-12)",
  hasSpouse: "함께 계산할 배우자가 있나요? (있어요 / 없어요)",
  income: "현재 세후 월급은 얼마인가요? (만 원)",
  assets: "예금과 투자금을 합친 금융자산은 얼마인가요? (만 원)",
  loan: "주택담보대출 잔액은 얼마인가요? 대출이 없으면 ‘대출 없음’이라고 답해 주세요.",
  living: "한 달 생활비는 얼마인가요? (만 원)",
  severance: "예상 세후 퇴직금은 얼마인가요? 없으면 0원이라고 답해 주세요.",
  pension: "정상 수령 시 예상 월 국민연금은 얼마인가요? (만 원)",
  spouseBirth: "배우자의 출생연월은 언제인가요? (예: 1972-03)",
  spouseIncome:
    "배우자의 세후 월급은 얼마인가요? 근로소득이 없으면 0원이라고 답해 주세요.",
  spouseEnd: "배우자의 근로 종료 예정월은 언제인가요? (예: 2029-12)",
  spousePension: "배우자의 예상 월 국민연금은 얼마인가요? (만 원)",
  loanRate: "대출 연금리는 몇 퍼센트인가요? (예: 3.5%)",
  loanMonths: "대출 상환 기간이 몇 개월 남았나요?",
};

export function intakeAnswer(
  h: Household,
  s: Solutions,
  patch: Partial<Household>,
  invalid: string[],
  hasPending: boolean,
) {
  const next = prepareScenario({ ...h, ...patch }, s);
  const first = next.missing[0];
  const followUp = first
    ? intakeQuestions[first] ||
      `다음으로 ${inputLabels[first] || first}을 알려주세요.`
    : next.household
      ? hasPending
        ? "계산에 필요한 정보가 모였어요. 확인 카드에서 ‘정리한 정보 반영’을 누르면 결과를 볼 수 있어요."
        : "계산에 필요한 정보가 모였어요."
      : "입력한 날짜와 계산 기간을 확인해 주세요. 직접 입력 화면에서 수정할 수 있어요.";
  return [
    Object.keys(patch).length ? "알려주신 내용을 확인 카드에 정리했어요." : "",
    invalid.length
      ? `형식이나 범위를 확인할 항목은 제외했어요. ${invalid.join(" · ")}`
      : "",
    followUp,
  ]
    .filter(Boolean)
    .join("\n\n");
}
