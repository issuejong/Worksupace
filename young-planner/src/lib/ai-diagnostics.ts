const MAX_BODY_BYTES = 8192;

export function privateFragments(value: unknown): string[] {
  if (typeof value === "string")
    return [
      value,
      ...value
        .split(/[\s,.:;!?"'{}\[\]]+/)
        .filter((v) => v.length >= 2 && !/^\d+$/.test(v)),
    ];
  if (typeof value === "number") return [];
  if (Array.isArray(value)) return value.flatMap(privateFragments);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(privateFragments);
  return [];
}

export function redactDiagnostic(value: unknown, privateValues: string[] = []) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  let text = String(value);
  for (const secret of privateValues
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    text = text.split(secret).join("[REDACTED]");
  return text
    .replace(/Bearer\s+[^\s"<>]+/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .slice(0, 800);
}

async function limitedBody(response: Response) {
  const reader = response.clone().body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };
  const chunks: Uint8Array[] = [];
  let bytes = 0,
    truncated = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const room = MAX_BODY_BYTES - bytes;
      chunks.push(chunk.value.slice(0, room));
      bytes += Math.min(chunk.value.length, room);
      if (chunk.value.length > room || bytes === MAX_BODY_BYTES) {
        truncated = true;
        break;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(data), bytes, truncated };
}

export async function describeProviderResponse(
  response: Response,
  privateValues: string[] = [],
) {
  const headers: Record<string, string> = {};
  for (const key of [
    "content-type",
    "retry-after",
    "x-request-id",
    "x-goog-request-id",
    "request-id",
  ])
    if (response.headers.has(key))
      headers[key] =
        redactDiagnostic(response.headers.get(key), privateValues) || "";
  const base = { status: response.status, headers };
  try {
    const body = await limitedBody(response);
    if (!body.bytes) return { ...base, bodyKind: "empty", capturedBytes: 0 };
    if (body.truncated)
      return { ...base, bodyKind: "truncated", capturedBytes: body.bytes };
    let parsed;
    try {
      parsed = JSON.parse(body.text);
    } catch {
      return { ...base, bodyKind: "text", capturedBytes: body.bytes };
    }
    const error =
      parsed && typeof parsed === "object" ? parsed.error || parsed : {};
    return {
      ...base,
      bodyKind: "json",
      capturedBytes: body.bytes,
      error: {
        code: redactDiagnostic(error.code, privateValues),
        type: redactDiagnostic(error.type, privateValues),
        status: redactDiagnostic(error.status, privateValues),
        message: redactDiagnostic(error.message, privateValues)?.replace(
          /\d+(?:[.,]\d+)*/g,
          "[NUMBER]",
        ),
      },
    };
  } catch {
    return { ...base, bodyKind: "unreadable" };
  }
}

export function diagnosticFetch(
  record: (
    diagnostic: Awaited<ReturnType<typeof describeProviderResponse>> & {
      attempt: number;
      elapsedMs: number;
    },
  ) => void,
  privateValues: string[],
  fetcher: typeof fetch = fetch,
): typeof fetch {
  let attempt = 0;
  return async (input, init) => {
    const started = Date.now();
    const currentAttempt = ++attempt;
    const response = await fetcher(input, init);
    if (!response.ok) {
      // Keep the provider's original response intact for the SDK and retry policy.
      const diagnostic = await describeProviderResponse(
        response,
        privateValues,
      );
      record({
        ...diagnostic,
        attempt: currentAttempt,
        elapsedMs: Date.now() - started,
      });
    }
    return response;
  };
}
