import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../lib/server/db";
import { changeSetup, setupState } from "../lib/server/setup";
import { correctGrade, gradeCurrent, startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";
import { typingRequest } from "../lib/server/typing";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) process.env.DATABASE_URL = testUrl;
const suite = testUrl ? describe : describe.skip;

suite("typing relay against isolated PostgreSQL", () => {
  const actor = randomUUID();
  let teamA = ""; let teamB = ""; let lateTeam = ""; let roundId = ""; let runId = ""; let questionId = ""; let sourceId = ""; let version = 0;
  beforeAll(async () => {
    const sql = db();
    if (Number((await sql`select count(*) as count from public.teams`)[0].count)) throw new Error("Typing tests require an empty dedicated DB");
    teamA = (await sql`insert into public.teams(number,name) values (1,'Typing A') returning id`)[0].id;
    teamB = (await sql`insert into public.teams(number,name) values (2,'Typing B') returning id`)[0].id;
  });
  afterEach(async () => {
    if (runId) await db()`delete from public.runs where id=${runId}`;
    if (roundId) await db()`delete from public.rounds where id=${roundId}`;
    if (lateTeam) await db()`delete from public.teams where id=${lateTeam}`;
    runId = ""; roundId = ""; lateTeam = "";
  });
  afterAll(async () => { await db()`delete from public.teams where id in (${teamA},${teamB})`; await db().end(); });
  function savedId(value: Awaited<ReturnType<typeof changeSetup>>): string { if (!("id" in value)) throw new Error("Expected saved id"); return String(value.id); }
  async function open(phrases = ["동국대 UMC!", "두 번째 문장"], award = false, practice = false) {
    roundId = savedId(await changeSetup({ action: "round", title: "Typing", position: 0 }));
    sourceId = savedId(await changeSetup({ action: "question", roundId, kind: "typing", prompt: "릴레이", typingPhrases: phrases, typingAwardWinner: award, durationSeconds: 45, practice }));
    const run = await startRun("rehearsal"); runId = run.runId; version = run.version;
    await act("start"); questionId = (await stateFor("host")).question!.id;
  }
  async function act(action: Parameters<typeof transitionRun>[0]["action"], reason?: string) {
    const result = await transitionRun({ action, version, reason }, actor); version = result.version; return result;
  }
  async function start() {
    await Promise.all([teamA,teamB].map(team => typingRequest(team,{action:"ready",questionId})));
    await act("startTyping");
    await db()`update public.typing_runs set starts_at=clock_timestamp()-interval '10 seconds' where run_question_id=${questionId}`;
  }
  const submit = (teamId: string, value: string, turn: number, progressVersion: number, requestId = randomUUID()) => typingRequest(teamId,{action:"submit",questionId,value,turn,version:progressVersion,requestId});

  it("validates free-form configuration and freezes the participant and phrase snapshots", async () => {
    await open();
    const setup = await setupState();
    expect(setup.questions.find(q => q.id === sourceId)?.typing_phrases).toEqual(["동국대 UMC!","두 번째 문장"]);
    await expect(changeSetup({ action:"question",roundId,kind:"typing",prompt:"Bad",typingPhrases:[""],durationSeconds:45 })).rejects.toThrow();
    await expect(changeSetup({ action:"question",roundId,kind:"typing",prompt:"Bad",typingPhrases:["a\nb"],durationSeconds:45 })).rejects.toThrow();
    await expect(act("startTyping")).rejects.toMatchObject({code:"WAITING_FOR_TEAMS"});
    await start();
    await changeSetup({action:"question",id:sourceId,roundId,kind:"typing",prompt:"Changed",typingPhrases:["다른 문장"],durationSeconds:45});
    expect((await stateFor("team",teamA)).typing?.phrase).toBe("동국대 UMC!");
    lateTeam = (await db()`insert into public.teams(number,name) values (3,'Late') returning id`)[0].id;
    await expect(submit(lateTeam,"동국대 UMC!",0,0)).rejects.toMatchObject({code:"NOT_IN_RELAY"});
    await expect(submitAnswer(teamA,{value:"anything",expectedVersion:0,requestId:randomUUID()})).rejects.toThrow("전용 제출");
  });

  it("blocks countdown submissions, counts each wrong submit once, and advances only exact text", async () => {
    await open();
    await Promise.all([teamA,teamB].map(team => typingRequest(team,{action:"ready",questionId})));
    await act("startTyping");
    await expect(submit(teamA,"동국대 UMC!",0,0)).rejects.toMatchObject({code:"TYPING_CLOSED"});
    await db()`update public.typing_runs set starts_at=clock_timestamp()-interval '10 seconds' where run_question_id=${questionId}`;
    const requestId = randomUUID();
    const [first,retry] = await Promise.all([submit(teamA,"틀림",0,0,requestId),submit(teamA,"틀림",0,0,requestId)]);
    expect(first).toEqual(retry);
    expect((await stateFor("team",teamA)).typing?.own).toMatchObject({turn:0,mistakes:1,version:1});
    await expect(submit(teamA,"동국대 UMC!",1,1)).rejects.toMatchObject({code:"STALE_TYPING"});
    await submit(teamA,"동국대 UMC!".normalize("NFD"),0,1);
    expect((await stateFor("team",teamA)).typing).toMatchObject({phrase:"두 번째 문장",own:{turn:1,mistakes:1}});
    await submit(teamA,"두 번째 문장",1,2);
    const own = (await stateFor("team",teamA)).typing!.own!;
    expect(own.completedAt).not.toBeNull();
    expect(own.resultMs! - Math.round(own.elapsedMs! / 10) * 10).toBe(1000);
    await expect(submit(teamA,"두 번째 문장",1,3)).rejects.toMatchObject({code:"STALE_TYPING"});
    expect((await stateFor("screen")).typing?.teams.find(t => t.teamId === teamA)).toMatchObject({completed:true,completedAt:null,resultMs:null,mistakes:0});
    await expect(act("close")).rejects.toMatchObject({code:"WAITING_FOR_TEAMS"});
  });

  it("excludes pauses, fixes completed records, and publishes DNF after a reasoned force close", async () => {
    await open(["한 문장"]); await start();
    await act("pause");
    await expect(submit(teamA,"한 문장",0,0)).rejects.toMatchObject({code:"TYPING_CLOSED"});
    await db()`update public.typing_runs set paused_at=paused_at-interval '2 seconds' where run_question_id=${questionId}`;
    await act("resume");
    expect((await stateFor("host")).typing!.pausedMs).toBeGreaterThanOrEqual(2000);
    await submit(teamA,"한 문장",0,0);
    const record = (await stateFor("team",teamA)).typing!.own!.resultMs;
    await act("pause"); await act("resume");
    expect((await stateFor("team",teamA)).typing!.own!.resultMs).toBe(record);
    await expect(act("forceClose")).rejects.toThrow("사유");
    await act("forceClose","참가 중단");
    expect((await stateFor("screen")).typing!.resultsVisible).toBe(false);
    await act("reveal");
    const result = await stateFor("screen");
    expect(result.typing!.resultsVisible).toBe(true);
    expect(result.typing!.teams.find(t => t.teamId === teamB)?.resultMs).toBeNull();
    expect((await stateFor("host")).teams.every(t => t.score === 0)).toBe(true);
    expect((await db()`select close_reason from public.typing_runs where run_question_id=${questionId}`)[0].close_reason).toBe("참가 중단");
  });

  it("awards shared winners once, reverses a void, and continues into a regular quiz", async () => {
    await open(["한 문장"],true); await start();
    await Promise.all([submit(teamA,"한 문장",0,0),submit(teamB,"한 문장",0,0)]);
    // Deterministic tie at the same official precision, independent of test machine speed.
    await db()`update public.typing_team_progress set elapsed_ms=10000,result_ms=10000 where run_question_id=${questionId}`;
    const quiz = await changeSetup({action:"question",roundId,kind:"choice",prompt:"기존 퀴즈",options:["A","B"],correctAnswer:"A",durationSeconds:45,position:1});
    await act("close"); await act("reveal");
    expect((await stateFor("host")).teams.map(t=>t.score)).toEqual([1,1]);
    await expect(act("reveal")).rejects.toThrow();
    await expect(correctGrade(actor,{runQuestionId:questionId,teamId:teamA,correct:false,reason:"직접 변경"})).rejects.toThrow("직접 수정");
    await act("void");
    expect((await stateFor("host")).teams.map(t=>t.score)).toEqual([0,0]);
    await act("start");
    const quizState = await stateFor("host");
    expect(quizState.question?.kind).toBe("choice"); expect(quizState.typing).toBeNull();
    await submitAnswer(teamA,{value:"A",expectedVersion:0,requestId:randomUUID()});
    await act("close"); await act("reveal");
    const graded = await gradeCurrent(actor,version,{}); version = graded.version;
    expect((await stateFor("host")).teams.find(t=>t.id===teamA)?.score).toBe(1);
    expect(savedId(quiz)).toBeTruthy();
    await act("finish");
    await expect(changeSetup({action:"deleteTeam",id:teamB})).rejects.toMatchObject({code:"TEAM_HAS_HISTORY"});
  });

  it("keeps practice results out of totals and cascades all relay records on rehearsal reset", async () => {
    await open(["연습"],true,true); await start();
    await Promise.all([submit(teamA,"연습",0,0),submit(teamB,"연습",0,0)]);
    await act("close"); await act("reveal");
    expect((await stateFor("host")).teams.map(t=>t.score)).toEqual([0,0]);
    await db()`delete from public.runs where id=${runId}`;
    expect((await db()`select count(*) as count from public.typing_attempts`)[0].count).toBe("0");
    expect((await db()`select count(*) as count from public.typing_team_progress`)[0].count).toBe("0");
  });
});
