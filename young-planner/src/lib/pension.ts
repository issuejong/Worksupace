import Decimal from "decimal.js";
/** Fixed fictional household. Weighted coefficients come from the supplied annual history. */
export function pensionAmount(
  months: number,
  weightedCoefficients: number,
  averageIncome: number,
  oldMonths: number,
) {
  const d = new Decimal(weightedCoefficients)
    .mul(new Decimal(319.3511).plus(averageIncome))
    .minus(new Decimal(2.4).mul(0.25).mul(averageIncome).mul(oldMonths));
  const rate = months >= 240 ? 1 : 0.5 + ((months - 120) * 5) / 12 / 100;
  return d
    .div(months)
    .mul(1 + (0.05 * Math.max(0, months - 240)) / 12)
    .mul(rate)
    .div(12)
    .toNumber();
}
export function householdPensions() {
  const a = 319.3511;
  return {
    husband: pensionAmount(397, 652.83, a * 0.9, 62),
    wife: pensionAmount(214, 367.08, a * 0.5, 82),
    wifeCatchup: pensionAmount(
      333,
      367.08 + 119 * 1.29,
      (214 * a * 0.5 + 119 * 120) / 333,
      82,
    ),
  };
}
