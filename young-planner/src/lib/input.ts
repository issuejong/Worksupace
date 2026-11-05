import { z } from "zod";
import { Household, Solutions, householdSchema } from "./household";
export const draftSchema = z.object(householdSchema.shape).partial().strict();
export const inputLabels: Partial<Record<keyof Household, string>> = {
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
      typeof v === "number" ? Number.isFinite(v) : Boolean(v),
    ),
  );
}
export function prepareScenario(h: Household, s: Solutions) {
  const required: (keyof Household)[] = [
    "birth",
    "spouseBirth",
    "retire",
    "income",
    "spouseIncome",
    "assets",
    "loan",
    "living",
    "severance",
    "pension",
    "spousePension",
  ];
  if (h.spouseIncome > 0) required.push("spouseEnd");
  if (h.loan > 0) required.push("loanRate", "loanMonths");
  if (s.home) required.push("house");
  if (s.job) required.push("jobIncome");
  if (s.benefits) required.push("benefit", "benefitMonths");
  if (s.catchup) required.push("catchupCost", "catchupPension");
  const missing = required.filter((k) =>
    typeof h[k] === "number" ? !Number.isFinite(h[k]) : !h[k],
  );
  if (missing.length) return { missing, household: null };
  const normalized = {
    ...h,
    house: Number.isFinite(h.house) ? h.house : 0,
    spouseEnd: h.spouseIncome === 0 ? h.start : h.spouseEnd,
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

// Groq strict schemas require every key. Unknown values remain null and are
// removed by parseIntakeResponse; never coerce unknown financial values to zero.
export const intakeResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "household_intake",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "patch"],
      properties: {
        answer: { type: "string" },
        patch: {
          type: "object",
          additionalProperties: false,
          required: Object.keys(householdSchema.shape),
          properties: Object.fromEntries(
            Object.entries(householdSchema.shape).map(([key, field]) => [
              key,
              {
                type: [
                  field instanceof z.ZodString ? "string" : "number",
                  "null",
                ],
                description: `${inputLabels[key as keyof Household] || key}. 미확인 값은 null. ${field instanceof z.ZodString ? "날짜는 YYYY-MM." : "금액은 만원, 비율은 소수."}`,
              },
            ]),
          ),
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
      patch: z.record(z.string(), z.unknown()).nullish(),
    })
    .safeParse(raw);
  if (!envelope.success)
    throw new IntakeResponseError("AI 응답을 읽을 수 없습니다.");
  const patch: Partial<Household> = {};
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(envelope.data.patch || {})) {
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
    if (checked.success) Object.assign(patch, { [field]: checked.data });
    else invalid.push(inputLabels[field] || key);
  }
  const answer = invalid.length
    ? `${envelope.data.answer.slice(0, 2000)}\n\n다음 정보는 형식이나 범위를 확인해야 해서 반영하지 않았어요: ${invalid.join(" · ")}. 날짜는 연도와 월(YYYY-MM), 금액은 만 원 단위로 알려주세요.`
    : envelope.data.answer;
  return proposalSchema.parse({ answer, patch });
}
