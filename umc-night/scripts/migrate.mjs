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

const migrations = ["202610150001_qr_join.sql", "202610150002_team_transfer.sql"];

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
    for (const migration of migrations) {
      const source = await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8");
      for (const statement of source.split(";").map(value => value.trim()).filter(Boolean)) {
        await transaction.unsafe(statement);
      }
    }
  });
  console.log("Production database migrations applied.");
} finally {
  await connection.end();
}
