import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { hostRoute, storageClient } from "../../../lib/server/auth";
import { db } from "../../../lib/server/db";
import { AppError } from "../../../lib/server/errors";

export const runtime = "nodejs";
function detect(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
export async function POST(request: NextRequest) {
  return hostRoute(request, async () => {
    if (Number(request.headers.get("content-length") ?? 0) > 6 * 1024 * 1024) throw new AppError("업로드 크기가 너무 큽니다.", 413);
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new AppError("이미지를 선택해 주세요.");
    if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new AppError("이미지는 5MB 이하로 올려 주세요.");
    const data = new Uint8Array(await file.arrayBuffer());
    const kind = detect(data);
    if (!kind || file.type !== kind.mime) throw new AppError("PNG, JPEG, WebP 이미지만 올릴 수 있습니다.");
    const id = randomUUID();
    const path = `${id}.${kind.ext}`;
    const uploaded = await storageClient().storage.from("quiz-media").upload(path, data, { contentType: kind.mime, upsert: false });
    if (uploaded.error) throw new AppError("이미지 저장에 실패했습니다.", 502);
    await db()`insert into public.media(id,storage_path,content_type) values (${id},${path},${kind.mime})`;
    return { id, url: `/api/media/${id}` };
  });
}
