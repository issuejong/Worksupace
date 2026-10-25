import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../lib/server/db";
import { changeSetup, setupState } from "../lib/server/setup";
import { correctGrade, startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";
import { typingRequest } from "../lib/server/typing";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) process.env.DATABASE_URL = testUrl;
const suite = testUrl ? describe : describe.skip;
suite("configurable point awards against isolated PostgreSQL", () => {
  const actor = randomUUID(); let a = "", b = "", roundId = "", sourceId = "", runId = "", questionId = "", version = 0;
  beforeAll(async () => {
    if (Number((await db()`select count(*) as count from public.teams`)[0].count)) throw new Error("Dedicated empty DB required");
    a = (await db()`insert into public.teams(number,name) values (1,'Points A') returning id`)[0].id;
    b = (await db()`insert into public.teams(number,name) values (2,'Points B') returning id`)[0].id;
  });
  afterEach(async () => {
    if (runId) await db()`delete from public.runs where id=${runId}`;
    if (roundId) await db()`delete from public.rounds where id=${roundId}`;
    runId = ""; roundId = "";
  });
  afterAll(async () => { await db()`delete from public.teams where id in (${a},${b})`; await db().end(); });
  async function save(extra: Record<string, unknown> = {}) {
    const result = await changeSetup({ action: "question", ...(sourceId ? { id: sourceId } : {}), roundId, kind: "choice", prompt: "Weighted quiz", options: ["A","B"], correctAnswer: "A", durationSeconds: 60, ...extra });
    if (!("id" in result)) throw new Error("Expected question");
    sourceId = String(result.id);
  }
  async function open(extra: Record<string, unknown> = {}) {
    sourceId = ""; questionId = "";
    roundId = (await db()`insert into public.rounds(title,position) values ('Points round',0) returning id`)[0].id;
    await save(extra); const run = await startRun("rehearsal"); runId = run.runId; version = run.version;
    await act("start"); questionId = (await stateFor("host")).question!.id;
  }
  async function act(action: Parameters<typeof transitionRun>[0]["action"], expectedVersion = version) {
    const result = await transitionRun({ action, version: expectedVersion, questionId: questionId || undefined }, actor); version = result.version; return result;
  }
  const submit = (teamId: string, value = "A") => submitAnswer(teamId, { value, requestId: randomUUID(), expectedVersion: 0 });
  const totals = async () => (await stateFor("host")).teams.map(team => team.score);
  async function finishRelay() {
    for (const teamId of [a,b]) await typingRequest(teamId, { action: "ready", questionId });
    await act("startTyping");
    await db()`update public.typing_runs set starts_at=clock_timestamp()-interval '10 seconds' where run_question_id=${questionId}`;
    for (const teamId of [a,b]) await typingRequest(teamId, { action: "submit", questionId, turn: 0, version: 0, value: "한 문장", requestId: randomUUID() });
    await db()`update public.typing_team_progress set elapsed_ms=10000,result_ms=10000 where run_question_id=${questionId}`;
  }
  it("defaults to one point, validates whole-point bounds and preserves awards omitted by older clients", async () => {
    await open(); expect((await stateFor("screen")).question?.points).toBe(1);
    await save({ points: 1000 }); await save({ prompt: "Edit without points" });
    expect((await setupState()).questions.find(q=>q.id===sourceId)?.points).toBe(1000);
    for (const points of [0,-1,1.5,1001]) await expect(save({ points })).rejects.toThrow();
    await expect(db()`update public.questions set points=0 where id=${sourceId}`).rejects.toMatchObject({ code: "23514" });
  });
  it("freezes the started award and uses it for grading, corrections, retries and voids", async () => {
    questionId = ""; await open({ points: 5 });
    await save({ points: 20 }); expect((await stateFor("screen")).question?.points).toBe(5);
    await submit(a); await submit(b,"B"); const before = version;
    await act("revealAndGrade"); expect(await totals()).toEqual([5,0]);
    expect(await act("revealAndGrade",before)).toMatchObject({ duplicate: true }); expect(await totals()).toEqual([5,0]);
    await correctGrade(actor,{runQuestionId:questionId,teamId:b,correct:true,reason:"유사 정답"}); expect(await totals()).toEqual([5,5]);
    await correctGrade(actor,{runQuestionId:questionId,teamId:a,correct:false,reason:"판정 정정"}); expect(await totals()).toEqual([0,5]);
    await act("void"); expect(await totals()).toEqual([0,0]);
  });
  it("transfers the full award when the first-correct winner is corrected", async () => {
    questionId = ""; await open({ points: 7, scoringMode: "first_correct" }); await submit(a); await submit(b);
    await act("revealAndGrade"); expect(await totals()).toEqual([7,0]);
    await correctGrade(actor,{runQuestionId:questionId,teamId:a,correct:false,reason:"판정 정정"}); expect(await totals()).toEqual([0,7]);
    await correctGrade(actor,{runQuestionId:questionId,teamId:a,correct:true,reason:"되돌리기"}); expect(await totals()).toEqual([7,0]);
    await act("void"); expect(await totals()).toEqual([0,0]);
  });
  it("awards the configured relay points to shared winners and reverses the full award on void", async () => {
    questionId = ""; await open({ kind: "typing", typingPhrases: ["한 문장"], typingAwardWinner: true, points: 9 });
    await save({ kind: "typing", typingPhrases: ["한 문장"], typingAwardWinner: true, points: 30 });
    await finishRelay(); const before = version; await act("revealAndGrade");
    expect(await totals()).toEqual([9,9]); expect((await stateFor("screen")).question?.points).toBe(9);
    await act("revealAndGrade",before); expect(await totals()).toEqual([9,9]);
    await act("void"); expect(await totals()).toEqual([0,0]);
  });
  it.each([
    { kind: "choice", practice: true, points: 25 },
    { kind: "typing", practice: true, typingPhrases: ["한 문장"], typingAwardWinner: true, points: 25 },
    { kind: "typing", practice: false, typingPhrases: ["한 문장"], typingAwardWinner: false, points: 25 },
  ])("keeps practice and record-only games out of totals: %j", async config => {
    questionId = ""; await open(config);
    if (config.kind === "typing") await finishRelay(); else { await submit(a); await submit(b); }
    await act("revealAndGrade"); expect(await totals()).toEqual([0,0]);
  });
  it("treats legacy snapshots without an award as one point", async () => {
    questionId = ""; await open({ points: 10 });
    await db()`update public.run_questions set snapshot=snapshot-'points' where id=${questionId}`;
    await submit(a); await submit(b,"B"); await act("revealAndGrade"); expect(await totals()).toEqual([1,0]);
    await correctGrade(actor,{runQuestionId:questionId,teamId:b,correct:true,reason:"기존 기록 정정"}); expect(await totals()).toEqual([1,1]);
    await act("void"); expect(await totals()).toEqual([0,0]);
  });
  it("preserves configured awards and history across first adoption and repeated production migrations", async () => {
    questionId = ""; await open({ points: 5 }); await submit(a); await submit(b,"B"); await act("revealAndGrade");
    await correctGrade(actor,{runQuestionId:questionId,teamId:a,correct:false,reason:"취소"});
    await correctGrade(actor,{runQuestionId:questionId,teamId:b,correct:true,reason:"인정"});
    const records = async () => ({ question: await db()`select points from public.questions where id=${sourceId}`, snapshot: await db()`select snapshot from public.run_questions where id=${questionId}`, grades: await db()`select team_id,correct,points from public.grades where run_question_id=${questionId} order by team_id`, history: await db()`select id,delta from public.score_entries where run_id=${runId} order by id` });
    const before = await records();
    await db()`drop table if exists public.umc_schema_migrations`;
    const runMigration = () => promisify(execFile)(process.execPath,["scripts/migrate.mjs"],{env:{...process.env,DATABASE_URL:testUrl!,DATABASE_PASSWORD:"",VERCEL_ENV:"production"}});
    await runMigration(); expect(await records()).toEqual(before);
    expect(Number((await db()`select count(*) as count from public.umc_schema_migrations`)[0].count)).toBe(9);
    await runMigration(); expect(await records()).toEqual(before); expect(await totals()).toEqual([0,5]);
  });
});
