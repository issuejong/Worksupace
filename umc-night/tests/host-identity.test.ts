import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ claims:vi.fn(), refresh:vi.fn(), query:vi.fn() }));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{getClaims:mocks.claims,refreshSession:mocks.refresh}})}));
vi.mock("../lib/server/db",()=>({db:()=>mocks.query}));
import { hostRoute } from "../lib/server/auth";

beforeEach(()=>{
  vi.resetAllMocks(); process.env.SUPABASE_URL="https://example.supabase.co"; process.env.SUPABASE_ANON_KEY="test-public-key";
  mocks.claims.mockResolvedValue({data:{claims:{sub:"host-id"}},error:null});
  mocks.query.mockResolvedValue([{user_id:"host-id"}]);
});
const request = (cookie="umc_host_access=test-access") => new NextRequest("https://example.com/api/state?view=host",{headers:{cookie}});
describe("verified host identity",()=>{
  it("uses verified claims and still checks database permission on every request",async()=>{
    const callback=vi.fn().mockResolvedValue({ok:true});
    expect((await hostRoute(request(),callback)).status).toBe(200);
    expect(mocks.claims).toHaveBeenCalledWith("test-access"); expect(mocks.query).toHaveBeenCalledOnce();
    mocks.query.mockResolvedValue([]);
    expect((await hostRoute(request(),callback)).status).toBe(403); expect(callback).toHaveBeenCalledOnce();
  });
  it("rejects invalid or malformed JWTs without trusting cookie contents",async()=>{
    mocks.claims.mockResolvedValue({data:null,error:{message:"Bad signature"}});
    expect((await hostRoute(request(),async()=>({}))).status).toBe(401);
    mocks.claims.mockRejectedValue(new Error("Malformed token"));
    expect((await hostRoute(request(),async()=>({}))).status).toBe(401); expect(mocks.query).not.toHaveBeenCalled();
  });
  it("refreshes an expired token through Supabase and rotates cookies",async()=>{
    mocks.claims.mockResolvedValue({data:null,error:{message:"Expired"}});
    mocks.refresh.mockResolvedValue({data:{user:{id:"host-id"},session:{access_token:"renewed-access",refresh_token:"renewed-refresh",expires_in:3600}}});
    const response=await hostRoute(request("umc_host_access=expired; umc_host_refresh=refresh-token"),async()=>({ok:true}));
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("renewed-access");
  });
});
