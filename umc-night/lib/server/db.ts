import postgres, { type Sql } from "postgres";

let pool: Sql | undefined;

export function db(): Sql {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
    pool = postgres(url, { prepare: false, max: 5, idle_timeout: 10, connect_timeout: 10 });
  }
  return pool;
}
