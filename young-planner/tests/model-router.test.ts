import { expect, it, vi } from "vitest";
import {
  createModelRouter,
  groqParameters,
  type ModelTarget,
} from "../src/lib/model-router";
import type OpenAI from "openai";
const reply = {
  choices: [{ message: { role: "assistant", content: "ok" } }],
} as OpenAI.Chat.Completions.ChatCompletion;
const params = {
  model: "ignored",
  messages: [{ role: "user" as const, content: "test" }],
};
function setup(
  first = vi.fn().mockResolvedValue(reply),
  second = vi.fn().mockResolvedValue(reply),
  health = new Map<string, number>(),
) {
  const targets: ModelTarget[] = [
    { provider: "gemini", model: "primary", request: first },
    { provider: "groq", model: "backup", request: second },
  ];
  const switched = vi.fn();
  return {
    first,
    second,
    targets,
    switched,
    router: createModelRouter({
      targets,
      timeoutMs: 1000,
      signal: new AbortController().signal,
      health,
      onSwitch: switched,
    }),
  };
}
it("only uses the primary model when healthy", async () => {
  const x = setup();
  await x.router.complete(params);
  expect(x.first).toHaveBeenCalledWith(
    expect.objectContaining({ model: "primary" }),
    expect.any(AbortSignal),
  );
  expect(x.second).not.toHaveBeenCalled();
});
it("switches providers after a 503 and stays with the successful fallback for tool rounds", async () => {
  const x = setup(vi.fn().mockRejectedValue({ status: 503 }));
  await x.router.complete(params);
  await x.router.complete(params);
  expect(x.first).toHaveBeenCalledTimes(1);
  expect(x.second).toHaveBeenCalledTimes(2);
  expect(x.switched).toHaveBeenCalledWith({
    from: "primary",
    to: "backup",
    toProvider: "groq",
    reason: "http_503",
  });
});
it.each([400, 401, 403])(
  "does not mask a %i with another model",
  async (status) => {
    const x = setup(vi.fn().mockRejectedValue({ status }));
    await expect(x.router.complete(params)).rejects.toEqual({ status });
    expect(x.second).not.toHaveBeenCalled();
  },
);
it("caps failed attempts at one per target", async () => {
  const x = setup(
    vi.fn().mockRejectedValue({ status: 503 }),
    vi.fn().mockRejectedValue({ status: 503 }),
  );
  await expect(x.router.complete(params)).rejects.toEqual({ status: 503 });
  expect(x.first).toHaveBeenCalledTimes(1);
  expect(x.second).toHaveBeenCalledTimes(1);
});
it("skips a recently overloaded primary on another request", async () => {
  const health = new Map<string, number>();
  const x = setup(
    vi.fn().mockRejectedValue({ status: 503 }),
    vi.fn().mockResolvedValue(reply),
    health,
  );
  await x.router.complete(params);
  const y = setup(
    vi.fn().mockResolvedValue(reply),
    vi.fn().mockResolvedValue(reply),
    health,
  );
  await y.router.complete(params);
  expect(y.first).not.toHaveBeenCalled();
  expect(y.switched).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "cooldown" }),
  );
});
it("tries the primary again when the cooldown expires", async () => {
  const x = setup(
    undefined,
    undefined,
    new Map([["gemini:primary", Date.now() - 1000]]),
  );
  await x.router.complete(params);
  expect(x.first).toHaveBeenCalledTimes(1);
});
it("switches after a per-model deadline without waiting for the whole request deadline", async () => {
  const first = vi.fn(
    (_params, signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        ),
      ),
  );
  const x = setup(first);
  const router = createModelRouter({
    targets: x.targets,
    signal: new AbortController().signal,
    timeoutMs: 15,
    health: new Map(),
    onSwitch: x.switched,
  });
  expect(await router.complete(params)).toBe(reply);
  expect(x.switched).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "timeout" }),
  );
});
it("does not send a fallback request after user cancellation", async () => {
  const controller = new AbortController();
  const x = setup(
    vi.fn().mockImplementation(() => {
      controller.abort();
      throw { status: 503 };
    }),
  );
  const router = createModelRouter({
    targets: x.targets,
    signal: controller.signal,
    timeoutMs: 1000,
    health: new Map(),
  });
  await expect(router.complete(params)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(x.second).not.toHaveBeenCalled();
});

it("preserves tool calls but strips provider-specific assistant metadata for Groq", () => {
  const input = {
    model: "openai/gpt-oss-120b",
    max_tokens: 2200,
    messages: [
      {
        role: "assistant",
        content: null,
        extra_content: { google: { thought_signature: "private-signature" } },
        tool_calls: [
          {
            type: "function",
            id: "call-1",
            extra_content: {
              google: { thought_signature: "private-signature" },
            },
            function: { name: "inspect", arguments: "{}" },
          },
        ],
      },
    ],
  } as unknown as Parameters<typeof groqParameters>[0];
  const output = groqParameters(input);
  expect(output).toMatchObject({
    parallel_tool_calls: false,
    max_tokens: 1000,
    reasoning_effort: "low",
  });
  expect(JSON.stringify(output)).not.toContain("private-signature");
  expect(output.messages[0]).toMatchObject({
    tool_calls: [
      { id: "call-1", function: { name: "inspect", arguments: "{}" } },
    ],
  });
});

it("uses an independent provider on a provider quota error", async () => {
  const x = setup(vi.fn().mockRejectedValue({ status: 429 }));
  expect(await x.router.complete(params)).toBe(reply);
  expect(x.switched).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "http_429" }),
  );
});
it("does not retry another model within the same provider for quota errors", async () => {
  const x = setup(vi.fn().mockRejectedValue({ status: 429 }));
  x.targets[1].provider = "gemini";
  const router = createModelRouter({
    targets: x.targets,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    health: new Map(),
  });
  await expect(router.complete(params)).rejects.toEqual({ status: 429 });
  expect(x.second).not.toHaveBeenCalled();
});

it("switches providers for a JSON generation failure even when its HTTP status is 400", async () => {
  const x = setup(
    vi.fn().mockRejectedValue({ status: 400, code: "json_validate_failed" }),
  );
  expect(await x.router.complete(params)).toBe(reply);
  expect(x.switched).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "json_validate_failed" }),
  );
});

it("switches after an unusable successful response without returning it to the browser", async () => {
  const x = setup();
  const validate = vi.fn().mockImplementationOnce(() => {
    throw { code: "invalid_ai_response" };
  });
  const router = createModelRouter({
    targets: x.targets,
    signal: new AbortController().signal,
    timeoutMs: 1000,
    health: new Map(),
    validate,
  });
  expect(await router.complete(params)).toBe(reply);
  expect(x.second).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(2);
});

it("requests a strict list of extracted input fields from Groq without constraining tool analysis", () => {
  const collect = groqParameters({
    ...params,
    model: "openai/gpt-oss-120b",
    response_format: { type: "json_object" },
  });
  expect(collect.response_format).toMatchObject({
    type: "json_schema",
    json_schema: { strict: true, schema: { additionalProperties: false } },
  });
  if (collect.response_format?.type !== "json_schema")
    throw Error("strict schema missing");
  expect(collect.response_format.json_schema.schema).toMatchObject({
    properties: {
      patch: {
        type: "array",
        items: {
          required: ["field", "value"],
          properties: {
            field: { enum: expect.arrayContaining(["assets", "birth"]) },
          },
          additionalProperties: false,
        },
      },
    },
  });
  expect(
    groqParameters({
      ...params,
      tools: [
        {
          type: "function",
          function: { name: "inspect", parameters: { type: "object" } },
        },
      ],
    }).response_format,
  ).toBeUndefined();
});
