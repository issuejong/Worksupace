import { noStore } from "../../../lib/server/errors";

export const runtime = "nodejs";
export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  let isPublic = key?.startsWith("sb_publishable_") ?? false;
  if (key?.startsWith("eyJ")) {
    try { isPublic = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch {}
  }
  // Never expose a server/service-role key, even if the environment is misconfigured.
  return noStore(url && key && isPublic ? { url, key } : { url: null, key: null });
}
