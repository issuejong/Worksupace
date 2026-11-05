import { setTimeout as delay } from "node:timers/promises";

export function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return;
  return typeof error.status === "number" ? error.status : undefined;
}

// One retry per provider call; the request's shared deadline still bounds all rounds.
export async function withTransientRetry<T>(
  request: () => PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  try {
    return await request();
  } catch (error) {
    const status = providerStatus(error);
    if (
      signal.aborted ||
      !status ||
      ![408, 500, 502, 503, 504].includes(status)
    )
      throw error;
    await delay(750 + Math.floor(Math.random() * 500), undefined, { signal });
    signal.throwIfAborted();
    return await request();
  }
}
