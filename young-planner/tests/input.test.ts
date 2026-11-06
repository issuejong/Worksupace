import { expect, it } from "vitest";
import {
  blankHousehold,
  cleanDraft,
  prepareScenario,
  draftSchema,
  readScenarioFile,
  mergeIntake,
} from "../src/lib/input";
import { example, adopted, none, calculate } from "../src/lib/household";
it("starts without personal example values or a calculation", () => {
  const h = blankHousehold();
  expect(cleanDraft(h)).not.toHaveProperty("assets");
  expect(prepareScenario(h, none).household).toBeNull();
  expect(prepareScenario(h, none).missing).toContain("assets");
});
it("distinguishes zero from absent and rejects invalid proposed inputs", () => {
  expect(cleanDraft({ assets: 0 })).toEqual({ assets: 0 });
  expect(draftSchema.safeParse({ assets: -1 }).success).toBe(false);
  expect(draftSchema.safeParse({ invented: 1 }).success).toBe(false);
});
it("preserves the full example calculation", () => {
  const h = prepareScenario(example, adopted).household!;
  expect(calculate(h, adopted).minAssets).toBeCloseTo(3616.55185834155, 6);
});
it("requires optional strategy data only when enabled", () => {
  const h = {
    ...example,
    jobIncome: NaN,
    benefit: NaN,
    benefitMonths: NaN,
    catchupCost: NaN,
    catchupPension: NaN,
    house: NaN,
  };
  expect(prepareScenario(h, none).household).not.toBeNull();
  expect(prepareScenario(h, adopted).missing).toContain("catchupCost");
});
it("does not require loan terms when the user reports no loan", () => {
  const h = { ...example, loan: 0, loanRate: NaN, loanMonths: NaN };
  expect(prepareScenario(h, none).household?.loanMonths).toBe(1);
});

it("loads a saved single-person scenario with omitted inactive inputs", () => {
  const draft = { ...blankHousehold(), hasSpouse: false, birth: "1967-01",
    retire: "2027-01", income: 350, assets: 6000, loan: 0,
    living: 250, severance: 1000, pension: 150 };
  const restored = readScenarioFile({ inputFormat: 2, household: cleanDraft(draft), solutions: none });
  expect(restored.fields).not.toContain("jobIncome");
  expect(restored.household.jobIncome).toBeNaN();
  expect(prepareScenario(restored.household, restored.solutions).household)
    .toEqual(prepareScenario(draft, none).household);
});

it("can complete the scenario directly from the final pending chat values", () => {
  const h = { ...example, hasSpouse: undefined, spouseBirth: "", pension: NaN };
  expect(prepareScenario(h, adopted).household).toBeNull();
  const merged = mergeIntake(h, adopted, { hasSpouse: false, pension: 150 });
  expect(merged.solutions.catchup).toBe(false);
  expect(prepareScenario(merged.household, merged.solutions).household?.pension).toBe(150);
});

it("blocks plans that depend on missing income or costs", async () => {
  const { executeHouseholdTool } = await import("../src/lib/household-agent");
  expect(() =>
    executeHouseholdTool(
      "compare",
      { candidates: [{ name: "미확인", household: {}, plan: { job: true } }] },
      example,
      none,
      ["jobIncome"],
    ),
  ).toThrow("미확인");
  const output = executeHouseholdTool(
    "search",
    { goal: "endAssets", locks: { ...none }, avoidShortfall: false },
    example,
    none,
    ["jobIncome", "benefit", "catchupCost"],
  );
  expect(
    output.candidates.every(
      (c) => !c.plan.job && !c.plan.benefits && !c.plan.catchup,
    ),
  ).toBe(true);
});

it("preserves known optional values when their plan is off", () => {
  const prepared = prepareScenario(example, none).household;
  expect(prepared?.jobIncome).toBe(example.jobIncome);
  expect(prepared?.benefit).toBe(example.benefit);
  expect(prepared?.catchupCost).toBe(example.catchupCost);
  expect(prepared?.catchupPension).toBe(example.catchupPension);
});

it("calculates for a single person without spouse values or spouse contributions", () => {
  const single = {
    ...example,
    hasSpouse: false,
    spouseBirth: "",
    spouseEnd: "",
    spouseIncome: NaN,
    spousePension: NaN,
  };
  expect(cleanDraft(single).hasSpouse).toBe(false);
  const prepared = prepareScenario(single, adopted);
  expect(prepared.missing).toEqual([]);
  expect(prepared.household).not.toBeNull();
  const result = calculate(prepared.household!, adopted);
  expect(
    result.rows.every(
      (row) =>
        row.components["배우자급여"] === 0 &&
        row.components["배우자연금"] === 0,
    ),
  ).toBe(true);
  expect(result.endAssets).toBe(
    calculate(prepared.household!, { ...adopted, catchup: false }).endAssets,
  );
});
