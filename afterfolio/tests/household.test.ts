import { describe, it, expect } from "vitest";
import {
  example,
  adopted,
  none,
  calculate,
  homePayment,
  installment,
  householdSchema,
  pensionStart,
  month,
} from "../src/lib/household";
import { engine } from "../src/lib/finance";
import references from "./report-v11.json";
describe("v11 Excel monthly reconciliation", () => {
  for (const ref of references)
    it(ref.name, () => {
      const r = engine(ref.params);
      expect(r.rows).toHaveLength(410);
      r.rows.forEach((row, i) =>
        expect(Math.abs(row.assets - ref.assets[i])).toBeLessThan(0.0001),
      );
    });
});
describe("household simulator", () => {
  it("reproduces before and adopted headline metrics", () => {
    const b = calculate(example, none, false),
      a = calculate(example, adopted);
    expect(b.firstNegative).toBe("2031-02");
    expect(b.lifeNet).toBeCloseTo(-29398.8546046442, 4);
    expect(a.minAssets).toBeCloseTo(3616.55185834155, 4);
    expect(a.lifeNet).toBeCloseTo(5556.72076379601, 4);
    expect(a.minMonth).toBe("2035-01");
    expect(a.firstNegative).toBeNull();
    expect(b.gapMonths).toBe(48);
  });
  it("moves household income events by month", () => {
    const a = calculate({ ...example, spouseEnd: "2028-06" }, none, false);
    expect(
      a.rows.find((r) => r.date === "2028-06")!.components.배우자급여,
    ).toBeGreaterThan(0);
    expect(
      a.rows.find((r) => r.date === "2028-07")!.components.배우자급여,
    ).toBe(0);
  });
  it("reproduces the workbook's early housing-pension risk responses", () => {
    const earlyHome = {
      ...adopted,
      job: false,
      homeYear: 2027,
      homeMonth: 11,
      homeOverride: 62.24,
    };
    const r1a = calculate(example, earlyHome);
    expect(r1a.firstNegative).toBe("2031-07");
    expect(r1a.minAssets).toBeCloseTo(-2733.99067895279, 4);

    const extendedWork = { ...example, spouseEnd: "2033-12" };
    const r1e = calculate(extendedWork, earlyHome);
    expect(r1e.firstNegative).toBeNull();
    expect(r1e.minAssets).toBeCloseTo(1841.2929087684, 4);
  });
  it("supports zero loan and zero-interest loans", () => {
    expect(installment(1200, 0, 120)).toBe(10);
    expect(installment(1200, 1e-16, 120)).toBeCloseTo(10);
    expect(
      calculate({ ...example, loan: 0 }, adopted).rows.every(
        (r) => r.loan === 0,
      ),
    ).toBe(true);
  });
  it("changes start date and horizon", () => {
    expect(
      calculate({ ...example, start: "2027-01", endYear: 2028 }, none, false)
        .rows,
    ).toHaveLength(24);
  });
  it("keeps lifetime balance independent of return but changes asset path", () => {
    const a = calculate(example, adopted),
      b = calculate({ ...example, planReturn: 0 }, adopted);
    expect(a.lifeNet).toBeCloseTo(b.lifeNet, 6);
    expect(a.endAssets).toBeGreaterThan(b.endAssets);
  });
  it("applies pension timing factor and dates", () => {
    const a = calculate(example, { ...none, pensionOffset: -39 }, false);
    expect(
      a.rows.find((r) => r.date === "2027-11")!.components.본인연금,
    ).toBeGreaterThan(0);
    expect(month("2031-02")).toBe(pensionStart(example.birth));
  });
  it("does not silently use housing outside supported age or with unpaid loan", () => {
    expect(
      homePayment({ ...example, spouseBirth: "2000-01" }, 2031),
    ).toBeNull();
    const a = calculate(example, { ...adopted, repay: false });
    expect(a.rows.every((r) => r.components.주택연금 === 0)).toBe(true);
    expect(a.warnings.length).toBeGreaterThan(0);
  });
  it("starts the housing pension after the mortgage's scheduled final payment", () => {
    const h = { ...example, loanMonths: 12 };
    const plan = { ...none, home: true, homeYear: 2027 };
    const beforePayoff = calculate(h, { ...plan, homeMonth: 10 });
    const afterPayoff = calculate(h, { ...plan, homeMonth: 11 });
    expect(beforePayoff.rows.some((r) => r.components.주택연금 > 0)).toBe(false);
    expect(afterPayoff.rows.find((r) => r.date === "2027-11")?.components.주택연금)
      .toBeGreaterThan(0);
    expect(afterPayoff.warnings).toEqual([]);
  });
  it("does not wait through disabled unemployment benefits before starting work", () => {
    const result = calculate(example, { ...none, job: true });
    expect(result.rows.find((row) => row.components.재취업 > 0)?.date).toBe("2027-02");
  });
  it("does not accept invalid dates or negative inputs", () => {
    expect(
      householdSchema.safeParse({ ...example, birth: "2000-13" }).success,
    ).toBe(false);
    expect(householdSchema.safeParse({ ...example, living: -1 }).success).toBe(
      false,
    );
  });
});
