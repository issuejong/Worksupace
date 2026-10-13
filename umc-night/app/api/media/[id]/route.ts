import { NextRequest } from "next/server";
import { isHost, storageClient } from "../../../../lib/server/auth";
import { db } from "../../../../lib/server/db";
import { AppError, errorResponse } from "../../../../lib/server/errors";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError("이미지를 찾을 수 없습니다.", 404);
    const rows = await db()`select storage_path,content_type from public.media where id=${id} limit 1`;
    if (!rows.length) throw new AppError("이미지를 찾을 수 없습니다.", 404);
    if (!(await isHost(request))) {
      const visible = await db()`select rq.id from public.runs r join public.run_questions rq on rq.id=r.current_run_question_id where r.phase not in ('lobby','finished') and ((rq.snapshot->>'image_path'=${id}) or (r.phase in ('revealed','graded') and rq.snapshot->>'reveal_image_path'=${id})) limit 1`;
      if (!visible.length) throw new AppError("아직 공개되지 않은 이미지입니다.", 403);
    }
    const result = await storageClient().storage.from("quiz-media").download(rows[0].storage_path);
    if (result.error || !result.data) throw new AppError("이미지를 불러오지 못했습니다.", 502);
    return new Response(await result.data.arrayBuffer(), { headers: { "Content-Type": rows[0].content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
