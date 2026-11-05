import { beforeEach, describe, it, expect, vi } from "vitest";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));
import { POST } from "../src/app/api/explain/route";
import { example, adopted } from "../src/lib/household";
const request = (question = "현재 안을 설명해줘") =>
  new Request("http://local/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, household: example, solutions: adopted }),
  });
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_MODEL", "");
  create.mockReset();
});
describe("explanation endpoint", () => {
  it("works without an API key and explains baseline when requested", async () => {
    const r = await POST(request("설계 전은 왜 2031년 2월에 부족해지나요?"));
    const j = await r.json();
    expect(j.source).toBe("engine");
    expect(j.answer).toContain("2031-02");
    expect(j.answer).toContain("29,399");
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects incomplete household data", async () => {
    const r = await POST(
      new Request("http://local/api/explain", { method: "POST", body: "{}" }),
    );
    expect(r.status).toBe(400);
  });
  it("discards AI invented numeric statements", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("OPENAI_MODEL", "test");
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              blocks: [
                { text: "최저 자산은 999999만원입니다", refs: ["minAssets"] },
              ],
            }),
          },
        },
      ],
    });
    const j = await (await POST(request())).json();
    expect(j.source).toBe("engine");
    expect(j.answer).not.toContain("999999");
  });
  it("renders numeric facts from engine references", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("OPENAI_MODEL", "test");
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              blocks: [
                { text: "현재 가정에서 자산이 남습니다.", refs: ["minAssets"] },
              ],
            }),
          },
        },
      ],
    });
    const j = await (await POST(request())).json();
    expect(j.source).toBe("ai-facts");
    expect(j.answer).toContain("3,617");
    expect(create.mock.calls[0][0].messages[1].content).not.toContain(
      "1967-01",
    );
  });
});
