import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "../lib/server/db";
import { changeSetup, setupState } from "../lib/server/setup";
import { startRun, stateFor, transitionRun } from "../lib/server/game";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) process.env.DATABASE_URL = testUrl;
const suite = testUrl ? describe : describe.skip;
suite("saved YouTube quiz settings", () => {
  const actor = randomUUID(); let roundId = "", runId = "";
  const videoId = "M7lc1UVf-VE";
  afterEach(async () => {
    if (runId) await db()`delete from public.runs where id=${runId}`;
    if (roundId) await db()`delete from public.rounds where id=${roundId}`;
    roundId = ""; runId = "";
  });
  afterAll(async () => { await db().end(); });
  async function save(extra: Record<string, unknown> = {}) {
    if (!roundId) roundId = (await db()`insert into public.rounds(title) values ('영상 퀴즈') returning id`)[0].id;
    const result = await changeSetup({action:"question",roundId,kind:"short",prompt:"영상의 주인공은?",correctAnswer:"정답",durationSeconds:45,youtubeUrl:`https://youtu.be/${videoId}?t=80`,...extra});
    if (!("id" in result)) throw new Error("Expected a question");
    return String(result.id);
  }
  it("persists normalized settings, freezes a running clip, hides it on phones and removes it on reveal", async () => {
    const id = await save();
    expect((await setupState()).questions.find(q=>q.id===id)).toMatchObject({youtube_video_id:videoId,youtube_start_seconds:80});
    const run = await startRun("rehearsal"); runId = run.runId;
    const started = await transitionRun({action:"start",version:run.version},actor);
    await save({id,youtubeStart:"2:05"});
    expect((await stateFor("screen")).question?.youtube).toEqual({videoId,startSeconds:80});
    expect((await stateFor("team",randomUUID())).question?.youtube).toBeNull();
    await transitionRun({action:"revealAndGrade",version:started.version},actor);
    expect((await stateFor("screen")).question?.youtube).toBeNull();
    await save({id,youtubeUrl:""});
    expect((await setupState()).questions.find(q=>q.id===id)).toMatchObject({youtube_video_id:null,youtube_start_seconds:0});
  });
  it("rejects bad settings without updating the saved clip and accepts explicit zero", async () => {
    const id = await save();
    await expect(save({id,youtubeStart:"1:99"})).rejects.toThrow();
    await expect(save({id,youtubeUrl:"https://evil.example/video"})).rejects.toThrow();
    expect((await setupState()).questions.find(q=>q.id===id)?.youtube_start_seconds).toBe(80);
    await save({id,youtubeStart:"0"});
    expect((await setupState()).questions.find(q=>q.id===id)?.youtube_start_seconds).toBe(0);
    await expect(db()`update public.questions set youtube_video_id=null,youtube_start_seconds=80 where id=${id}`).rejects.toMatchObject({code:"23514"});
  });
  it("keeps old question snapshots without video fields working", async () => {
    await save();
    const run = await startRun("rehearsal"); runId = run.runId;
    await transitionRun({action:"start",version:run.version},actor);
    await db()`update public.run_questions set snapshot=snapshot-'youtube_video_id'-'youtube_start_seconds' where run_id=${runId}`;
    expect((await stateFor("screen")).question?.youtube).toBeNull();
  });
});
