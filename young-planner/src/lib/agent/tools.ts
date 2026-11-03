import { z } from "zod";
import {
  Config,
  configSchema,
  simulate,
  preset,
  modelVersion,
} from "../finance";
export const agentVersion = "agent-v1";
const patch = configSchema.partial().strict();
export const toolSchemas = {
  get_current_scenario: z.object({}).strict(),
  simulate_scenario: z.object({ changes: patch }).strict(),
  compare_scenarios: z
    .object({
      cases: z
        .array(z.object({ name: z.string().max(80), changes: patch }))
        .min(1)
        .max(12),
    })
    .strict(),
  search_scenarios: z
    .object({
      objective: z.enum(["endAssets", "minAssets"]).default("endAssets"),
      requireReserve: z.boolean().default(false),
      requireNonNegative: z.boolean().default(false),
      locks: patch.default({}),
      includeJobChoices: z.boolean().default(false),
    })
    .strict(),
  find_spending_limit: z
    .object({
      requireReserve: z.boolean().default(true),
      changes: patch.default({}),
    })
    .strict(),
  stress_test: z.object({}).strict(),
};
export type ToolName = keyof typeof toolSchemas;
export function summary(config: Config) {
  const r = simulate(config);
  return {
    firstNegative: r.firstNegative,
    minAssets: r.minAssets,
    endAssets: r.endAssets,
    reserve: r.reserve,
    passes: r.passes,
  };
}
export function candidate(name: string, config: Config) {
  return { name, config, metrics: summary(config) };
}
export function runTool(name: string, args: unknown, base: Config) {
  const common = {
    baseConfig: base,
    modelVersion,
    agentVersion,
    unit: "만원",
    period: "2026-11~2060-12",
    caveat:
      "가상 고객의 부분 검증 모델. 주택연금 채무를 제외한 금융자산이며 순자산이 아닙니다. 수급·추납·가입 자격과 월액은 확인되지 않은 가정입니다.",
  };
  switch (name) {
    case "get_current_scenario":
      toolSchemas.get_current_scenario.parse(args);
      return {
        ...common,
        kind: "current",
        candidates: [candidate("현재 조건", base)],
      };
    case "simulate_scenario": {
      const { changes } = toolSchemas.simulate_scenario.parse(args);
      return {
        ...common,
        kind: "simulation",
        candidates: [
          candidate("현재 조건", base),
          candidate("변경안", configSchema.parse({ ...base, ...changes })),
        ],
      };
    }
    case "compare_scenarios": {
      const { cases } = toolSchemas.compare_scenarios.parse(args);
      return {
        ...common,
        kind: "comparison",
        candidates: [
          candidate("현재 조건", base),
          ...cases.map((c) =>
            candidate(c.name, configSchema.parse({ ...base, ...c.changes })),
          ),
        ],
      };
    }
    case "search_scenarios": {
      const {
        objective,
        requireReserve,
        requireNonNegative,
        locks,
        includeJobChoices,
      } = toolSchemas.search_scenarios.parse(args);
      const start = configSchema.parse({ ...base, ...locks });
      const choices = new Map<string, Config>();
      const homes = [
        {
          home: false,
          homeYear: start.homeYear,
          homePayment: start.homePayment,
        },
        ...["S4", "S5", "S6"].map((id) => {
          const c = preset(id);
          return {
            home: true,
            homeYear: c.homeYear,
            homePayment: c.homePayment,
          };
        }),
        {
          home: true,
          homeYear: start.homeYear,
          homePayment: start.homePayment,
        },
      ];
      for (const job of includeJobChoices ? [false, true] : [start.job])
        for (const repay of [false, true])
          for (const catchup of [false, true])
            for (const home of homes) {
              if (
                home.home &&
                locks.homeYear !== undefined &&
                home.homeYear !== locks.homeYear
              )
                continue;
              const c = configSchema.parse({
                ...start,
                job,
                repay,
                catchup,
                ...home,
                ...locks,
              });
              if (!c.home) {
                c.homeYear = start.homeYear;
                c.homePayment = start.homePayment;
              }
              choices.set(JSON.stringify(c), c);
            }
      // Include the original condition: search must never underperform its eligible baseline.
      choices.set(JSON.stringify(start), start);
      const all = [...choices.values()].map((c, i) =>
        candidate(`후보 ${i + 1}`, c),
      );
      const eligible = all.filter(
        (c) =>
          (!requireReserve || c.metrics.passes) &&
          (!requireNonNegative || c.metrics.firstNegative === null),
      );
      const sort = (a: (typeof all)[number], b: (typeof all)[number]) =>
        b.metrics[objective] - a.metrics[objective] ||
        b.metrics.minAssets - a.metrics.minAssets ||
        a.name.localeCompare(b.name);
      eligible.sort(sort);
      const safe = all
        .filter((c) => c.metrics.firstNegative === null)
        .sort(sort);
      return {
        ...common,
        kind: "search",
        objective,
        requireReserve,
        requireNonNegative,
        evaluated: all.length,
        feasible: eligible.length,
        fixed: {
          initialAssets: start.initialAssets,
          living: start.living,
          returns: start.returns,
          inflation: start.inflation,
          benefits: start.benefits,
          jobIncome: start.jobIncome,
          jobDelay: start.jobDelay,
          shock: start.shock,
          shockYear: start.shockYear,
          ...(!includeJobChoices ? { job: start.job } : {}),
          ...locks,
        },
        scope:
          "주담대 상환·추납 여부, 주택연금 미가입/등록된 2027·2031·2035년 가정/현재 시점. 지정한 고정 조건 제외.",
        candidates: eligible.slice(0, 3),
        safeAlternative: safe[0] ?? null,
      };
    }
    case "find_spending_limit": {
      const { changes, requireReserve } =
        toolSchemas.find_spending_limit.parse(args);
      const c = configSchema.parse({ ...base, ...changes });
      const passes = (living: number) => {
        const r = summary({ ...c, living });
        return requireReserve ? r.passes : r.firstNegative === null;
      };
      let low = 5000,
        high = 200000; // hundredths of 만원; deterministic integer search
      if (!passes(low / 100))
        return {
          ...common,
          kind: "spending",
          feasible: false,
          scope: "월 50~2,000만 원",
          candidates: [],
        };
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (passes(mid / 100)) low = mid;
        else high = mid - 1;
      }
      return {
        ...common,
        kind: "spending",
        feasible: true,
        requireReserve,
        resolution: 0.01,
        upperBoundReached: low === 200000,
        scope: "월 50~2,000만 원, 0.01만 원 단위",
        candidates: [
          candidate("탐색 범위 내 생활비 한도", { ...c, living: low / 100 }),
        ],
      };
    }
    case "stress_test": {
      toolSchemas.stress_test.parse(args);
      return {
        ...common,
        kind: "stress",
        candidates: [
          candidate("현재 조건", base),
          candidate("재취업 12개월 추가 지연", {
            ...base,
            jobDelay: Math.min(39, base.jobDelay + 12),
          }),
          candidate("재취업 실패", { ...base, job: false }),
          candidate("생활비 30만 원 증가", {
            ...base,
            living: Math.min(2000, base.living + 30),
          }),
          candidate("현재 지출 연도에 의료비 2,000만 원 추가", {
            ...base,
            shock: Math.min(100000, base.shock + 2000),
          }),
        ],
      };
    }
    default:
      throw new Error("허용되지 않은 도구입니다.");
  }
}
export type Analysis = ReturnType<typeof runTool>;
