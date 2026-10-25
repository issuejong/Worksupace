import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../lib/server/db";
import { startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";
import { databaseClockSample } from "../lib/server/clock";

const testUrl=process.env.TEST_DATABASE_URL;
if(testUrl)process.env.DATABASE_URL=testUrl;
const suite=testUrl?describe:describe.skip;
suite("fast host flow and private realtime signals",()=>{
  const actor=randomUUID(); let a="",b="",round="",nextRound="",runId="",qid=""; let version=0;
  beforeAll(async()=>{
    if(Number((await db()`select count(*) as count from public.teams`)[0].count))throw new Error("Dedicated empty DB required");
    a=(await db()`insert into public.teams(number,name) values (1,'Quick A') returning id`)[0].id;
    b=(await db()`insert into public.teams(number,name) values (2,'Quick B') returning id`)[0].id;
  });
  afterEach(async()=>{if(runId)await db()`delete from public.runs where id=${runId}`;if(round)await db()`delete from public.rounds where id=${round}`;if(nextRound)await db()`delete from public.rounds where id=${nextRound}`;runId="";round="";nextRound="";});
  afterAll(async()=>{await db()`delete from public.teams where id in (${a},${b})`;await db().end();});
  async function open(kind="choice",answerMode="fixed",wait=false){
    const sql=db();round=(await sql`insert into public.rounds(title,position) values ('Quick round',0) returning id`)[0].id;
    await sql`insert into public.questions(round_id,kind,prompt,options,correct_answer,answer_mode,wait_for_all,duration_seconds) values (${round},${kind},'Fast question',${sql.json(kind==="short"?[]:["A","B"])},${answerMode==="live"?null:"A"},${answerMode},${wait},45)`;
    const run=await startRun("rehearsal");runId=run.runId;version=run.version;
    const result=await transitionRun({action:"start",version},actor);version=result.version;qid=(await stateFor("host")).question!.id;
  }
  const submit=(team:string,value:string)=>submitAnswer(team,{value,requestId:randomUUID(),expectedVersion:0});
  async function quick(answer?:string,verdicts?:Record<string,boolean>){const result=await transitionRun({action:"revealAndGrade",questionId:qid,version,answer,verdicts},actor);version=result.version;return result;}
  it("closes, reveals and scores in one transaction and deduplicates retries",async()=>{
    await open();await submit(a,"A");await submit(b,"B");const inputVersion=version;
    await quick();const screen=await stateFor("screen");
    expect(screen.phase).toBe("graded");expect(screen.question?.correctAnswer).toBe("A");expect(screen.teams.find(t=>t.id===a)).toMatchObject({answer:"A"});
    expect((await stateFor("host")).teams.map(t=>t.score)).toEqual([1,0]);
    expect(await transitionRun({action:"revealAndGrade",questionId:qid,version:inputVersion},actor)).toMatchObject({duplicate:true});
    expect(Number((await db()`select count(*) as count from public.score_entries where run_id=${runId}`)[0].count)).toBe(1);
    await expect(submit(a,"B")).rejects.toMatchObject({code:"ANSWER_CLOSED"});
  });
  it("accepts the host answer before manual close and rolls back invalid reveal attempts",async()=>{
    await open("choice","live");await submit(a,"B");await submit(b,"A");
    await expect(quick()).rejects.toMatchObject({code:"ANSWER_REQUIRED"});
    await expect(quick("bad-option")).rejects.toMatchObject({code:"ANSWER_INVALID"});
    expect((await stateFor("screen")).phase).toBe("live");expect((await stateFor("screen")).question).not.toHaveProperty("correctAnswer");
    await quick("B");expect((await stateFor("screen")).question?.correctAnswer).toBe("B");
    expect((await stateFor("host")).teams.map(t=>t.score)).toEqual([1,0]);
  });
  it("retains the all-team-submission rule for one-click reveal",async()=>{
    await open("choice","live",true);await submit(a,"A");
    await expect(quick("A")).rejects.toMatchObject({code:"WAITING_FOR_TEAMS"});
    await submit(b,"B");await quick("A");expect((await stateFor("screen")).phase).toBe("graded");
  });
  it("automatically grades short answers, allows overrides and shows the final answer before the round checkpoint",async()=>{
    await open("short","live");await submit(a,"  A  ");await submit(b,"비슷한 정답");
    nextRound=(await db()`insert into public.rounds(title,position) values ('Next',1) returning id`)[0].id;
    await db()`insert into public.questions(round_id,kind,prompt,correct_answer) values (${nextRound},'short','Next question','A')`;
    await quick("a",{[b]:true});
    const screen=await stateFor("screen");expect(screen.roundBreak).toBe(false);expect(screen.roundResultsPending).toBe(true);expect(screen.scoresVisible).toBe(false);
    expect(screen.question?.correctAnswer).toBe("a");expect((await stateFor("host")).teams.map(t=>t.score)).toEqual([1,1]);
    await expect(transitionRun({action:"start",version},actor)).rejects.toMatchObject({code:"ROUND_RESULTS_PENDING"});
    const checkpoint=await transitionRun({action:"showRoundResults",version},actor);version=checkpoint.version;
    expect((await stateFor("screen")).roundBreak).toBe(true);expect((await stateFor("screen")).teams.map(t=>t.score)).toEqual([1,1]);
    const next=await transitionRun({action:"start",version},actor);version=next.version;
    expect((await stateFor("screen")).question?.prompt).toBe("Next question");expect((await stateFor("screen")).roundResultsPending).toBe(false);
  });
  it("publishes only opaque change signals, denies anonymous writes and protects private answers",async()=>{
    const count=Number((await db()`select count(*) as count from public.game_events`)[0].count);
    await open();await submit(a,"A");expect(Number((await db()`select count(*) as count from public.game_events`)[0].count)).toBeGreaterThan(count);
    const columns=await db()`select column_name from information_schema.columns where table_schema='public' and table_name='game_events' order by ordinal_position`;
    expect(columns.map(c=>c.column_name)).toEqual(["id","created_at"]);
    await db().begin(async tx=>{await tx`set local role anon`;expect((await tx`select id from public.game_events limit 1`).length).toBe(1);});
    await expect(db().begin(async tx=>{await tx`set local role anon`;await tx`insert into public.game_events default values`;})).rejects.toMatchObject({code:"42501"});
    await expect(db().begin(async tx=>{await tx`set local role anon`;await tx`select * from public.answers`;})).rejects.toMatchObject({code:"42501"});
  });
  it("uses the DB clock and excludes endpoint processing time from the clock exchange",async()=>{
    const sample=await databaseClockSample(performance.now()-2000);
    expect(sample.serverSentAt-sample.serverReceivedAt).toBeGreaterThanOrEqual(2000);
    expect(Math.abs(sample.serverSentAt-Date.now())).toBeLessThan(100);
    expect(sample.serverUncertaintyMs).toBeGreaterThanOrEqual(0);
  });
  it("prepares only the next question photo for the host without exposing it or its answer photo to guests",async()=>{
    await open(); const photo=randomUUID(),answerPhoto=randomUUID();
    await db()`insert into public.questions(round_id,kind,prompt,correct_answer,image_path,reveal_image_path,position) values (${round},'short','Next photo','Name',${photo},${answerPhoto},1)`;
    await quick();
    expect(await stateFor("host")).toMatchObject({nextImageUrl:`/api/media/${photo}`});
    expect(JSON.stringify(await stateFor("host"))).not.toContain(answerPhoto);
    for(const state of [await stateFor("screen"),await stateFor("team",a)]){
      expect(state).not.toHaveProperty("nextImageUrl");
      expect(JSON.stringify(state)).not.toContain(photo);
      expect(JSON.stringify(state)).not.toContain(answerPhoto);
    }
  });
});
