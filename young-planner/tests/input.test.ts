import { expect, it } from "vitest";
import {
  blankHousehold,
  cleanDraft,
  prepareScenario,
  draftSchema,
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
