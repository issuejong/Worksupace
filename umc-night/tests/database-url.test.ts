import { describe, expect, it } from "vitest";
import { migrationDatabaseUrl } from "../scripts/database-url.mjs";

describe("migration connection routing", () => {
  it("uses the transaction pool while preserving encoded credentials and connection parameters", () => {
    const input = "postgresql://postgres.project:p%40ss%2Fword@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require";
    const output = new URL(migrationDatabaseUrl(input));
    const original = new URL(input);
    expect(output.port).toBe("6543");
    expect([output.hostname, output.username, output.password, output.pathname, output.search]).toEqual([original.hostname, original.username, original.password, original.pathname, original.search]);
  });
  it("routes a pooler URI with the default Postgres port omitted", () => {
    expect(new URL(migrationDatabaseUrl("postgresql://postgres.project@aws-0-region.pooler.supabase.com/postgres")).port).toBe("6543");
  });
  it.each([
    "postgresql://postgres@localhost:55432/umc_night_test",
    "postgresql://postgres@db.project.supabase.co:5432/postgres",
    "postgresql://postgres.project@aws-0-region.pooler.supabase.com:6543/postgres",
    "postgresql://postgres@pooler.supabase.com.example.org:5432/postgres",
  ])("does not alter direct, local, already configured or unrelated endpoints: %s", input => {
    expect(migrationDatabaseUrl(input)).toBe(input);
  });
});
