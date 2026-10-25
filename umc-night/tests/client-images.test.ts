import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("in-memory question photo preparation", () => {
  const path = "/api/media/11111111-1111-4111-8111-111111111111";
  const blob = () => new Blob(["photo"], { type: "image/png" });
  let decode: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    decode = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("Image", class { src = ""; decode = decode; });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(blob())));
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("decodes before publishing a photo, reuses it and deduplicates parallel loads", async () => {
    const { prepareImage, preparedImage } = await import("../lib/client-images");
    const [a, b] = await Promise.all([prepareImage(path), prepareImage(path)]);
    expect(a).toBe(b); expect(a?.src).toMatch(/^blob:/);
    expect(fetch).toHaveBeenCalledTimes(1); expect(decode).toHaveBeenCalledTimes(1);
    expect(preparedImage(path)).toBe(a); expect(await prepareImage(path)).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts the same-browser host's blob without another private media download", async () => {
    const { prepareImage, imageReadyEvent } = await import("../lib/client-images");
    const ready = vi.fn(); window.addEventListener(imageReadyEvent, ready);
    expect(await prepareImage(path, blob())).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled(); expect(ready).toHaveBeenCalledTimes(1);
  });
  it("does not fetch arbitrary URLs", async () => {
    const { prepareImage } = await import("../lib/client-images");
    expect(await prepareImage("https://other.example/photo.png")).toBeNull();
    expect(await prepareImage("/api/admin/setup")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects invalid blobs without poisoning a later retry", async () => {
    const { prepareImage } = await import("../lib/client-images");
    expect(await prepareImage(path, new Blob(["invalid"], { type: "text/html" }))).toBeNull();
    expect(await prepareImage(path, blob())).not.toBeNull();
  });
  it("revokes failed decodes and allows retry after loading errors", async () => {
    const { prepareImage, preparedImage } = await import("../lib/client-images");
    decode.mockRejectedValueOnce(new Error("bad photo"));
    expect(await prepareImage(path)).toBeNull(); expect(preparedImage(path)).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(await prepareImage(path)).not.toBeNull();
  });
  it("bounds the memory cache and releases old object URLs", async () => {
    const { prepareImage, preparedImage } = await import("../lib/client-images");
    for (let i = 1; i <= 7; i++) await prepareImage(`/api/media/${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, blob());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(preparedImage("/api/media/00000001-1111-4111-8111-111111111111")).toBeUndefined();
    expect(preparedImage("/api/media/00000007-1111-4111-8111-111111111111")).toBeDefined();
  });
});
