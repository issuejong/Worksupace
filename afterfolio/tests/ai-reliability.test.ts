import { expect, it, vi, afterEach } from "vitest";
import { parseIntakeResponse, IntakeResponseError } from "../src/lib/input";
import { withTransientRetry } from "../src/lib/ai-reliability";

afterEach(() => vi.useRealTimers());

it("ignores unknown null and blank values without discarding known zero", () => {
  const result = parseIntakeResponse(
    JSON.stringify({
      answer: "배우자 출생연월을 알려주세요.",
      patch: { assets: 6000, loan: 0, spouseBirth: null, spouseEnd: "  " },
    }),
  );
  expect(result.patch).toEqual({ assets: 6000, loan: 0 });
});

it("keeps valid fields but asks again for an incomplete date and invalid amount", () => {
  const result = parseIntakeResponse(
    JSON.stringify({
      answer: "정보를 확인했어요.",
      patch: {
        birth: "1968",
        assets: 6000,
        living: -1,
        spouseIncome: 0,
        unexpected: 7,
      },
    }),
  );
  expect(result.patch).toEqual({ assets: 6000, spouseIncome: 0 });
  expect(result.answer).toContain("본인 출생연월");
  expect(result.answer).toContain("월 생활비");
  expect(result.answer).not.toContain("unexpected");
});

it("classifies malformed AI JSON as an AI response error", () => {
  expect(() => parseIntakeResponse("not JSON")).toThrow(IntakeResponseError);
});

it("retries a temporary 503 once and recovers", async () => {
  vi.useFakeTimers();
  const call = vi
    .fn()
    .mockRejectedValueOnce({ status: 503 })
    .mockResolvedValue("ok");
  const pending = withTransientRetry(call, new AbortController().signal);
  await vi.runAllTimersAsync();
  expect(await pending).toBe("ok");
  expect(call).toHaveBeenCalledTimes(2);
});

it("caps temporary-error retries at two calls", async () => {
  vi.useFakeTimers();
  const call = vi.fn().mockRejectedValue({ status: 503 });
  const result = withTransientRetry(call, new AbortController().signal).catch(
    (e) => e,
  );
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ status: 503 });
  expect(call).toHaveBeenCalledTimes(2);
});

it("does not retry quota or authentication errors", async () => {
  for (const status of [400, 401, 403, 429]) {
    const call = vi.fn().mockRejectedValue({ status });
    await expect(
      withTransientRetry(call, new AbortController().signal),
    ).rejects.toEqual({ status });
    expect(call).toHaveBeenCalledTimes(1);
  }
});

it("cancels a pending retry without another provider call", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const call = vi.fn().mockRejectedValue({ status: 503 });
  const pending = withTransientRetry(call, controller.signal).catch((e) => e);
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  expect(await pending).toMatchObject({ name: "AbortError" });
  expect(call).toHaveBeenCalledTimes(1);
});
