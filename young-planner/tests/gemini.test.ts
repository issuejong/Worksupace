import { it, expect, vi, afterEach } from "vitest";
import OpenAI from "openai";
import { POST } from "../src/app/api/ai/route";
import { defaults } from "../src/lib/finance";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("runs Gemini tool changes through the calculation engine", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "gemini-3.5-flash-lite");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  const create = vi.spyOn(OpenAI.Chat.Completions.prototype, "create");
  create.mockResolvedValueOnce({
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call1",
              type: "function",
              function: {
                name: "simulate_scenario",
                arguments: '{"living":280}',
              },
            },
          ],
        },
      },
    ],
  } as never);
  create.mockResolvedValueOnce({
    choices: [
      {
        message: {
          role: "assistant",
          content: "월 생활비 280만 원으로 계산했습니다.",
        },
      },
    ],
  } as never);
  const response = await POST(
    new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ question: "생활비 280만 원", config: defaults }),
    }),
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.config.living).toBe(280);
  expect(body.comparison.changes).toEqual({ living: 280 });
  expect(body.model).toBe("gemini-3.5-flash-lite");
  expect(create).toHaveBeenCalledTimes(2);
  const second = create.mock.calls[1][0] as {
    messages: { role: string; content?: string }[];
  };
  expect(second.messages.at(-1)?.role).toBe("tool");
  expect(JSON.parse(second.messages.at(-1)!.content!).after.endAssets).toBe(
    body.comparison.after.endAssets,
  );
});
