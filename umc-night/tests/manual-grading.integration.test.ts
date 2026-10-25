import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../lib/server/db";
import { changeSetup } from "../lib/server/setup";
import { correctGrade, gradeCurrent, startRun, stateFor, submitAnswer, transitionRun } from "../lib/server/game";

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) process.env.DATABASE_URL = testUrl;
const suite = testUrl ? describe : describe.skip;
suite("host judges text answers explicitly", () => {
  const actor = randomUUID();
  let a = "", b = "", c = "", round = "", runId = "", qid = "", version = 0;
  beforeAll(async () => {
    if (Number((await db()`select count(*) as count from public.teams`)[0].count)) throw new Error("Dedicated empty DB required");
    const teams = await db()`insert into public.teams(number,name) values (1,'Manual A'),(2,'Manual B'),(3,'Manual C') returning id,number`;
    a = teams.find(t => t.number === 1)!.id; b = teams.find(t => t.number === 2)!.id; c = teams.find(t => t.number === 3)!.id;
  });
  afterEach(async () => {
    if (runId) await db()`delete from public.runs where id=${runId}`;
    if (round) await db()`delete from public.rounds where id=${round}`;
    runId = ""; round = "";
  });
  afterAll(async () => { await db()`delete from public.teams where id in (${a},${b},${c})`; await db().end(); });
  async function open(overrides: Record<string, unknown> = {}) {
    round = (await db()`insert into public.rounds(title) values ('Manual quiz') returning id`)[0].id;
    await changeSetup({ action: "question", roundId: round, kind: "short", prompt: "누구일까요?", answerMode: "manual", durationSeconds: 120, points: 3, ...overrides });
    const run = await startRun("rehearsal"); runId = run.runId; version = run.version;
    version = (await transitionRun({ action: "start", version }, actor)).version;
    qid = (await stateFor("host")).question!.id;
  }
  const submit = (teamId: string, value: string, expectedVersion = 0) => submitAnswer(teamId, { value, expectedVersion, requestId: randomUUID() });
  async function grade(verdicts: Record<string, boolean>, answerVersions: Record<string, number>) {
    const result = await transitionRun({ action: "revealAndGrade", version, questionId: qid, verdicts, answerVersions }, actor);
    version = result.version; return result;
  }
  it("stores optional reveal text and restricts manual judging to text questions", async () => {
    await open();
    expect((await stateFor("host")).question).toMatchObject({ kind: "short", answerMode: "manual", options: [] });
    await expect(changeSetup({ action: "question", roundId: round, kind: "choice", options: ["A", "B"], prompt: "invalid", answerMode: "manual", durationSeconds: 30 })).rejects.toThrow("주관식");
    await expect(db()`insert into public.questions(round_id,kind,prompt,answer_mode,correct_answer) values (${round},'ox','invalid','manual',null)`).rejects.toMatchObject({ code: "23514" });
  });
  it("never auto-judges matching text and requires both correct and wrong decisions", async () => {
    await open({ correctAnswer: "김아코" }); await submit(a, "김아코"); await submit(b, "다른 사람");
    await expect(grade({}, {})).rejects.toMatchObject({ code: "VERDICTS_REQUIRED" });
    await expect(grade({ [a]: false }, { [a]: 1 })).rejects.toMatchObject({ code: "VERDICTS_REQUIRED" });
    expect((await stateFor("screen")).question).not.toHaveProperty("correctAnswer");
    expect((await stateFor("host")).teams.map(t => t.score)).toEqual([0, 0, 0]);
    await grade({ [a]: false, [b]: true }, { [a]: 1, [b]: 1 });
    const host = await stateFor("host");
    expect(host.teams.map(t => t.score)).toEqual([0, 3, 0]);
    expect(host.teams.find(t => t.id === a)).toMatchObject({ correct: false });
    const screen = await stateFor("screen");
    expect(screen.question?.correctAnswer).toBe("김아코");
    expect(screen.teams.find(t => t.id === b)).toMatchObject({ answer: "다른 사람", correct: true, earned: 3 });
    expect(screen.teams.find(t => t.id === c)).toMatchObject({ submitted: false, earned: 0 });
    expect(screen.teams.every(t => t.score === null)).toBe(true);
  });
  it("rejects stale decisions after an answer edit without partially scoring", async () => {
    await open(); await submit(a, "첫 답");
    expect((await stateFor("host")).teams.find(t => t.id === a)).toMatchObject({ answerVersion: 1 });
    expect((await stateFor("team", a)).teams.find(t => t.id === a)).not.toHaveProperty("answerVersion");
    await submit(a, "수정한 답", 1);
    await expect(grade({ [a]: true }, { [a]: 1 })).rejects.toMatchObject({ code: "STALE_VERDICT" });
    expect((await stateFor("host")).phase).toBe("live");
    expect(Number((await db()`select count(*) as count from public.grades where run_question_id=${qid}`)[0].count)).toBe(0);
    await grade({ [a]: true }, { [a]: 2 });
    expect((await stateFor("host")).teams.map(t => t.score)).toEqual([3, 0, 0]);
  });
  it("requires decisions for a team that submits while the host is judging", async () => {
    await open(); await submit(a, "A"); await submit(b, "B");
    await expect(grade({ [a]: true }, { [a]: 1 })).rejects.toMatchObject({ code: "VERDICTS_REQUIRED" });
    await grade({ [a]: false, [b]: false, [c]: true }, { [a]: 1, [b]: 1, [c]: 1 });
    // Even a supplied true decision cannot award a team with no submitted answer.
    expect((await stateFor("host")).teams.map(t => t.score)).toEqual([0, 0, 0]);
  });
  it("keeps first-correct ordering, configured points, correction history and retry safety", async () => {
    await open({ scoringMode: "first_correct" }); await submit(b, "B"); await submit(a, "A");
    const inputVersion = version;
    await grade({ [a]: true, [b]: true }, { [a]: 1, [b]: 1 });
    expect((await stateFor("host")).teams.map(t => t.score)).toEqual([0, 3, 0]);
    expect(await transitionRun({ action: "revealAndGrade", version: inputVersion, questionId: qid }, actor)).toMatchObject({ duplicate: true });
    await correctGrade(actor, { runQuestionId: qid, teamId: b, correct: false, reason: "현장 판정 수정" });
    expect((await stateFor("host")).teams.map(t => t.score)).toEqual([3, 0, 0]);
    const host = await stateFor("host");
    expect("history" in host && host.history?.filter(h => h.reason === "현장 판정 수정").map(h => h.delta).sort()).toEqual([-3, 3]);
    const own = await stateFor("team", a);
    expect(own.teams.find(t => t.id === a)).toMatchObject({ correct: true, earned: 3 });
    expect(own.teams.find(t => t.id === b)).not.toHaveProperty("correct");
  });
  it("supports separate reveal and grade without a reference answer and keeps practice unscored", async () => {
    await open({ practice: true }); await submit(a, "자유 답안");
    version = (await transitionRun({ action: "close", version }, actor)).version;
    version = (await transitionRun({ action: "reveal", version }, actor)).version;
    await expect(gradeCurrent(actor, version, {})).rejects.toMatchObject({ code: "VERDICTS_REQUIRED" });
    await gradeCurrent(actor, version, { [a]: true }, { [a]: 1 });
    expect((await stateFor("host")).teams.find(t => t.id === a)).toMatchObject({ correct: true, score: 0, earned: 0 });
  });
});
