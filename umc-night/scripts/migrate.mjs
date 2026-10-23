import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (process.env.VERCEL_ENV !== "production") {
  console.log("Database migrations skipped outside Vercel production.");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for the production migration.");
}

const migrations = ["202610150001_qr_join.sql", "202610150002_team_transfer.sql", "202610160001_question_rules.sql", "202610190001_live_answers.sql", "202610200001_correct_counts.sql", "202610230001_typing_relay.sql", "202610230002_live_sync.sql", "202610240001_configurable_points.sql"];

const connection = postgres(url, {
  ...(process.env.DATABASE_PASSWORD
    ? { password: process.env.DATABASE_PASSWORD }
    : {}),
  prepare: false,
  max: 1,
  connect_timeout: 10,
  ...(new URL(url).hostname.endsWith(".pooler.supabase.com")
    ? { ssl: "require" }
    : {}),
});

try {
  await connection.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(20261024,1)`;
    await transaction`create table if not exists public.umc_schema_migrations (version text primary key,applied_at timestamptz not null default now())`;
    await transaction`alter table public.umc_schema_migrations enable row level security`;
    await transaction`revoke all on public.umc_schema_migrations from anon,authenticated`;
    for (const migration of migrations) {
      if ((await transaction`select 1 from public.umc_schema_migrations where version=${migration}`).length) continue;
      // SQL Editor/manual installations may already have the newer points
      // schema. Never replay the historical conversion to one point on them.
      const alreadyUpgraded = migration === "202610200001_correct_counts.sql" && (await transaction`select 1 from pg_constraint where conrelid='public.questions'::regclass and conname='questions_configurable_points_check'`).length > 0;
      if (!alreadyUpgraded) {
        const source = await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8");
        await transaction.unsafe(source).simple();
      }
      await transaction`insert into public.umc_schema_migrations(version) values (${migration})`;
    }
  });
  console.log("Production database migrations applied.");
} finally {
  await connection.end();
}
