import { expect, it } from "vitest";
import {
  adopted,
  calculate,
  example,
  homePaymentDetails,
  none,
} from "../src/lib/household";
import {
  blankHousehold,
  prepareScenario,
  readScenarioFile,
} from "../src/lib/input";
import references from "./report-v17.json";

it("matches the workbook through the same example inputs used on screen", () => {
  for (const [name, plan, planned] of [
    ["월별CF_설계전", none, false],
    ["E4_설계안B", adopted, true],
  ] as const) {
    const reference = references.find((scenario) => scenario.name === name)!;
    const actual = calculate(example, plan, planned);
    expect(actual.rows).toHaveLength(reference.rows.length);
    for (const [index, row] of actual.rows.entries()) {
      const [date, assets, realAssets, health] = reference.rows[index];
      expect(row.date).toBe(date);
      expect(row.assets).toBeCloseTo(Number(assets), 4);
      expect(row.realAssets).toBeCloseTo(Number(realAssets), 4);
      expect(row.components.건강보험).toBeCloseTo(Number(health), 4);
    }
    expect(actual.lifeNet).toBeCloseTo(
      example.assets +
        reference.rows.reduce((sum, row) => sum + Number(row[4]), 0),
      4,
    );
  }
});

it("uses the latest case lookup figures only for the matching conditions", () => {
  expect(homePaymentDetails(example, 2027, 2)).toEqual({
    amount: 61.741,
    source: "case",
  });
  expect(homePaymentDetails(example, 2027, 11)).toEqual({
    amount: 61.741,
    source: "case",
  });
  expect(homePaymentDetails(example, 2031, 2)).toEqual({
    amount: 76.461,
    source: "case",
  });
  expect(homePaymentDetails(example, 2035, 2)).toEqual({
    amount: 88.543,
    source: "case",
  });
  expect(homePaymentDetails({ ...example, house: 31500 }, 2031, 2)).toEqual({
    amount: 68.815,
    source: "case",
  });
  expect(homePaymentDetails(example, 2031, 3).source).toBe("estimate");
  expect(
    homePaymentDetails({ ...example, hasSpouse: false }, 2031, 2).source,
  ).toBe("estimate");
  expect(homePaymentDetails(example, 2031, 2, 81.2345)).toEqual({
    amount: 81.2345,
    source: "manual",
  });
  const manual = calculate(example, { ...adopted, homeOverride: 81.2345 });
  expect(
    manual.rows.find((row) => row.components.주택연금 > 0)?.components.주택연금,
  ).toBe(81.2345);
});

it("loads older personal inputs with zero property premium and handles blank amounts", () => {
  const previous = { ...example };
  delete previous.propertyHealthPremium;
  const { household } = readScenarioFile({
    household: previous,
    solutions: none,
  });
  expect(blankHousehold().propertyHealthPremium).toBe(0);
  expect(household.propertyHealthPremium).toBe(0);
  expect(
    prepareScenario({ ...household, propertyHealthPremium: NaN }, none)
      .household?.propertyHealthPremium,
  ).toBe(0);

  const date = "2030-01";
  const before = calculate(household, none, false);
  const updated = calculate(example, none, false);
  const health = (rows: typeof before.rows) =>
    rows.find((row) => row.date === date)!.components.건강보험;
  expect(health(updated.rows) - health(before.rows)).toBeCloseTo(
    0.4653 * 1.02 ** 4 * 1.1314,
    10,
  );
});
