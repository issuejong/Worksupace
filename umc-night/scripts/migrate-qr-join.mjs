import { readFile } from "node:fs/promises";
import postgres from "postgres";

if (process.env.VERCEL_ENV !== "production") {
  console.log("QR join migration skipped outside Vercel production.");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required for the production migration.");
}

const statements = (await readFile(
  new URL("../supabase/migrations/202610150001_qr_join.sql", import.meta.url),
  "utf8",
))
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

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
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }
  });
  console.log("QR join migration applied.");
} finally {
  await connection.end();
}
