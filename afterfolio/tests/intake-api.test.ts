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
import { adopted, example, none } from "../src/lib/household";
afterEach(() => {
  vi.unstubAllEnvs();
  create.mockReset();
});

it("renders the engine's exact metrics even when the explanation model sends a wrong amount", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create.mockResolvedValue({
    choices: [{ message: { content: "최저 금융자산은 361.7만 원입니다." } }],
  });
  const response = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      headers: { "x-forwarded-for": "explanation-test" },
      body: JSON.stringify({
        operation: "explain",
        question: "내 결과를 설명해 주세요.",
        household: example,
        solutions: adopted,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const { answer } = await response.json();
  expect(answer).toContain("36,165,519원");
  expect(answer).toContain("2031년 2월");
  expect(answer).toContain("213,010,062원 부족");
  expect(answer).not.toContain("361.7만 원");
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
  const birth = await send("1970년 2월에 태어났어요", {});
  expect(birth.answer).toContain("은퇴 예정월은 언제인가요?");
  const single = await send("결혼 안함", {
    ...birth.intake.patch,
    retire: "2028-12",
  });
  expect(single.intake.patch).toEqual({ hasSpouse: false });
  expect(single.answer).toContain("현재 세후 월급");
  expect(single.answer).not.toContain("배우자");
});

it("accepts 20 requests, then returns the remaining cooldown without calling AI", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  create.mockResolvedValue({
    choices: [{ message: { content: '{"answer":"확인했어요.","patch":{}}' } }],
  });
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
  const send = () =>
    POST(
      new Request("http://local/api/agent", {
        method: "POST",
        headers: { "x-forwarded-for": "rate-limit-test" },
        body: JSON.stringify({
          operation: "collect",
          question: "확인",
          household: {},
          solutions: none,
        }),
      }),
    );
  try {
    for (let i = 0; i < 20; i++) expect((await send()).status).toBe(200);
    now.mockReturnValue(112_500);
    const blocked = await send();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("48");
    expect((await blocked.json()).code).toBe("request_rate_limit");
    expect(create).toHaveBeenCalledTimes(20);
    now.mockReturnValue(160_000);
    expect((await send()).status).toBe(200);
  } finally {
    now.mockRestore();
    log.mockRestore();
    error.mockRestore();
  }
});

it("uses zero for an explicit skip without a model and proceeds to the next question", async () => {
  for (const key of [
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "OPENAI_API_KEY",
    "AI_ACCESS_TOKEN",
  ])
    vi.stubEnv(key, "");
  const response = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      body: JSON.stringify({
        operation: "collect",
        question: "건너뛰기",
        household: {
          birth: "1970-01",
          retire: "2029-01",
          hasSpouse: false,
          income: 400,
          assets: 6000,
          loan: 0,
        },
        solutions: none,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.intake).toEqual({ patch: { living: 0 }, skipped: ["living"] });
  expect(body.answer).toContain("0원");
  expect(body.answer).toContain("퇴직금");
  expect(create).not.toHaveBeenCalled();
});

it("provides official lookup guidance for unknown amounts and only skips when requested", async () => {
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  const collect = async (
    question: string,
    household: Record<string, unknown>,
  ) => {
    const response = await POST(
      new Request("http://local/api/agent", {
        method: "POST",
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
  const unknownPension = await collect("국민연금은 아직 몰라요", {});
  expect(unknownPension.intake.patch).toEqual({});
  expect(unknownPension.answer).toContain("https://www.nps.or.kr/");
  const household = {
    birth: "1970-01",
    retire: "2029-01",
    hasSpouse: false,
    income: 400,
  };
  const unknownAssets = await collect("잘 모르겠어요", household);
  expect(unknownAssets.intake.patch).toEqual({});
  expect(unknownAssets.answer).toContain("https://www.payinfo.or.kr/");
  expect((await collect("국민연금 건너뛰기", {})).intake.patch).toEqual({
    pension: 0,
  });
  const unknownDate = await collect("모름", {});
  expect(unknownDate.intake.patch).toEqual({});
  expect(unknownDate.answer).toContain("은퇴 예정월");
  expect(
    (await collect("국민연금 건너뛰기", { pension: 150 })).intake.patch,
  ).toEqual({});
  expect(create).not.toHaveBeenCalled();
});

it("keeps the first retirement answer and moves from birth to spouse status", async () => {
  for (const key of [
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "OPENAI_API_KEY",
    "AI_ACCESS_TOKEN",
  ])
    vi.stubEnv(key, "");
  const send = async (
    question: string,
    household: Record<string, unknown> = {},
    previousReply?: string,
  ) => {
    const response = await POST(
      new Request("http://local/api/agent", {
        method: "POST",
        body: JSON.stringify({
          operation: "collect",
          question,
          household,
          solutions: none,
          history: previousReply
            ? [{ role: "assistant", content: previousReply }]
            : [],
        }),
      }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  const first = await send("28년 2월");
  expect(first.intake.patch).toEqual({ retire: "2028-02" });
  expect(first.answer).toContain("본인 출생연월은 언제인가요?");
  const second = await send("65년 9월", first.intake.patch, first.answer);
  expect(second.intake.patch).toEqual({ birth: "1965-09" });
  expect(second.answer).toContain("함께 계산할 배우자가 있나요?");
  expect(second.answer).not.toContain("은퇴 예정월은 언제인가요?");
  const legacy = await send("65년 9월", {}, first.answer);
  expect(legacy.intake.patch).toEqual({ birth: "1965-09" });
  const invalid = await send("65년 13월", first.intake.patch, first.answer);
  expect(invalid.intake.patch).toEqual({});
  expect(invalid.answer).toContain("본인 출생연월은 언제인가요?");
  expect(create).not.toHaveBeenCalled();
});
