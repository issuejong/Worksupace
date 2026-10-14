import postgres, { type Sql } from "postgres";

let pool: Sql | undefined;

export function db(): Sql {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
    const supabasePooler = new URL(url).hostname.endsWith(".pooler.supabase.com");
    pool = postgres(url, {
      prepare: false,
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
      ...(supabasePooler ? { ssl: "require" as const } : {}),
    });
  }
  return pool;
}
