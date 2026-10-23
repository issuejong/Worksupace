import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/live/route";
afterEach(()=>vi.unstubAllEnvs());
describe("public realtime configuration",()=>{
  it("returns the publishable key",async()=>{
    vi.stubEnv("SUPABASE_URL","https://example.supabase.co");vi.stubEnv("SUPABASE_ANON_KEY","sb_publishable_public");
    expect(await(await GET()).json()).toEqual({url:"https://example.supabase.co",key:"sb_publishable_public"});
  });
  it.each(["sb_secret_server",`eyJheader.${Buffer.from(JSON.stringify({role:"service_role"})).toString("base64url")}.signature`])("never exposes a server credential: %s",async key=>{
    vi.stubEnv("SUPABASE_URL","https://example.supabase.co");vi.stubEnv("SUPABASE_ANON_KEY",key);
    expect(await(await GET()).json()).toEqual({url:null,key:null});
  });
});
