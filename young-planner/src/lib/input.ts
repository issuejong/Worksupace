import { z } from "zod";
import {
  Household,
  Solutions,
  householdSchema,
} from "./household";
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
