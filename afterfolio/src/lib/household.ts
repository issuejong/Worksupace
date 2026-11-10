import { z } from "zod";
import base from "../data/params.json";
import { engine, Params, Result } from "./finance";
import { householdPensions } from "./pension";
export const version = "report-v1.7/v17 · 2026-11";
const date = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine((v) => +v.slice(0, 4) >= 1950 && +v.slice(0, 4) <= 2120);
const money = z.number().min(0).max(1000000);
export const householdSchema = z
  .object({
    hasSpouse: z.boolean().optional(),
    birth: date,
    spouseBirth: date,
    retire: date,
    spouseEnd: date,
    start: date,
    endYear: z.number().int().min(2027).max(2120),
    income: money,
    spouseIncome: money,
    assets: money,
    house: money,
    loan: money,
    loanRate: z.number().min(0).max(0.3),
    loanMonths: z.number().int().min(1).max(600),
    living: z.number().min(0).max(2000),
    severance: money,
    tenure: z.number().min(0).max(60),
    pension: money,
    spousePension: money,
    catchupPension: money,
    catchupCost: money,
    child: money,
    childEnd: date,
    inflation: z.number().min(0).max(0.1),
    wageGrowth: z.number().min(0).max(0.1),
    propertyHealthPremium: money.optional(),
    beforeReturn: z.number().min(-0.2).max(0.2),
    planReturn: z.number().min(-0.2).max(0.2),
    jobIncome: money,
    jobDelay: z.number().int().min(0).max(60),
    benefit: money,
    benefitMonths: z.number().int().min(0).max(24),
    reserveMonths: z.number().min(0).max(24),
    shock: money,
    shockYear: z.number().int().min(2026).max(2120),
  })
  .strict()
  .superRefine((h, c) => {
    if (month(h.retire) < month(h.birth) + 18 * 12)
      c.addIssue({
        code: "custom",
        message: "은퇴 시점과 출생연월을 확인하세요.",
      });
    if (month(h.start) > h.endYear * 12 + 12)
      c.addIssue({
        code: "custom",
        message: "종료 연도가 분석 시작보다 빠릅니다.",
      });
    if (
      month(h.start) <= month(h.birth) ||
      month(h.start) <= month(h.spouseBirth)
    )
      c.addIssue({
        code: "custom",
        message: "출생연월이 분석 시작보다 늦습니다.",
      });
  });
export type Household = z.infer<typeof householdSchema>;
export const solutionSchema = z
  .object({
    benefits: z.boolean(),
    job: z.boolean(),
    repay: z.boolean(),
    catchup: z.boolean(),
    home: z.boolean(),
    homeYear: z.number().int().min(2026).max(2120),
    homeMonth: z.number().int().min(1).max(12).default(2),
    pensionOffset: z.number().int().min(-60).max(60),
    homeOverride: z.number().min(0).max(500),
  })
  .strict();
export type Solutions = z.infer<typeof solutionSchema>;
const pensions = householdPensions();
export const example: Household = {
  birth: "1967-01",
  spouseBirth: "1970-01",
  retire: "2027-01",
  spouseEnd: "2029-12",
  start: "2026-11",
  endYear: 2060,
  income: 350,
  spouseIncome: 108,
  assets: 6000,
  house: 35000,
  loan: 5000,
  loanRate: 0.048,
  loanMonths: 120,
  living: 250,
  severance: 4881.42055985706,
  tenure: 12 + 1 / 12,
  pension: pensions.husband,
  spousePension: pensions.wife,
  catchupPension: pensions.wifeCatchup,
  catchupCost: 1356.6,
  child: 50,
  childEnd: "2027-12",
  inflation: 0.02,
  wageGrowth: 0.03,
  propertyHealthPremium: 0.4653,
  beforeReturn: 0.02538,
  planReturn: 0.027918,
  jobIncome: 196.8806207,
  jobDelay: 0,
  benefit: 198.144,
  benefitMonths: 9,
  reserveMonths: 5,
  shock: 0,
  shockYear: 2030,
};
export const adopted: Solutions = {
  benefits: true,
  job: true,
  repay: true,
  catchup: true,
  home: true,
  homeYear: 2031,
  homeMonth: 2,
  pensionOffset: 0,
  homeOverride: 0,
};
export const none: Solutions = {
  ...adopted,
  benefits: false,
  job: false,
  repay: false,
  catchup: false,
  home: false,
};
export function month(v: string) {
  const [y, m] = v.split("-").map(Number);
  return y * 12 + m;
}
export function normalAge(year: number) {
  return year <= 1952
    ? 60
    : year <= 1956
      ? 61
      : year <= 1960
        ? 62
        : year <= 1964
          ? 63
          : year <= 1968
            ? 64
            : 65;
}
export function pensionStart(birth: string) {
  return month(birth) + normalAge(+birth.slice(0, 4)) * 12 + 1;
}
export function installment(loan: number, rate: number, months: number) {
  if (!loan) return 0;
  const i = rate / 12;
  if (!i) return loan / months;
  return (loan * i) / -Math.expm1(-months * Math.log1p(i));
}
// Case figures recorded in the v1.7 workbook, in 만 원 per month.
const caseHomeQuotes = [
  { year: 2027, month: 2, house: 35000, amount: 61.741 },
  { year: 2027, month: 11, house: 35000, amount: 61.741 },
  { year: 2031, month: 2, house: 35000, amount: 76.461 },
  { year: 2031, month: 2, house: 31500, amount: 68.815 },
  { year: 2035, month: 2, house: 35000, amount: 88.543 },
];
export const homePaymentSource = {
  case: "예시 조회값 · 2026년 3월 지급표 기준",
  estimate: "지급표를 바탕으로 계산한 추정값",
  manual: "직접 입력한 금액",
};
export function homePaymentDetails(
  h: Household,
  year: number,
  monthOfYear: number,
  override = 0,
) {
  if (override > 0) return { amount: override, source: "manual" } as const;
  const quote =
    h.hasSpouse !== false &&
    h.birth === example.birth &&
    h.spouseBirth === example.spouseBirth
      ? caseHomeQuotes.find(
          (q) =>
            q.year === year && q.month === monthOfYear && q.house === h.house,
        )
      : undefined;
  if (quote) return { amount: quote.amount, source: "case" } as const;

  const age = Math.floor(
    (year * 12 +
      monthOfYear -
      (h.hasSpouse === false
        ? month(h.birth)
        : Math.max(month(h.birth), month(h.spouseBirth)))) /
      12,
  );
  if (!Number.isFinite(age) || age < 55 || age > 70 || !(h.house > 0))
    return { amount: null, source: "unavailable" } as const;
  const ages = [55, 60, 65, 70],
    amount = [54.6, 73.7, 88.45, 107.7];
  const i = Math.min(2, Math.floor((age - 55) / 5));
  const monthly =
    ((amount[i] + ((amount[i + 1] - amount[i]) * (age - ages[i])) / 5) *
      h.house) /
    35000;
  return { amount: monthly, source: "estimate" } as const;
}
export function homePayment(h: Household, year: number, monthOfYear = 2) {
  return homePaymentDetails(h, year, monthOfYear).amount;
}
export type Simulation = Result & {
  lifeNet: number;
  minMonth: string;
  gapMonths: number;
  householdGap: number;
  homeMonthly: number;
  warnings: string[];
};
export function calculate(
  input: Household,
  choice: Solutions,
  planned = true,
): Simulation {
  const h = householdSchema.parse(input),
    s = solutionSchema.parse(choice),
    p: Params = { ...base };
  const start = month(h.start),
    end = h.endYear * 12 + 12,
    retire = month(h.retire),
    normal = pensionStart(h.birth),
    wife = pensionStart(h.spouseBirth),
    home =
      homePaymentDetails(h, s.homeYear, s.homeMonth, s.homeOverride).amount ??
      0;
  const warnings: string[] = [];
  const homeStart = s.homeYear * 12 + s.homeMonth;
  const hasHousingAmount = h.house > 0 || s.homeOverride > 0;
  const paysBenefits = s.benefits && h.benefit > 0 && h.benefitMonths > 0;
  const naturallyRepaid = homeStart >= start + h.loanMonths;
  const housingReady =
    h.loan === 0 ||
    naturallyRepaid ||
    (s.repay && retire + 1 >= start && homeStart >= retire + 1);
  if (s.home && hasHousingAmount && !housingReady && s.repay)
    warnings.push(
      retire + 1 < start
        ? "퇴직 시 상환 예정월이 분석 시작 전입니다. 상환했다면 분석 시작 시점의 대출 잔액을 수정하세요."
        : "주택연금 개시가 대출 상환보다 빠릅니다. 가입 시점을 상환 이후로 바꾸세요.",
    );
  if (s.home && hasHousingAmount && !home)
    warnings.push(
      "주택연금 표의 지원 연령(연소자 55~70세)을 벗어났습니다. 확인한 월지급금을 세부 설정에 입력하세요.",
    );
  if (s.home && hasHousingAmount && !housingReady && !s.repay)
    warnings.push(
      "주담대 잔액이 있어 일반 종신지급형 주택연금을 적용하지 않았습니다. 대출 상환 또는 별도 상품 조건 확인이 필요합니다.",
    );
  if (s.pensionOffset < 0)
    warnings.push(
      "조기연금은 가입기간·소득 요건을 별도로 확인해야 합니다. 이 화면은 개시월과 감액률만 비교합니다.",
    );
  const pay = installment(h.loan, h.loanRate, h.loanMonths);
  Object.assign(p, {
    4: +h.start.slice(0, 4),
    5: h.inflation,
    6: h.wageGrowth,
    7: planned ? h.planReturn : h.beforeReturn,
    8: retire,
    9: normal + s.pensionOffset,
    10: wife,
    11: +h.spouseEnd.slice(0, 4),
    45: month(h.spouseEnd),
    12: month(h.childEnd),
    13: h.income,
    14: h.hasSpouse === false ? 0 : h.spouseIncome,
    15: h.severance,
    16: h.living,
    17: h.living,
    18: h.child,
    19:
      h.pension * (1 + s.pensionOffset * (s.pensionOffset < 0 ? 0.005 : 0.006)),
    20: h.hasSpouse === false ? 0 : h.spousePension,
    21: h.catchupPension,
    22: h.loan,
    23: h.loanRate,
    24: pay,
    25: h.assets,
    30: h.propertyHealthPremium ?? 0,
    31: h.benefit,
    32: h.benefitMonths,
    33: retire + 1 + (paysBenefits ? h.benefitMonths : 0) + h.jobDelay,
    34: normal - 1,
    35: h.jobIncome,
    36: h.catchupCost,
    37: start,
    38: homeStart,
    39: home,
    40: +paysBenefits,
    41: +(s.job && h.jobIncome > 0),
    42: +s.repay,
    43: +(s.catchup && h.hasSpouse !== false && h.catchupPension > 0),
    44: +(s.home && home > 0 && housingReady),
  });
  const result = engine(p, h.shock, h.shockYear, {
    start,
    end,
    reserve: h.reserveMonths * (h.living + pay),
  });
  const lifeNet =
    h.assets +
    result.rows.reduce(
      (sum, r) =>
        sum + (r.net - r.interest) / (1 + h.inflation) ** (r.year - p[4]),
      0,
    );
  return {
    ...result,
    lifeNet,
    minMonth: result.rows.find((r) => r.realAssets === result.minAssets)!.date,
    gapMonths: Math.max(0, normal - retire - 1),
    householdGap: result.rows.filter((r) =>
      [
        "본인급여",
        "배우자급여",
        "본인연금",
        "배우자연금",
        "구직급여",
        "재취업",
        "주택연금",
      ].every((k) => r.components[k] === 0),
    ).length,
    homeMonthly: home,
    warnings,
  };
}
export const fmt = (v: number) =>
  v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
