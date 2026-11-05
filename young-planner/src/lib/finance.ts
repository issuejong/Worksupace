import Decimal from "decimal.js";
import base from "../data/params.json";
import { z } from "zod";
import { householdPensions } from "./pension";

export const configSchema = z
  .object({
    initialAssets: z.number().min(0).max(1000000),
    living: z.number().min(50).max(2000),
    inflation: z.number().min(0).max(0.1),
    returns: z.number().min(-0.2).max(0.2),
    benefits: z.boolean(),
    job: z.boolean(),
    jobDelay: z.number().int().min(0).max(39),
    jobIncome: z.number().min(0).max(1000),
    repay: z.boolean(),
    catchup: z.boolean(),
    home: z.boolean(),
    homeYear: z.number().int().min(2027).max(2035),
    homePayment: z.number().min(0).max(500),
    shock: z.number().min(0).max(100000),
    shockYear: z.number().int().min(2027).max(2060),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export const defaults: Config = {
  initialAssets: 6000,
  living: 250,
  inflation: 0.02,
  returns: 0.02538,
  benefits: true,
  job: true,
  jobDelay: 0,
  jobIncome: 197.4684957,
  repay: true,
  catchup: true,
  home: true,
  homeYear: 2031,
  homePayment: 76.65,
  shock: 0,
  shockYear: 2030,
};
export const presets = [
  ["S0", "설계 전"],
  ["S1", "재취업"],
  ["S2", "대출 상환"],
  ["S3", "추납 적용"],
  ["S4", "2031년 가입"],
  ["S5", "2027년 가입"],
  ["S6", "2035년 가입"],
] as const;
export function preset(id: string): Config {
  const c = { ...defaults };
  const n = presets.findIndex((p) => p[0] === id);
  c.benefits = n >= 1;
  c.job = n >= 1;
  c.repay = n >= 2;
  c.catchup = n >= 3;
  c.home = n >= 4;
  if (n === 5) {
    c.homeYear = 2027;
    c.homePayment = 62.24;
  }
  if (n === 6) {
    c.homeYear = 2035;
    c.homePayment = 88.45;
  }
  return c;
}
export type Row = {
  date: string;
  year: number;
  income: number;
  expenses: number;
  assets: number;
  realAssets: number;
  net: number;
  loan: number;
  interest: number;
  components: Record<string, number>;
};
export type Result = {
  rows: Row[];
  firstNegative: string | null;
  minAssets: number;
  endAssets: number;
  reserve: number;
  passes: boolean;
};
export type Params = Record<string, number>;
const dec = (n: number) => new Decimal(n);
export function engine(
  p: Params,
  shock = 0,
  shockYear = 2030,
  range = { start: 2026 * 12 + 11, end: 2060 * 12 + 12, reserve: 1512.726559 },
): Result {
  let assets = dec(p[25]),
    loan = dec(p[22]);
  const rows: Row[] = [];
  for (let i = 0; i <= range.end - range.start; i++) {
    const t = range.start + i,
      year = Math.floor((t - 1) / 12),
      month = ((t - 1) % 12) + 1;
    const inf = dec(1 + p[5]).pow(year - p[4]);
    const husband = t <= p[8] ? p[13] : 0,
      retire = t === p[8] + 1 ? p[15] : 0;
    const wife =
      t <= (p[45] ?? p[11] * 12 + 12)
        ? dec(p[14]).mul(dec(1 + p[6]).pow(year - p[4]))
        : dec(0);
    const hp = t >= p[9] ? inf.mul(p[19]) : dec(0),
      wp = t >= p[10] ? inf.mul(p[p[43] === 1 ? 21 : 20]) : dec(0);
    const ui = p[40] === 1 && t > p[8] && t <= p[8] + p[32] ? p[31] : 0;
    const employed = p[41] === 1 && t >= p[33] && t <= p[34];
    const job = employed
      ? dec(p[35]).mul(dec(1 + p[6]).pow(year - p[4]))
      : dec(0);
    const home = p[44] === 1 && t >= p[38] ? p[39] : 0;
    const interest = Decimal.max(0, assets).mul(p[7]).div(12);
    const living = inf.mul(t <= p[8] ? p[16] : p[17]),
      child = t <= p[12] ? p[18] : 0;
    const payoff = p[42] === 1 && t === p[8] + 1;
    const li = payoff ? dec(0) : loan.mul(p[23]).div(12);
    const regular =
      loan.lt(0.0001) || payoff ? dec(0) : Decimal.min(p[24], loan.plus(li));
    const extra = payoff ? loan : dec(0);
    loan = loan.minus(regular.minus(li)).minus(extra);
    const health =
      t <= p[8] || employed || t <= (p[45] ?? p[11] * 12 + 12)
        ? dec(0)
        : Decimal.max(inf.mul(p[28]), hp.plus(wp).mul(p[29]).mul(p[26]))
            .plus(inf.mul(p[30]))
            .mul(1 + p[27]);
    const backpay = p[43] === 1 && t === p[37] ? p[36] : 0;
    const income = dec(husband)
      .plus(retire)
      .plus(wife)
      .plus(hp)
      .plus(wp)
      .plus(ui)
      .plus(job)
      .plus(home)
      .plus(interest);
    const expenses = living
      .plus(child)
      .plus(regular)
      .plus(extra)
      .plus(health)
      .plus(backpay)
      .plus(year === shockYear && month === 1 ? shock : 0);
    assets = assets.plus(income).minus(expenses);
    rows.push({
      date: `${year}-${String(month).padStart(2, "0")}`,
      year,
      income: income.toNumber(),
      expenses: expenses.toNumber(),
      assets: assets.toNumber(),
      realAssets: assets.div(inf).toNumber(),
      net: income.minus(expenses).toNumber(),
      loan: loan.toNumber(),
      interest: interest.toNumber(),
      components: {
        본인급여: Number(husband),
        퇴직금: Number(retire),
        배우자급여: wife.toNumber(),
        본인연금: hp.toNumber(),
        배우자연금: wp.toNumber(),
        구직급여: Number(ui),
        재취업: job.toNumber(),
        주택연금: Number(home),
        운용수익: interest.toNumber(),
        생활비: living.toNumber(),
        자녀지원: Number(child),
        대출상환: regular.plus(extra).toNumber(),
        건강보험: health.toNumber(),
        추납: Number(backpay),
        일시지출: year === shockYear && month === 1 ? shock : 0,
      },
    });
  }
  const reserve = range.reserve,
    minAssets = Math.min(...rows.map((r) => r.realAssets));
  return {
    rows,
    firstNegative: rows.find((r) => r.assets < 0)?.date ?? null,
    minAssets,
    endAssets: rows.at(-1)!.assets,
    reserve,
    passes: minAssets >= reserve,
  };
}
export function simulate(input: Config): Result {
  const c = configSchema.parse(input),
    p: Params = { ...base };
  // Partial pension corrections: pre-1999 B weighting and 2026 catch-up coefficient.
  const pensions = householdPensions();
  p[19] = pensions.husband;
  p[20] = pensions.wife;
  p[21] = pensions.wifeCatchup;
  p[25] = c.initialAssets;
  p[17] = c.living;
  p[5] = c.inflation;
  p[7] = c.returns;
  p[40] = Number(c.benefits);
  p[41] = Number(c.job);
  p[33] += c.jobDelay;
  p[35] = c.jobIncome;
  p[42] = Number(c.repay);
  p[43] = Number(c.catchup);
  p[44] = Number(c.home);
  p[38] = c.homeYear * 12 + 2;
  p[39] = c.homePayment;
  return engine(p, c.shock, c.shockYear);
}
export const modelVersion = "2026-11-03.partial-v1";
