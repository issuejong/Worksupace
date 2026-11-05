import { expect, it, vi } from "vitest";
import {
  describeProviderResponse,
  diagnosticFetch,
} from "../src/lib/ai-diagnostics";

it("captures allowlisted JSON error details and removes secrets and customer text", async () => {
  const secret = "secret-test-key";
  const question = "private-customer-question";
  const response = new Response(
    JSON.stringify({
      error: {
        code: "UNAVAILABLE",
        type: "capacity",
        message: `Busy ${secret} ${question}`,
        payload: question,
      },
      request: { prompt: question },
    }),
    {
      status: 503,
      headers: {
        "x-request-id": "provider-123",
        "retry-after": "5",
        "set-cookie": secret,
        authorization: secret,
      },
    },
  );
  const result = await describeProviderResponse(response, [secret, question]);
  expect(result).toMatchObject({
    status: 503,
    bodyKind: "json",
    error: {
      code: "UNAVAILABLE",
      type: "capacity",
      message: "Busy [REDACTED] [REDACTED]",
    },
  });
  expect(result.headers).toMatchObject({
    "x-request-id": "provider-123",
    "retry-after": "5",
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain(question);
  expect(JSON.stringify(result)).not.toContain("set-cookie");
  expect(JSON.stringify(result)).not.toContain("payload");
});

it("distinguishes an empty 503 body from a text response without logging raw text", async () => {
  expect(
    await describeProviderResponse(new Response(null, { status: 503 })),
  ).toMatchObject({ bodyKind: "empty", capturedBytes: 0 });
  const result = await describeProviderResponse(
    new Response("<html>private-error-detail</html>", { status: 503 }),
  );
  expect(result).toMatchObject({ bodyKind: "text" });
  expect(JSON.stringify(result)).not.toContain("private-error-detail");
});

it("caps captured bodies at 8 KiB", async () => {
  const result = await describeProviderResponse(
    new Response("x".repeat(16000), { status: 502 }),
  );
  expect(result).toMatchObject({ bodyKind: "truncated", capturedBytes: 8192 });
});

it("keeps the original provider response readable by the SDK", async () => {
  const record = vi.fn();
  const body = JSON.stringify({ error: { message: "Unavailable" } });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(body, { status: 503 }));
  const response = await diagnosticFetch(
    record,
    [],
    fetcher,
  )("https://example.test");
  expect(await response.text()).toBe(body);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      attempt: 1,
      status: 503,
      bodyKind: "json",
      elapsedMs: expect.any(Number),
    }),
  );
});

it("does not read or record successful generated content", async () => {
  const record = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("private-answer", { status: 200 }));
  const response = await diagnosticFetch(
    record,
    [],
    fetcher,
  )("https://example.test");
  expect(record).not.toHaveBeenCalled();
  expect(await response.text()).toBe("private-answer");
});
