import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as joinTeam, GET as inspectSession } from "../app/api/join/route";
import { hash } from "../lib/server/auth";
import { db } from "../lib/server/db";
import { startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";
import { resetPreview, resetTeamsAndGames } from "../lib/server/reset";
import { inspectTeamTransfer, issueTeamTransfer } from "../lib/server/transfer";
import { typingRequest } from "../lib/server/typing";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) process.env.DATABASE_URL = testUrl;
const suite = testUrl ? describe : describe.skip;
suite("team reset against isolated PostgreSQL", () => {
  const actor = randomUUID(); const ip = "192.0.2.72";
  let roundId = ""; let mediaId = ""; let firstId = ""; let teamId = ""; let cookie = ""; let runId = ""; let version = 0;
  const join = (name: string, existing?: string) => joinTeam(new NextRequest("http://localhost/api/join", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "x-forwarded-for": ip, ...(existing ? { cookie: existing } : {}) }, body: JSON.stringify({ action: "join", name }),
  }));
  beforeAll(async () => {
    if (Number((await db()`select count(*) as count from public.teams`)[0].count)) throw new Error("Dedicated empty DB required");
    await db()`insert into public.host_users(user_id) values (${actor})`;
  });
  afterEach(async () => {
    await resetTeamsAndGames((await resetPreview()).snapshot);
    if (roundId) await db()`delete from public.rounds where id=${roundId}`;
    if (mediaId) await db()`delete from public.media where id=${mediaId}`;
    roundId = ""; mediaId = "";
  });
  afterAll(async () => {
    await db()`delete from public.host_users where user_id=${actor}`;
    await db()`delete from public.join_attempts where key_hash=${hash(ip)}`;
    await db().end();
  });
  async function open() {
    const sql = db();
    mediaId = (await sql`insert into public.media(storage_path,content_type) values (${randomUUID()},'image/png') returning id`)[0].id;
    roundId = (await sql`insert into public.rounds(title,position) values ('Keep this round',0) returning id`)[0].id;
    firstId = (await sql`insert into public.questions(round_id,kind,prompt,correct_answer,image_path) values (${roundId},'short','Keep this question','A',${mediaId}) returning id`)[0].id;
    await sql`insert into public.questions(round_id,kind,prompt,answer_mode,correct_answer,typing_phrases,position) values (${roundId},'typing','Keep these phrases','live',null,'["한 문장"]'::jsonb,1)`;
    const joined = await join("다시 쓸 팀 이름"); expect(joined.status).toBe(200);
    teamId = (await joined.json()).team.id; cookie = joined.headers.get("set-cookie")!.split(";")[0];
    const run = await startRun("event"); runId = run.runId; version = run.version;
    const next = await transitionRun({ action: "start", version }, actor); version = next.version;
  }
  async function act(action: Parameters<typeof transitionRun>[0]["action"]) {
    const next = await transitionRun({ action, version }, actor); version = next.version;
  }
  it("clears live and historical play, invalidates devices, preserves content and restarts from the first question", async () => {
    const old = await startRun("rehearsal"); await transitionRun({ action: "finish", version: old.version }, actor);
    await open();
    await submitAnswer(teamId, { value: "A", expectedVersion: 0, requestId: randomUUID() });
    await act("revealAndGrade"); await act("start");
    const relayId = (await stateFor("host")).question!.id;
    await typingRequest(teamId, { action: "ready", questionId: relayId }); await act("startTyping");
    await db()`update public.typing_runs set starts_at=clock_timestamp()-interval '10 seconds' where run_question_id=${relayId}`;
    await typingRequest(teamId, { action: "submit", questionId: relayId, turn: 0, version: 0, value: "오타", requestId: randomUUID() });
    const transfer = await issueTeamTransfer(teamId);
    const content = async () => ({ rounds: await db()`select * from public.rounds order by id`, questions: await db()`select * from public.questions order by id`, media: await db()`select * from public.media order by id` });
    const before = await content(); const preview = await resetPreview();
    expect(preview).toMatchObject({ teamCount: 1, gameCount: 2 });
    expect(await resetTeamsAndGames(preview.snapshot)).toMatchObject({ reset: true, deletedTeams: 1, deletedGames: 2 });
    expect(await content()).toEqual(before);
    for (const table of ["teams","team_sessions","team_transfers","runs","run_questions","answers","answer_requests","grades","score_entries","typing_runs","typing_team_progress","typing_attempts"]) {
      expect(Number((await db().unsafe(`select count(*) as count from public.${table}`))[0].count), table).toBe(0);
    }
    expect((await stateFor("screen"))).toMatchObject({ phase: "lobby", teams: [], runId: null, question: null });
    expect((await db()`select user_id from public.host_users where user_id=${actor}`)).toHaveLength(1);
    const session = await inspectSession(new NextRequest("http://localhost/api/join", { headers: { cookie } }));
    expect(await session.json()).toEqual({ team: null });
    await expect(inspectTeamTransfer(transfer.token)).rejects.toMatchObject({ code: "TRANSFER_EXPIRED" });
    const rejoined = await join("다시 쓸 팀 이름", cookie); expect(rejoined.status).toBe(200);
    const replacement = (await rejoined.json()).team; expect(replacement.number).toBe(1); expect(replacement.id).not.toBe(teamId);
    const newRun = await startRun("event"); await transitionRun({ action: "start", version: newRun.version }, actor);
    const current = (await db()`select question_id from public.run_questions where run_id=${newRun.runId}`)[0];
    expect(current.question_id).toBe(firstId);
  });
  it("requires a fresh confirmation when teams or game state changed", async () => {
    await open(); const preview = await resetPreview();
    await act("pause");
    await expect(resetTeamsAndGames(preview.snapshot)).rejects.toMatchObject({ code: "RESET_CHANGED" });
    const next = await resetPreview(); await join("새 참가 팀");
    await expect(resetTeamsAndGames(next.snapshot)).rejects.toMatchObject({ code: "RESET_CHANGED" });
    expect((await stateFor("host"))).toMatchObject({ runId, phase: "paused" });
    expect((await resetPreview()).teamCount).toBe(2);
  });
  it("does not partially reset when a submission or transition is in flight", async () => {
    await open(); const preview = await resetPreview();
    let release!: () => void; let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const blocker = db().begin(async tx => { await tx`select id from public.runs where id=${runId} for update`; locked(); await hold; });
    await ready;
    try { await expect(resetTeamsAndGames(preview.snapshot)).rejects.toMatchObject({ code: "RESET_BUSY" }); }
    finally { release(); await blocker; }
    expect(await resetPreview()).toEqual(preview);
    expect(await resetTeamsAndGames(preview.snapshot)).toMatchObject({ reset: true });
  });
  it("rolls back game deletion if team deletion fails", async () => {
    await open(); const preview = await resetPreview();
    await db().unsafe("create function public.reject_test_reset() returns trigger language plpgsql as $$ begin raise exception 'test reset failure'; end; $$");
    await db()`create trigger reject_test_reset before delete on public.teams for each statement execute function public.reject_test_reset()`;
    try {
      await expect(resetTeamsAndGames(preview.snapshot)).rejects.toThrow("test reset failure");
      expect(await resetPreview()).toEqual(preview);
      expect((await stateFor("host")).question?.prompt).toBe("Keep this question");
    } finally {
      await db()`drop trigger reject_test_reset on public.teams`;
      await db()`drop function public.reject_test_reset()`;
    }
  });
});
