import { it, expect, vi, afterEach } from "vitest";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => {
  class Fake {
    static APIError = class extends Error {
      status = 500;
    };
    chat = { completions: { create } };
  }
  return { default: Fake };
});
import { POST } from "../src/app/api/agent/route";
import { none } from "../src/lib/household";
afterEach(() => {
  vi.unstubAllEnvs();
  create.mockReset();
});
it("collects partial input without requiring a financial result", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "월 생활비도 알려주세요.",
            patch: { assets: 6000, loan: 0 },
          }),
        },
      },
    ],
  });
  const response = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      body: JSON.stringify({
        operation: "collect",
        question: "예금 6천 있고 대출 없어요",
        household: {},
        solutions: none,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.intake.patch).toEqual({ assets: 6000, loan: 0 });
  expect(body.candidates).toEqual([]);
  expect(create).toHaveBeenCalledTimes(1);
});
it("does not execute analysis with incomplete information", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  const response = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      body: JSON.stringify({
        operation: "analyze",
        question: "계산해줘",
        household: { assets: 6000 },
        solutions: none,
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});
