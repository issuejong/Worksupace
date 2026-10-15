import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as joinTeam } from "../app/api/join/route";
import { hash } from "../lib/server/auth";
import { db } from "../lib/server/db";
import { correctGrade, gradeCurrent, startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) process.env.DATABASE_URL = testUrl;
const suite = testUrl ? describe : describe.skip;

suite("live game against isolated PostgreSQL", () => {
  const actor = randomUUID();
  const testIp = "192.0.2.31";
  let teamA = ""; let teamB = ""; let teamC = ""; let teamD = ""; let roundId = ""; let runId = "";
  beforeAll(async () => {
    const sql = db();
    const existing = await sql`select count(*)::integer as count from public.teams`;
    if (existing[0].count !== 0) throw new Error("Integration test requires an empty dedicated database");
    roundId = (await sql`insert into public.rounds(title,position) values ('Test round',0) returning id`)[0].id;
    await sql`insert into public.questions(round_id,kind,prompt,options,correct_answer,points,duration_seconds,position) values (${roundId},'choice','Q1',${sql.json(["A","B"])},'A',100,60,0)`;
    await sql`insert into public.questions(round_id,kind,prompt,options,correct_answer,points,duration_seconds,position,practice) values (${roundId},'short','Practice',${sql.json([])},'yes',50,60,1,true)`;
  });
  afterAll(async () => {
    if (!testUrl) return;
    const sql = db();
    if (runId) await sql`delete from public.runs where id=${runId}`;
    if (roundId) await sql`delete from public.rounds where id=${roundId}`;
    await sql`delete from public.join_attempts where key_hash=${hash(testIp)}`;
    if (teamA) await sql`delete from public.teams where id in (${teamA},${teamB},${teamC},${teamD})`;
    await sql.end();
  });
  it("registers any number of teams by name and preserves each representative session", async () => {
    const join = (name: string, cookie?: string) => joinTeam(new NextRequest("http://localhost/api/join", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": testIp, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ action: "join", name }),
    }));
    const joinedA = await join("아코팀");
    expect(joinedA.status).toBe(200);
    teamA = (await joinedA.json()).team.id;
    const cookie = joinedA.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toContain("umc_team_session=");
    expect((await join("다른 이름", cookie)).status).toBe(200);
    expect((await join("아코팀")).status).toBe(409);
    const joinedB = await join("B");
    teamB = (await joinedB.json()).team.id;
    const joinedC = await join("C");
    teamC = (await joinedC.json()).team.id;
    const joinedD = await join("D");
    teamD = (await joinedD.json()).team.id;
    expect((await stateFor("screen")).teams).toHaveLength(4);
    expect((await db()`select number from public.teams where id=${teamD}`)[0].number).toBe(4);
    expect((await db()`select count(*)::integer as count from public.team_sessions where team_id=${teamA} and revoked_at is null`)[0].count).toBe(1);
  });
  it("hides answers until reveal, closes by database time, scores once, and reverses corrections", async () => {
    const started = await startRun("rehearsal"); runId = started.runId;
    const live = await transitionRun({ action: "start", version: started.version }, actor);
    const before = await stateFor("screen");
    expect(before.question).not.toHaveProperty("correctAnswer");
    const requestId = randomUUID();
    const answer = await submitAnswer(teamA, { value: "A", requestId, expectedVersion: 0 });
    expect(answer.version).toBe(1);
    expect(await submitAnswer(teamA, { value: "A", requestId, expectedVersion: 0 })).toMatchObject({ duplicate: true, version: 1 });
    await submitAnswer(teamB, { value: "B", requestId: randomUUID(), expectedVersion: 0 });
    const hidden = await stateFor("screen");
    expect(hidden.teams.find(team => team.id === teamA)).not.toHaveProperty("answer");
    await db()`update public.runs set deadline_at=clock_timestamp()-interval '1 second' where id=${runId}`;
    await expect(submitAnswer(teamC, { value: "A", requestId: randomUUID(), expectedVersion: 0 })).rejects.toMatchObject({ code: "ANSWER_CLOSED" });
    const closed = await transitionRun({ action: "close", version: live.version }, actor);
    const revealed = await transitionRun({ action: "reveal", version: closed.version }, actor);
    const publicState = await stateFor("screen");
    expect(publicState.question).toHaveProperty("correctAnswer", "A");
    const graded = await gradeCurrent(actor, revealed.version, {});
    expect(graded.version).toBe(revealed.version + 1);
    const gradedAgain = await gradeCurrent(actor, revealed.version, {});
    expect(gradedAgain.duplicate).toBe(true);
    const state = await stateFor("host");
    expect(state.teams.find(team => team.id === teamA)?.score).toBe(100);
    expect(state.teams.find(team => team.id === teamB)?.score).toBe(0);
    const rqId = state.question?.id as string;
    await correctGrade(actor, { runQuestionId: rqId, teamId: teamB, correct: true, reason: "판정 정정" });
    expect((await stateFor("host")).teams.find(team => team.id === teamB)?.score).toBe(100);
    await correctGrade(actor, { runQuestionId: rqId, teamId: teamB, correct: false, reason: "판정 되돌림" });
    expect((await stateFor("host")).teams.find(team => team.id === teamB)?.score).toBe(0);
    const practice = await transitionRun({ action: "start", version: graded.version }, actor);
    const paused = await transitionRun({ action: "pause", version: practice.version }, actor);
    await expect(submitAnswer(teamA, { value: "yes", requestId: randomUUID(), expectedVersion: 0 })).rejects.toMatchObject({ code: "ANSWER_CLOSED" });
    const resumed = await transitionRun({ action: "resume", version: paused.version }, actor);
    await submitAnswer(teamA, { value: "yes", requestId: randomUUID(), expectedVersion: 0 });
    const practiceClosed = await transitionRun({ action: "close", version: resumed.version }, actor);
    const practiceRevealed = await transitionRun({ action: "reveal", version: practiceClosed.version }, actor);
    const practiceGraded = await gradeCurrent(actor, practiceRevealed.version, { [teamA]: true });
    expect((await stateFor("host")).teams.find(team => team.id === teamA)?.score).toBe(100);
    const voided = await transitionRun({ action: "void", version: practiceGraded.version }, actor);
    expect((await stateFor("host")).teams.find(team => team.id === teamA)?.score).toBe(100);
    const finished = await transitionRun({ action: "finish", version: voided.version }, actor);
    expect(finished.phase).toBe("finished");
  });
});
