import { expect, it } from "vitest";
import { money, moneyAxis } from "../src/lib/money";

it("converts engine amounts into grouped won without modifying the input", () => {
  const amount = 3616.55185834155;
  expect(money(amount)).toBe("36,165,519원");
  expect(amount).toBe(3616.55185834155);
  expect(money(-21301.0062)).toBe("-213,010,062원");
  expect(money(0)).toBe("0원");
  expect(money(-0.00001)).toBe("0원");
  expect(money(NaN)).toBe("—");
});
it("labels large chart values compactly in Korean units", () => {
  expect(moneyAxis(15000)).toBe("1.5억");
  expect(moneyAxis(-5000)).toBe("-5,000만");
});
