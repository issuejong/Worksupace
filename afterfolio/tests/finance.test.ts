import { describe, it, expect } from "vitest";
import references from "./reference.json";
import {
  engine,
  simulate,
  preset,
  defaults,
  configSchema,
} from "../src/lib/finance";
describe("reference replication", () => {
  for (const ref of references)
    it(ref.name, () => {
      const r = engine(ref.params);
      expect(r.rows).toHaveLength(410);
      for (let i = 0; i < 410; i++)
        expect(Math.abs(r.rows[i].assets - ref.assets[i])).toBeLessThan(0.0001);
    });
});
describe("scenario behavior", () => {
  it("retires and repays in February 2027", () => {
    const r = simulate(defaults);
    expect(r.rows.find((x) => x.date === "2027-01")!.loan).toBeGreaterThan(0);
    expect(r.rows.find((x) => x.date === "2027-02")!.loan).toBe(0);
  });
  it("delayed reemployment reduces reserves", () => {
    expect(simulate({ ...defaults, jobDelay: 12 }).minAssets).toBeLessThan(
      simulate(defaults).minAssets,
    );
  });
  it("medical shock reduces assets by the exact amount in its month", () => {
    const a = simulate(defaults),
      b = simulate({ ...defaults, shock: 2000 });
    const i = a.rows.findIndex((x) => x.date === "2030-01");
    expect(a.rows[i].assets - b.rows[i].assets).toBeCloseTo(2000, 6);
  });
  it("baseline and plan differ, without modifying presets", () => {
    expect(simulate(preset("S0")).firstNegative).not.toBeNull();
    expect(simulate(preset("S4")).firstNegative).toBeNull();
    expect(preset("S0").home).toBe(false);
  });
  it("rejects unexpected and invalid fields", () => {
    expect(configSchema.safeParse({ ...defaults, living: -1 }).success).toBe(
      false,
    );
    expect(configSchema.safeParse({ ...defaults, code: "x" }).success).toBe(
      false,
    );
  });
});
