import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../lib/server/db";
import { startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";
const url=process.env.TEST_DATABASE_URL;
if(url)process.env.DATABASE_URL=url;
const suite=url?describe:describe.skip;
suite("final reveal and rehearsal round skipping",()=>{
 const actor=randomUUID();let runId="",rounds:string[]=[],team="";
 beforeAll(async()=>{team=(await db()`insert into teams(number,name) values (1,'Final test team') returning id`)[0].id;});
 afterEach(async()=>{if(runId)await db()`delete from runs where id=${runId}`;for(const id of rounds)await db()`delete from rounds where id=${id}`;runId="";rounds=[];});
 afterAll(async()=>{await db()`delete from teams where id=${team}`;await db().end();});
 async function round(position:number,count:number,typing=false){
  const sql=db();const id=(await sql`insert into rounds(title,position) values (${'Round '+position},${position}) returning id`)[0].id;rounds.push(id);
  for(let i=0;i<count;i++)await sql`insert into questions(round_id,kind,prompt,correct_answer,position,typing_phrases) values (${id},${typing?'typing':'short'},${'Question '+position+'-'+i},'A',${i},${sql.json(typing?['hello']:[])})`;
  return id;
 }
 async function run(mode:"rehearsal"|"event"="rehearsal"){const r=await startRun(mode);runId=r.runId;return r.version;}
 const go=(action:Parameters<typeof transitionRun>[0]['action'],version:number)=>transitionRun({action,version},actor);
 it("holds final scores on every public device until winner reveal",async()=>{
  await round(0,1);let v=await run();v=(await go('start',v)).version;
  await submitAnswer(team,{value:'A',requestId:randomUUID(),expectedVersion:0});v=(await go('revealAndGrade',v)).version;
  expect(await stateFor('screen')).toMatchObject({roundResultsPending:true,scoresVisible:false});
  v=(await go('showRoundResults',v)).version;
  for(const state of [await stateFor('screen'),await stateFor('team',team)])expect(state).toMatchObject({finaleReady:true,scoresVisible:false,teams:[{score:null}]});
  expect(await stateFor('host')).toMatchObject({finaleReady:true,teams:[{score:1}]});
  await go('finish',v);expect(await stateFor('screen')).toMatchObject({phase:'finished',finaleReady:false,scoresVisible:true,teams:[{score:1}]});
 });
 it("skips only the remaining round questions and preserves earned points and templates",async()=>{
  const first=await round(0,3);await round(1,1);let v=await run();v=(await go('start',v)).version;
  await submitAnswer(team,{value:'A',requestId:randomUUID(),expectedVersion:0});v=(await go('revealAndGrade',v)).version;
  const stale=v;v=(await go('skipRound',v)).version;
  expect(await stateFor('screen')).toMatchObject({roundBreak:true,hasNextQuestion:true,scoresVisible:true,teams:[{score:1}]});
  const history=await db()`select voided from run_questions where run_id=${runId}`;expect(history.filter(q=>q.voided)).toHaveLength(2);
  expect((await db()`select id from questions where round_id=${first}`).length).toBe(3);
  await expect(go('skipRound',stale)).rejects.toMatchObject({code:'STALE_VERSION'});
  await go('start',v);expect((await stateFor('screen')).question?.roundTitle).toBe('Round 1');
 });
 it("skips a live all-team typing round and reaches the final teaser without awarding points",async()=>{
  await round(0,1,true);let v=await run();v=(await go('start',v)).version;v=(await go('skipRound',v)).version;
  expect(await stateFor('screen')).toMatchObject({finaleReady:true,scoresVisible:false});
  expect(await stateFor('host')).toMatchObject({teams:[{score:0}]});
  await expect(go('skipRound',v)).rejects.toMatchObject({code:'NO_QUESTIONS'});
 });
 it("can skip rounds from lobby and checkpoints without starting each question",async()=>{
  await round(0,2);await round(1,2);let v=await run();v=(await go('skipRound',v)).version;
  expect(await stateFor('screen')).toMatchObject({roundBreak:true,hasNextQuestion:true});
  v=(await go('skipRound',v)).version;expect(await stateFor('screen')).toMatchObject({finaleReady:true,hasNextQuestion:false});
  expect((await db()`select id from run_questions where run_id=${runId} and voided`).length).toBe(4);
 });
 it("rejects round skipping in the actual event without changing progress",async()=>{
  await round(0,2);const v=await run('event');await expect(go('skipRound',v)).rejects.toMatchObject({code:'REHEARSAL_ONLY'});
  expect(await stateFor('host')).toMatchObject({phase:'lobby',version:v});expect((await db()`select id from run_questions where run_id=${runId}`).length).toBe(0);
 });
});
