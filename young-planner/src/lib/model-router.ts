import type OpenAI from "openai";
import { providerStatus } from "./ai-reliability";

type Params = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
type Reply = OpenAI.Chat.Completions.ChatCompletion;
export type Completion = (params: Params) => Promise<Reply>;
const cooldowns = new Map<string, number>();
export type ModelTarget = {
  provider: string;
  model: string;
  request: (params: Params, signal: AbortSignal) => PromiseLike<Reply>;
};

export function createModelRouter(options: {
  targets: ModelTarget[];
  signal: AbortSignal;
  timeoutMs: number;
  onAttempt?: (target: ModelTarget) => void;
  onSwitch?: (event: {
    from: string;
    to: string;
    toProvider: string;
    reason: string;
  }) => void;
  health?: Map<string, number>;
}) {
  const targets = options.targets
    .filter(
      (target, i, all) =>
        all.findIndex(
          (t) => t.provider === target.provider && t.model === target.model,
        ) === i,
    )
    .slice(0, 2);
  const models = targets.map((t) => `${t.provider}:${t.model}`);
  const health = options.health || cooldowns;
  if (health.size > 32) health.clear();
  let index = 0,
    fallbackUsed = false;
  if (
    models.length > 1 &&
    (health.get(models[0]) || 0) > Date.now() &&
    (health.get(models[1]) || 0) <= Date.now()
  ) {
    index = 1;
    fallbackUsed = true;
    options.onSwitch?.({
      from: targets[0].model,
      to: targets[1].model,
      toProvider: targets[1].provider,
      reason: "cooldown",
    });
  }
  const complete: Completion = async (params) => {
    options.signal.throwIfAborted();
    for (; index < models.length; index++) {
      const target = targets[index],
        model = models[index];
      options.onAttempt?.(target);
      const deadline = AbortSignal.timeout(options.timeoutMs);
      const signal = AbortSignal.any([options.signal, deadline]);
      try {
        const reply = await target.request(
          { ...params, model: target.model },
          signal,
        );
        options.signal.throwIfAborted();
        health.delete(model);
        return reply;
      } catch (error) {
        options.signal.throwIfAborted();
        const status = providerStatus(error);
        const independentQuota =
          status === 429 &&
          index + 1 < targets.length &&
          target.provider !== targets[index + 1].provider;
        const transient =
          independentQuota ||
          deadline.aborted ||
          [408, 500, 502, 503, 504].includes(status || 0);
        if (!transient) throw error;
        health.set(model, Date.now() + (status === 429 ? 60000 : 30000));
        if (index + 1 >= models.length) {
          if (deadline.aborted)
            throw new DOMException(
              "AI model response deadline exceeded",
              "TimeoutError",
            );
          throw error;
        }
        fallbackUsed = true;
        options.onSwitch?.({
          from: target.model,
          to: targets[index + 1].model,
          toProvider: targets[index + 1].provider,
          reason: deadline.aborted ? "timeout" : `http_${status}`,
        });
      }
    }
    throw Error("No AI model is available");
  };
  return {
    complete,
    get fallbackUsed() {
      return fallbackUsed;
    },
  };
}

export function groqParameters(params: Params): Params {
  return {
    ...params,
    parallel_tool_calls: false,
    max_tokens: Math.min(params.max_tokens || 1000, 1000),
    ...(params.model.includes("gpt-oss")
      ? { reasoning_effort: "low" as const }
      : {}),
    messages: params.messages.map((message) =>
      message.role === "assistant"
        ? {
            role: "assistant" as const,
            content: message.content,
            ...(message.tool_calls
              ? {
                  tool_calls: message.tool_calls
                    .filter((call) => call.type === "function")
                    .map((call) => ({
                      id: call.id,
                      type: "function" as const,
                      function: {
                        name: call.function.name,
                        arguments: call.function.arguments,
                      },
                    })),
                }
              : {}),
          }
        : message,
    ),
  };
}
