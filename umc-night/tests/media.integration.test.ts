import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const storage = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn(), claims: vi.fn() }));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{getClaims:storage.claims},storage:{from:()=>({upload:storage.upload,download:storage.download})}})}));
import { POST } from "../app/api/media/route";
import { GET } from "../app/api/media/[id]/route";
import { db } from "../lib/server/db";
import { startRun, stateFor, transitionRun } from "../lib/server/game";
import { changeSetup } from "../lib/server/setup";

const testUrl=process.env.TEST_DATABASE_URL;
if(testUrl)process.env.DATABASE_URL=testUrl;
const suite=testUrl?describe:describe.skip;
const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=","base64"));
suite("private quiz photo uploads against isolated PostgreSQL",()=>{
  const actor=randomUUID();const mediaIds:string[]=[];let roundId="",runId="",version=0;
  beforeAll(async()=>{
    process.env.SUPABASE_URL="https://example.supabase.co";process.env.SUPABASE_ANON_KEY="public";process.env.SUPABASE_SERVICE_ROLE_KEY="server-test-key";
    await db()`insert into public.host_users(user_id) values (${actor})`;
  });
  beforeEach(()=>{
    vi.clearAllMocks();storage.claims.mockResolvedValue({data:{claims:{sub:actor}}});storage.upload.mockResolvedValue({error:null});storage.download.mockResolvedValue({error:null,data:new Blob([png],{type:"image/png"})});
  });
  afterAll(async()=>{
    if(runId)await db()`delete from public.runs where id=${runId}`;
    if(roundId)await db()`delete from public.rounds where id=${roundId}`;
    for(const id of mediaIds)await db()`delete from public.media where id=${id}`;
    await db()`delete from public.host_users where user_id=${actor}`;await db().end();
  });
  function upload(file:File,cookie="umc_host_access=test-host",origin="http://localhost") {
    const form=new FormData();form.set("file",file);
    return POST(new NextRequest("http://localhost/api/media",{method:"POST",headers:{origin,cookie},body:form}));
  }
  const image=(id:string,host=false)=>GET(new NextRequest(`http://localhost/api/media/${id}`,{headers:host?{cookie:"umc_host_access=test-host"}:{}}),{params:Promise.resolve({id})});
  async function validUpload() {
    const response=await upload(new File([png],"정답-아코.png",{type:"image/png"}));expect(response.status).toBe(200);
    const saved=await response.json();mediaIds.push(saved.id);return saved;
  }
  async function act(action:Parameters<typeof transitionRun>[0]["action"]) {const result=await transitionRun({action,version},actor);version=result.version;}
  it("requires host authentication and same-origin requests before accepting a photo",async()=>{
    expect((await upload(new File([png],"photo.png",{type:"image/png"}),"")).status).toBe(401);
    expect((await upload(new File([png],"photo.png",{type:"image/png"}),"umc_host_access=test-host","https://other.example")).status).toBe(403);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("rejects empty, oversized and incorrectly labelled files without storing them",async()=>{
    for(const file of [new File([],"empty.png",{type:"image/png"}),new File([png],"wrong.jpg",{type:"image/jpeg"}),new File([new Uint8Array(5*1024*1024+1)],"huge.png",{type:"image/png"})]) expect((await upload(file)).status).toBe(400);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("shows the crop during play, hides the original until reveal, and keeps saved photos private afterwards",async()=>{
    const crop=await validUpload();const original=await validUpload();
    expect(storage.upload.mock.calls.every(([path])=>!path.includes("アコ")&&!path.includes("정답")&&!path.includes("아코"))).toBe(true);
    expect((await image(crop.id,true)).status).toBe(200);expect((await image(original.id)).status).toBe(403);
    roundId=(await db()`insert into public.rounds(title,position) values ('눈코입 사진 퀴즈',0) returning id`)[0].id;
    await changeSetup({action:"question",roundId,kind:"short",prompt:"누구일까요?",correctAnswer:"아코",imageId:crop.id,revealImageId:original.id,durationSeconds:45});
    const run=await startRun("rehearsal");runId=run.runId;version=run.version;
    expect((await image(crop.id)).status).toBe(403);await act("start");
    for(const phase of ["live","paused","closed"]) {
      if(phase==="paused")await act("pause");if(phase==="closed")await act("close");
      const state=await stateFor("screen");expect(state.question?.imageUrl).toBe(crop.url);expect(state.question?.revealImageUrl).toBeNull();
      expect((await image(crop.id)).status).toBe(200);
      const count=storage.download.mock.calls.length;expect((await image(original.id)).status).toBe(403);expect(storage.download).toHaveBeenCalledTimes(count);
    }
    await act("revealAndGrade");expect((await stateFor("screen")).question?.revealImageUrl).toBe(original.url);
    const revealed=await image(original.id);expect(revealed.status).toBe(200);expect(revealed.headers.get("cache-control")).toBe("private, no-store");
    await act("finish");expect((await image(original.id)).status).toBe(403);expect((await image(original.id,true)).status).toBe(200);
  });
});
