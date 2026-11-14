import { afterEach, expect, it, vi } from "vitest";
import OpenAI from "openai";
import {
  executeHouseholdTool,
  runHouseholdAgent,
} from "../src/lib/household-agent";
import { example, adopted, none, calculate, fmt } from "../src/lib/household";
import { POST } from "../src/app/api/agent/route";
afterEach(() => vi.unstubAllEnvs());
it("looks up actual monthly components in the requested before scenario", () => {
  const r = executeHouseholdTool(
    "inspect",
    { month: "2031-02", before: true },
    example,
    adopted,
  );
  expect(r.data).toMatchObject({
    month: { date: "2031-02" },
    metrics: { firstNegative: "2031-02" },
  });
});
it("calculates custom household and plan changes without mutating inputs", () => {
  const r = executeHouseholdTool(
    "compare",
    {
      candidates: [
        {
          name: "재취업 없음",
          household: { living: 280 },
          plan: { job: false },
        },
      ],
    },
    example,
    adopted,
  );
  expect(r.candidates[0].metrics.minAssets).toBe(
    calculate({ ...example, living: 280 }, { ...adopted, job: false })
      .minAssets,
  );
  expect(example.living).toBe(250);
  expect(adopted.job).toBe(true);
  expect(() =>
    executeHouseholdTool(
      "compare",
      { candidates: [{ name: "오류", household: { living: -1 }, plan: {} }] },
      example,
      adopted,
    ),
  ).toThrow();
});
it("searches benefits and catchup too while honoring explicit locks", () => {
  const h = { ...example, endYear: 2028 };
  const r = executeHouseholdTool(
    "search",
    {
      goal: "endAssets",
      locks: { home: false, pensionOffset: 0, job: false, repay: false },
      avoidShortfall: false,
    },
    h,
    none,
  );
  expect(r.candidates[0].plan.benefits).toBe(true);
  expect(r.candidates[0].plan.catchup).toBe(false);
  expect(
    r.candidates.every(
      (c) =>
        !c.plan.home &&
        !c.plan.job &&
        !c.plan.repay &&
        c.plan.pensionOffset === 0,
    ),
  ).toBe(true);
  expect(r.searched).toBe(4);
});
const tool = (name: string, args: unknown) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
    },
  ],
});
const input = {
  question: "재취업 없이 비교해 줘",
  household: example,
  solutions: adopted,
  history: [],
};
it("runs tool calls and returns calculated proposals rather than silently applying", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(
      tool("compare", {
        candidates: [
          { name: "재취업 없음", household: {}, plan: { job: false } },
        ],
      }),
    )
    .mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: "재취업을 빼면 자산 흐름이 달라져요.",
          },
        },
      ],
    });
  const r = await runHouseholdAgent(
    { chat: { completions: { create } } } as unknown as OpenAI,
    "test",
    input,
    new AbortController().signal,
  );
  expect(r.tools).toEqual(["compare"]);
  expect(r.candidates[0].plan.job).toBe(false);
  expect(adopted.job).toBe(true);
  expect(create.mock.calls[0][0].tool_choice).toBe("required");
});
it("does not hide provider errors with a calculation-only fallback", async () => {
  const create = vi.fn().mockRejectedValue(new Error("offline"));
  await expect(
    runHouseholdAgent(
      { chat: { completions: { create } } } as unknown as OpenAI,
      "test",
      input,
      new AbortController().signal,
    ),
  ).rejects.toThrow("offline");
});
it("does not call an unsearched result optimal", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(tool("inspect", {}))
    .mockResolvedValueOnce({
      choices: [{ message: { role: "assistant", content: "최대입니다" } }],
    });
  await expect(
    runHouseholdAgent(
      { chat: { completions: { create } } } as unknown as OpenAI,
      "test",
      { ...input, question: "가장 많이 남는 안" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("탐색");
});
it("returns 503, no fake agent answer, when model credentials are missing", async () => {
  for (const name of [
    "GEMINI_API_KEY",
    "GEMINI_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
  ])
    vi.stubEnv(name, "");
  const r = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  expect(r.status).toBe(503);
  const body = await r.json();
  expect(body.error).toContain("연결");
  expect(body.answer).toBeUndefined();
});
it("rejects invalid payloads before reaching a provider", async () => {
  const r = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      body: JSON.stringify({ ...input, household: { ...example, living: -1 } }),
    }),
  );
  expect(r.status).toBe(400);
});
it("rounds display only and keeps engine precision", () => {
  expect(fmt(3616.55185834155)).toBe("3,616.6");
  expect(fmt(2.7918)).toBe("2.8");
  expect(calculate(example, adopted).minAssets).toBeCloseTo(
    3558.62969139837,
    6,
  );
});

it("preserves configured endpoint access protection", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "fake-test-key");
  vi.stubEnv("OPENAI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "local-test-token");
  const response = await POST(
    new Request("http://local/api/agent", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
  expect(response.status).toBe(401);
});

it("keeps the existing plan month and returns exact comparison amounts", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(
      tool("compare", {
        candidates: [
          {
            name: "재취업 월급 150만 원",
            household: { jobIncome: 150 },
            plan: {},
          },
          { name: "같은 조건", household: { jobIncome: 150 }, plan: {} },
        ],
      }),
    )
    .mockResolvedValueOnce({
      choices: [{ message: { role: "assistant", content: "임의 금액 123원" } }],
    });
  const reply = await runHouseholdAgent(
    { chat: { completions: { create } } } as unknown as OpenAI,
    "test",
    input,
    new AbortController().signal,
  );
  expect(reply.candidates).toHaveLength(1);
  expect(reply.answer).toContain("87,430,654원");
  expect(reply.answer).toContain("48,018,753원");
  expect(reply.answer).not.toContain("123원");
  const result = executeHouseholdTool(
    "compare",
    {
      candidates: [{ name: "재취업", household: { jobIncome: 150 }, plan: {} }],
    },
    example,
    { ...adopted, homeMonth: 7 },
  );
  expect(result.candidates[0].plan.homeMonth).toBe(7);
});
