import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), query: vi.fn(), preview: vi.fn(), reset: vi.fn(), state: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getClaims: mocks.claims } }) }));
vi.mock("../lib/server/db", () => ({ db: () => mocks.query }));
vi.mock("../lib/server/reset", () => ({ resetPreview: mocks.preview, resetTeamsAndGames: mocks.reset }));
vi.mock("../lib/server/game", () => ({ stateFor: mocks.state }));
import { GET, POST } from "../app/api/admin/reset/route";

const snapshot = "a".repeat(64);
const request = (body?: unknown, origin = "https://example.com", cookie = "umc_host_access=host") => new NextRequest("https://example.com/api/admin/reset", {
  method: body === undefined ? "GET" : "POST", headers: { origin, cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.resetAllMocks(); process.env.SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_ANON_KEY = "public-key";
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "host-id" } } }); mocks.query.mockResolvedValue([{ user_id: "host-id" }]);
  mocks.preview.mockResolvedValue({ teamCount: 2, gameCount: 1, snapshot }); mocks.reset.mockResolvedValue({ reset: true }); mocks.state.mockResolvedValue({ phase: "lobby", teams: [] });
});
describe("host-only team reset", () => {
  it("requires login even to preview the reset", async () => {
    expect((await GET(request(undefined, undefined, ""))).status).toBe(401); expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("does not let a participant reset teams", async () => {
    mocks.query.mockResolvedValue([]);
    expect((await POST(request({ confirmation: "팀 초기화", snapshot }))).status).toBe(403); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("rejects cross-origin resets before accessing game data", async () => {
    expect((await POST(request({ confirmation: "팀 초기화", snapshot }, "https://other.example"))).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("validates the confirmation text and preview fingerprint", async () => {
    for (const body of [{ confirmation: "초기화", snapshot }, { confirmation: "팀 초기화" }]) expect((await POST(request(body))).status).toBe(400);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("previews counts without deleting records", async () => {
    expect(await (await GET(request())).json()).toMatchObject({ teamCount: 2, gameCount: 1, snapshot }); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("returns a fresh lobby state only after the confirmed reset", async () => {
    expect(await (await POST(request({ confirmation: "팀 초기화", snapshot }))).json()).toEqual({ reset: true, state: { phase: "lobby", teams: [] } });
    expect(mocks.reset).toHaveBeenCalledWith(snapshot); expect(mocks.state).toHaveBeenCalledWith("host");
  });
});
