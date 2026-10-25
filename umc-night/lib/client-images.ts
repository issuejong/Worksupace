interface PreparedImage { path: string; blob: Blob; src: string; }
const images = new Map<string, PreparedImage>();
const pending = new Map<string, Promise<PreparedImage | null>>();
export const imageReadyEvent = "umc-night:image-ready";

export function preparedImage(path: string) { return images.get(path); }

export function prepareImage(path: string, provided?: Blob): Promise<PreparedImage | null> {
  if (!/^\/api\/media\/[0-9a-f-]{36}$/.test(path)) return Promise.resolve(null);
  const cached = images.get(path);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;
  const task = (async () => {
    let src: string | undefined;
    try {
      let blob = provided;
      if (!blob) {
        const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return null;
        blob = await response.blob();
      }
      if (!blob.size || blob.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(blob.type)) return null;
      src = URL.createObjectURL(blob);
      const image = new Image(); image.src = src;
      await image.decode();
      const result = { path, blob, src };
      images.set(path, result);
      while (images.size > 6) {
        const oldest = images.keys().next().value!;
        URL.revokeObjectURL(images.get(oldest)!.src); images.delete(oldest);
      }
      window.dispatchEvent(new CustomEvent(imageReadyEvent, { detail: path }));
      return result;
    } catch {
      if (src) URL.revokeObjectURL(src);
      return null;
    }
  })();
  pending.set(path, task);
  void task.finally(() => pending.delete(path));
  return task;
}
