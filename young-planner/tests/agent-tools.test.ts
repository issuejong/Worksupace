import { it, expect } from "vitest";
import { defaults, preset, simulate } from "../src/lib/finance";
import { runTool } from "../src/lib/agent/tools";
it("ranks the actual best combination and keeps financial and eligibility assumptions fixed", () => {
  const base = { ...defaults, living: 280, benefits: false };
  const result = runTool("search_scenarios", {}, base);
  const independent = [];
  for (const repay of [false, true])
    for (const catchup of [false, true])
      for (const id of ["none", "S4", "S5", "S6"]) {
        const p = preset(id === "none" ? "S4" : id);
        independent.push(
          simulate({
            ...base,
            repay,
            catchup,
            home: id !== "none",
            homeYear: p.homeYear,
            homePayment: p.homePayment,
          }).endAssets,
        );
      }
  expect(result.candidates[0].metrics.endAssets).toBeCloseTo(
    Math.max(...independent),
    6,
  );
  expect(base.catchup).toBe(true);
  for (const c of result.candidates) {
    expect(c.config.living).toBe(280);
    expect(c.config.benefits).toBe(false);
    expect(c.config.returns).toBe(base.returns);
  }
});
it("respects locks and couples housing year to its registered payment", () => {
  const r = runTool(
    "search_scenarios",
    { locks: { home: true, homeYear: 2031, catchup: false } },
    defaults,
  );
  for (const c of r.candidates) {
    expect(c.config.homePayment).toBe(76.65);
    expect(c.config.catchup).toBe(false);
  }
});
it("reports infeasibility without silently dropping reserve requirements", () => {
  const r = runTool(
    "search_scenarios",
    { requireReserve: true },
    { ...defaults, initialAssets: 0, living: 2000 },
  );
  expect(r.candidates).toHaveLength(0);
});
it("spending result is feasible and the next unit is not", () => {
  const r = runTool("find_spending_limit", { requireReserve: true }, defaults);
  const c = r.candidates[0].config;
  expect(simulate(c).passes).toBe(true);
  expect(simulate({ ...c, living: c.living + 0.01 }).passes).toBe(false);
});
it("supports benefits changes and rejects unknown input", () => {
  expect(
    runTool("simulate_scenario", { changes: { benefits: false } }, defaults)
      .candidates[1].config.benefits,
  ).toBe(false);
  expect(() =>
    runTool("simulate_scenario", { changes: { unknown: 1 } }, defaults),
  ).toThrow();
});
