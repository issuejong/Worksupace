import { it, expect, vi } from "vitest";
import OpenAI from "openai";
import { runAgent } from "../src/lib/agent/run";
import { defaults } from "../src/lib/finance";
const tool = (name: string, args: unknown) => ({
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call1",
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
    },
  ],
});
it("iterates across analysis tools without changing configuration", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(tool("search_scenarios", {}))
    .mockResolvedValueOnce(tool("stress_test", {}))
    .mockResolvedValueOnce({
      choices: [{ message: { role: "assistant", content: "분석 결과" } }],
    });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  const r = await runAgent(
    client,
    "test",
    "최대 자산 찾아줘",
    defaults,
    [],
    new AbortController().signal,
  );
  expect(r.analyses).toHaveLength(2);
  expect(r.config).toEqual(defaults);
  expect(create).toHaveBeenCalledTimes(3);
});
it("applies only an explicit change request", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(
      tool("apply_scenario_changes", {
        changes: { benefits: false, living: 280 },
      }),
    )
    .mockResolvedValueOnce({
      choices: [{ message: { role: "assistant", content: "변경했습니다" } }],
    });
  const r = await runAgent(
    { chat: { completions: { create } } } as unknown as OpenAI,
    "test",
    "구직급여 없이 생활비 280으로 바꿔줘",
    defaults,
    [],
    new AbortController().signal,
  );
  expect(r.config.benefits).toBe(false);
  expect(r.config.living).toBe(280);
});
it("keeps completed calculations when follow-up model call fails", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(tool("search_scenarios", {}))
    .mockRejectedValueOnce(new Error("timeout"));
  const r = await runAgent(
    { chat: { completions: { create } } } as unknown as OpenAI,
    "test",
    "최대",
    defaults,
    [],
    new AbortController().signal,
  );
  expect(r.incomplete).toBe(true);
  expect(r.analyses).toHaveLength(1);
  expect(r.config).toEqual(defaults);
});
it("passes candidate conditions for follow-up questions and reuses no old metrics", async () => {
  const create = vi
    .fn()
    .mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "확인 질문" } }],
    });
  await runAgent(
    { chat: { completions: { create } } } as unknown as OpenAI,
    "test",
    "그 후보는?",
    defaults,
    [],
    new AbortController().signal,
    [{ name: "후보 1", config: { ...defaults, catchup: false } }],
  );
  expect(create.mock.calls[0][0].messages[0].content).toContain(
    '"catchup":false',
  );
});
it("blocks automatic changes during analysis", async () => {
  const create = vi
    .fn()
    .mockResolvedValueOnce(
      tool("apply_scenario_changes", { changes: { benefits: false } }),
    )
    .mockResolvedValueOnce({
      choices: [{ message: { role: "assistant", content: "비교만 합니다" } }],
    });
  const r = await runAgent(
    { chat: { completions: { create } } } as unknown as OpenAI,
    "test",
    "구직급여 없이 비교해줘",
    defaults,
    [],
    new AbortController().signal,
  );
  expect(r.config).toEqual(defaults);
  expect(r.trace[0].status).toBe("error");
});
