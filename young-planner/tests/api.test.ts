import { it, expect, vi, afterEach } from "vitest";
import { POST } from "../src/app/api/ai/route";
afterEach(() => vi.unstubAllEnvs());
it("reports missing configuration without making an API call", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("OPENAI_MODEL", "");
  const r = await POST(
    new Request("http://localhost/api/ai", { method: "POST" }),
  );
  expect(r.status).toBe(503);
});
it("rejects unauthorized AI access before processing the question", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test");
  vi.stubEnv("OPENAI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "required");
  const r = await POST(
    new Request("http://localhost/api/ai", { method: "POST" }),
  );
  expect(r.status).toBe(401);
});
it("rejects invalid inputs without contacting OpenAI", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test");
  vi.stubEnv("OPENAI_MODEL", "test");
  vi.stubEnv("AI_ACCESS_TOKEN", "");
  const r = await POST(
    new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ question: "x", config: {} }),
    }),
  );
  expect(r.status).toBe(400);
});
