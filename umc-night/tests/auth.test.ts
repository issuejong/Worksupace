import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hostLoginEmail } from "../lib/host-login";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), query: vi.fn(), setCookies: vi.fn(), clearCookies: vi.fn() }));
vi.mock("../lib/server/auth", () => ({
  authClient: () => ({ auth: { signInWithPassword: mocks.signIn } }),
  setHostCookies: mocks.setCookies,
  clearHostCookies: mocks.clearCookies,
}));
vi.mock("../lib/server/db", () => ({ db: () => mocks.query }));
import { POST } from "../app/api/auth/route";

function login(email: string, password = "test-password", origin = "https://example.com") {
  return POST(new NextRequest("https://example.com/api/auth", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ action: "login", email, password }),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signIn.mockResolvedValue({ data: { user: { id: "host-id" }, session: { access_token: "test-token" } }, error: null });
  mocks.query.mockResolvedValue([{ user_id: "host-id" }]);
});

describe("host login", () => {
  it("normalizes usernames while preserving existing email logins", () => {
    expect(hostLoginEmail.parse("  Host_123  ")).toBe("host_123@umc-night.invalid");
    expect(hostLoginEmail.parse("host@example.com")).toBe("host@example.com");
    for (const invalid of ["", "ab", "with spaces", "a".repeat(33), "host@", "host+tag"])
      expect(hostLoginEmail.safeParse(invalid).success).toBe(false);
  });

  it.each(["host_123", "host@example.com"])("authenticates %s through Supabase before checking host access", async identifier => {
    expect((await login(identifier)).status).toBe(200);
    expect(mocks.signIn).toHaveBeenCalledWith({ email: hostLoginEmail.parse(identifier), password: "test-password" });
    expect(mocks.query).toHaveBeenCalled();
    expect(mocks.setCookies).toHaveBeenCalledOnce();
  });

  it("rejects wrong passwords without checking or issuing host access", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid credentials" } });
    expect((await login("host_123", "wrong-password")).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.setCookies).not.toHaveBeenCalled();
  });

  it("requires explicit host registration even after successful authentication", async () => {
    mocks.query.mockResolvedValue([]);
    expect((await login("host_123")).status).toBe(403);
    expect(mocks.setCookies).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before calling Supabase", async () => {
    expect((await login("bad identifier")).status).toBe(400);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("keeps cross-origin login protection", async () => {
    expect((await login("host_123", "test-password", "https://other.example")).status).toBe(403);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
