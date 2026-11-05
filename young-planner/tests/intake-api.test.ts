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

it("returns a usable card when the model includes unknown dates", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "배우자 정보는 나중에 알려주세요.",
            patch: { assets: 6000, spouseBirth: null, spouseEnd: "" },
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
        question: "예금은 6천이고 배우자 정보는 몰라요",
        household: {},
        solutions: none,
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).intake.patch).toEqual({ assets: 6000 });
});

it("reports provider unavailability after a single retry", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  create.mockRejectedValue(
    Object.assign(new Error("provider unavailable"), { status: 503 }),
  );
  try {
    const response = await POST(
      new Request("http://local/api/agent", {
        method: "POST",
        body: JSON.stringify({
          operation: "collect",
          question: "도와줘",
          household: {},
          solutions: none,
        }),
      }),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    const body = await response.json();
    expect(body.code).toBe("provider_unavailable");
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get("X-Request-Id")).toBe(body.requestId);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(log).toHaveBeenCalledWith(
      "Young Planner AI request failed",
      expect.objectContaining({
        requestId: body.requestId,
        elapsedMs: expect.any(Number),
        status: 503,
      }),
    );
    expect(JSON.stringify(body)).not.toContain("provider unavailable");
    expect(create).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});

it("uses Gemini backup after Groq input collection is overloaded", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini");
  vi.stubEnv("GEMINI_MODEL", "primary-groq-routing-test");
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create.mockRejectedValueOnce({ status: 503 }).mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "월 생활비도 알려주세요.",
            patch: { assets: 6000 },
          }),
        },
      },
    ],
  });
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const response = await POST(
      new Request("http://local/api/agent", {
        method: "POST",
        headers: { "x-forwarded-for": "router-groq-test" },
        body: JSON.stringify({
          operation: "collect",
          question: "예금 6천",
          household: {},
          solutions: none,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(create.mock.calls.map((c) => c[0].model)).toEqual([
      "openai/gpt-oss-120b",
      "gemini-3.1-flash-lite",
    ]);
    expect(create.mock.calls[0][0].parallel_tool_calls).toBe(false);
    expect((await response.json()).intake.patch).toEqual({ assets: 6000 });
  } finally {
    log.mockRestore();
  }
});

it("recovers from the production json_validate_failed error using the backup model", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini");
  vi.stubEnv("GEMINI_MODEL", "test-gemini-model");
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create
    .mockRejectedValueOnce({ status: 400, code: "json_validate_failed" })
    .mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "확인했어요.",
              patch: { assets: 6000, loan: 0, spouseBirth: null },
            }),
          },
        },
      ],
    });
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const response = await POST(
      new Request("http://local/api/agent", {
        method: "POST",
        headers: { "x-forwarded-for": "json-generation-recovery-test" },
        body: JSON.stringify({
          operation: "collect",
          question: "가상 가구 예금 6천 대출없음",
          household: {},
          solutions: none,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(create.mock.calls.map((c) => c[0].model)).toEqual([
      "openai/gpt-oss-20b",
      "gemini-3.1-flash-lite",
    ]);
    expect(create.mock.calls[0][0].response_format.type).toBe("json_schema");
    expect((await response.json()).intake.patch).toEqual({
      assets: 6000,
      loan: 0,
    });
  } finally {
    log.mockRestore();
  }
});

it("converts Groq's sparse field list to the existing input card", async () => {
  vi.stubEnv("GROQ_API_KEY", "test-groq");
  vi.stubEnv("GROQ_MODEL", "test-field-list");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            answer: "확인했어요.",
            patch: [
              { field: "loan", value: 0 },
              { field: "assets", value: 6000 },
              { field: "assets", value: 5000 },
              { field: "birth", value: "1968" },
            ],
          }),
        },
      },
    ],
  });
  const response = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      headers: { "x-forwarded-for": "groq-field-list" },
      body: JSON.stringify({
        operation: "collect",
        question: "가상 입력",
        household: {},
        solutions: none,
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).intake.patch).toEqual({ loan: 0 });
});

it("continues asking after a confirmation-only model reply and skips spouse questions for single households", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini");
  vi.stubEnv("GEMINI_MODEL", "test-guided-intake");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "본인 출생연월을 확인했어요.",
              patch: { birth: "1970-02" },
            }),
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "배우자 정보를 알려주세요.",
              patch: { spouseBirth: "없음" },
            }),
          },
        },
      ],
    });
  const send = async (question: string, household: Record<string, unknown>) => {
    const response = await POST(
      new Request("http://local/api/agent", {
        method: "POST",
        headers: { "x-forwarded-for": "guided-intake-test" },
        body: JSON.stringify({
          operation: "collect",
          question,
          household,
          solutions: none,
        }),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const birth = await send("1970 02", {});
  expect(birth.answer).toContain("은퇴 예정월은 언제인가요?");
  const single = await send("결혼 안함", {
    ...birth.intake.patch,
    retire: "2028-12",
  });
  expect(single.intake.patch).toEqual({ hasSpouse: false });
  expect(single.answer).toContain("현재 세후 월급");
  expect(single.answer).not.toContain("배우자");
});
