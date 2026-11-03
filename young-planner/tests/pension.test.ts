import { it, expect } from "vitest";
import { householdPensions } from "../src/lib/pension";
it("matches independent partial corrections of historic weighting and catch-up", () => {
  const p = householdPensions();
  expect(p.husband).toBeCloseTo(133.827737686, 7);
  expect(p.wife).toBeCloseTo(58.328147785, 7);
  expect(p.wifeCatchup).toBeCloseTo(81.540595277, 7);
});
