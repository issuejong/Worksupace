import type { TransactionSql } from "postgres";
import { db } from "./db";
import { quizAnswerMatches } from "../quiz";
import { AppError } from "./errors";
import { initializeTyping, typingState, typingTransition } from "./typing";

export type Phase = "lobby" | "live" | "paused" | "closed" | "revealed" | "graded" | "finished";
export type Kind = "short" | "choice" | "ox" | "typing";
export type ScoringMode = "all_correct" | "first_correct";
export type AnswerMode = "fixed" | "live" | "manual";
export interface Snapshot extends Record<string, string | number | boolean | string[] | null> {
  typing_phrases: string[];
  typing_award_winner: boolean;
  prompt: string;
  kind: Kind;
  options: string[];
  correct_answer: string | null;
  answer_mode: AnswerMode;
  duration_seconds: number;
  points: number;
  practice: boolean;
  scoring_mode: ScoringMode;
  wait_for_all: boolean;
  required_team_ids: string[];
  image_path: string | null;
  reveal_image_path: string | null;
  youtube_video_id: string | null;
  youtube_start_seconds: number;
  round_id: string;
  round_title: string;
}

function snapshotOf(row: Record<string, unknown>): Snapshot {
  return {
    typing_phrases: Array.isArray(row.typing_phrases) ? row.typing_phrases as string[] : [],
    typing_award_winner: Boolean(row.typing_award_winner),
    prompt: String(row.prompt), kind: row.kind as Kind,
    options: Array.isArray(row.options) ? row.options as string[] : [],
    correct_answer: row.correct_answer == null ? null : String(row.correct_answer),
    answer_mode: (row.answer_mode as AnswerMode) ?? "fixed",
    duration_seconds: Number(row.duration_seconds), points: Number(row.points ?? 1), practice: Boolean(row.practice),
    scoring_mode: (row.scoring_mode as ScoringMode) ?? "all_correct",
    wait_for_all: Boolean(row.wait_for_all), required_team_ids: [],
    image_path: row.image_path ? String(row.image_path) : null,
    reveal_image_path: row.reveal_image_path ? String(row.reveal_image_path) : null,
    youtube_video_id: row.youtube_video_id ? String(row.youtube_video_id) : null,
    youtube_start_seconds: Number(row.youtube_start_seconds ?? 0),
    round_id: String(row.round_id), round_title: String(row.round_title),
  };
}

export async function currentRun() {
  const rows = await db()`select * from public.runs order by (phase <> 'finished') desc, created_at desc limit 1`;
  return rows[0] ?? null;
}

export async function startRun(mode: "rehearsal" | "event") {
  return db().begin(async tx => {
    const active = await tx`select id from public.runs where phase <> 'finished' limit 1 for update`;
    if (active.length) throw new AppError("진행 중인 게임이 있습니다.", 409, "RUN_ACTIVE");
    const runs = await tx`insert into public.runs (mode) values (${mode}) returning *`;
    return { runId: runs[0].id, version: runs[0].version };
  });
}

export async function transitionRun(input: { action: "start" | "pause" | "resume" | "close" | "reveal" | "void" | "finish" | "startTyping" | "forceClose" | "revealAndGrade" | "showRoundResults"; version: number; answer?: string; reason?: string; verdicts?: Record<string, boolean>; answerVersions?: Record<string, number>; questionId?: string; }, actorId: string) {
  return db().begin(async tx => {
    const rows = await tx`select * from public.runs where phase <> 'finished' order by created_at desc limit 1 for update`;
    if (!rows.length) throw new AppError("진행할 게임을 먼저 생성해 주세요.", 409, "NO_RUN");
    const run = rows[0];
    if (input.questionId && input.questionId !== run.current_run_question_id) throw new AppError("현재 문제가 변경되었습니다.", 409, "STALE_VERSION");
    if (input.action === "revealAndGrade" && run.phase === "graded" && Number(run.version) === input.version + 1) return { phase: "graded", version: Number(run.version), duplicate: true };
    if (run.version !== input.version) throw new AppError("다른 화면에서 진행 상태가 바뀌었습니다. 새로고침 후 다시 시도해 주세요.", 409, "STALE_VERSION");
    const phase = run.phase as Phase;
    if (input.action === "start") {
      if (phase !== "lobby" && phase !== "graded") throw new AppError("지금은 다음 문제를 시작할 수 없습니다.", 409);
      const questions = await tx`
        select q.*, r.title as round_title from public.questions q
        join public.rounds r on r.id=q.round_id
        where q.active=true and not exists (select 1 from public.run_questions rq where rq.run_id=${run.id} and rq.question_id=q.id)
        order by r.position, r.created_at, q.position, q.created_at limit 1`;
      if (!questions.length) throw new AppError("남은 문제가 없습니다. 게임을 종료해 주세요.", 409, "NO_QUESTIONS");
      const question = questions[0];
      if (run.round_results_pending && run.current_run_question_id) {
        const previous = (await tx`select snapshot from public.run_questions where id=${run.current_run_question_id}`)[0].snapshot as Snapshot;
        if (previous.round_id !== question.round_id) throw new AppError("중간 순위를 공개한 뒤 다음 라운드를 시작해 주세요.", 409, "ROUND_RESULTS_PENDING");
      }
      const snapshot = snapshotOf(question);
      if (snapshot.wait_for_all || snapshot.kind === "typing") {
        const requiredTeams = await tx`select id from public.teams order by number`;
        if (!requiredTeams.length) throw new AppError("전원 제출 대기 문제는 팀 등록 후 시작해 주세요.", 409, "NO_TEAMS");
        snapshot.required_team_ids = requiredTeams.map(team => String(team.id));
      }
      const runQuestions = await tx`insert into public.run_questions (run_id,question_id,snapshot) values (${run.id},${question.id},${tx.json(snapshot)}) returning id`;
      if (snapshot.kind === "typing") await initializeTyping(tx, String(runQuestions[0].id), snapshot.required_team_ids);
      const updated = await tx`update public.runs set phase='live',round_results_pending=false, current_run_question_id=${runQuestions[0].id}, deadline_at=case when ${snapshot.wait_for_all} then null else clock_timestamp()+make_interval(secs=>${snapshot.duration_seconds}) end, remaining_seconds=null, version=version+1 where id=${run.id} returning version`;
      return { phase: "live", version: updated[0].version };
    }
    if (input.action === "showRoundResults") {
      if (phase !== "graded" || !run.round_results_pending) throw new AppError("공개할 라운드 결과가 없습니다.", 409);
      const current = (await tx`select snapshot from public.run_questions where id=${run.current_run_question_id}`)[0].snapshot as Snapshot;
      const next = await tx`select q.round_id from public.questions q join public.rounds r on r.id=q.round_id where q.active and not exists (select 1 from public.run_questions rq where rq.run_id=${run.id} and rq.question_id=q.id) order by r.position,r.created_at,q.position,q.created_at limit 1`;
      if (next.length && next[0].round_id === current.round_id) throw new AppError("라운드의 마지막 문제 이후 공개할 수 있습니다.", 409);
      const updated = await tx`update public.runs set round_results_pending=false,version=version+1 where id=${run.id} returning version`;
      return { phase: "graded", version: Number(updated[0].version) };
    }
    if (!["void","finish"].includes(input.action) && run.current_run_question_id) {
      const current = (await tx`select snapshot from public.run_questions where id=${run.current_run_question_id}`)[0];
      if ((current?.snapshot as Snapshot)?.kind === "typing") return typingTransition(tx, run, input, actorId);
    }
    if (input.action === "revealAndGrade") {
      if (!["live","paused","closed","revealed"].includes(phase)) throw new AppError("공개할 문제가 없습니다.", 409);
      const rq = (await tx`select * from public.run_questions where id=${run.current_run_question_id} for update`)[0];
      if (!rq || rq.voided || rq.graded_at) throw new AppError("채점할 수 없는 문제입니다.", 409);
      const snapshot = rq.snapshot as Snapshot;
      if (snapshot.wait_for_all && ["live","paused"].includes(phase)) {
        const submitted = await tx`select team_id from public.answers where run_question_id=${rq.id}`;
        if (snapshot.required_team_ids.some(id => !submitted.some(row => row.team_id === id))) throw new AppError("모든 팀이 제출해야 정답을 공개할 수 있습니다.", 409, "WAITING_FOR_TEAMS");
      }
      let answer = snapshot.correct_answer;
      if (snapshot.answer_mode === "live") {
        answer = phase === "revealed" ? rq.selected_answer : input.answer?.trim() ?? rq.selected_answer;
        if (!answer || answer.length > 120) throw new AppError("공개할 정답을 먼저 선택해 주세요.", 400, "ANSWER_REQUIRED");
        if (snapshot.kind !== "short" && !snapshot.options.includes(answer)) throw new AppError("보기 중에서 정답을 선택해 주세요.", 400, "ANSWER_INVALID");
        await tx`update public.run_questions set selected_answer=${answer} where id=${rq.id}`;
      }
      if (!answer && snapshot.answer_mode !== "manual") throw new AppError("정답을 확인해 주세요.", 400, "ANSWER_REQUIRED");
      await gradeAnswers(tx, String(run.id), String(rq.id), snapshot, answer ?? "", actorId, input.verdicts ?? {}, input.answerVersions);
      const updated = await tx`update public.runs set phase='graded',round_results_pending=true,deadline_at=null,remaining_seconds=0,version=version+1 where id=${run.id} returning version`;
      return { phase: "graded", version: Number(updated[0].version) };
    }
    if (input.action === "pause") {
      if (phase !== "live") throw new AppError("답변 진행 중에만 일시정지할 수 있습니다.", 409);
      const updated = await tx`update public.runs set phase='paused',remaining_seconds=case when deadline_at is null then null else greatest(0,ceil(extract(epoch from (deadline_at-clock_timestamp())))::integer) end,deadline_at=null,version=version+1 where id=${run.id} returning version`;
      return { phase: "paused", version: updated[0].version };
    }
    if (input.action === "resume") {
      if (phase !== "paused") throw new AppError("일시정지 상태가 아닙니다.", 409);
      const updated = await tx`update public.runs set phase='live',deadline_at=case when remaining_seconds is null then null else clock_timestamp()+make_interval(secs=>remaining_seconds) end,remaining_seconds=null,version=version+1 where id=${run.id} returning version`;
      return { phase: "live", version: updated[0].version };
    }
    if (input.action === "close") {
      if (phase !== "live" && phase !== "paused") throw new AppError("답변 중인 문제만 마감할 수 있습니다.", 409);
      const current = await tx`select snapshot from public.run_questions where id=${run.current_run_question_id}`;
      const snapshot = current[0]?.snapshot as Snapshot | undefined;
      if (snapshot?.wait_for_all) {
        const submitted = await tx`select team_id from public.answers where run_question_id=${run.current_run_question_id}`;
        const submittedIds = new Set(submitted.map(answer => String(answer.team_id)));
        if (snapshot.required_team_ids.some(id => !submittedIds.has(id))) throw new AppError("시작할 때 등록된 모든 팀이 답안을 제출해야 마감할 수 있습니다.", 409, "WAITING_FOR_TEAMS");
      }
      const updated = await tx`update public.runs set phase='closed',deadline_at=null,remaining_seconds=0,version=version+1 where id=${run.id} returning version`;
      return { phase: "closed", version: updated[0].version };
    }
    if (input.action === "reveal") {
      if (phase !== "closed") throw new AppError("답변 마감 후 정답을 공개할 수 있습니다.", 409);
      const current = await tx`select snapshot from public.run_questions where id=${run.current_run_question_id} for update`;
      if (!current.length) throw new AppError("진행 중인 문제를 찾지 못했습니다.", 409);
      const snapshot = current[0].snapshot as Snapshot;
      if (snapshot.answer_mode === "live") {
        const answer = input.answer?.trim() ?? "";
        if (!answer || answer.length > 120) throw new AppError("현장 정답을 1~120자로 입력해 주세요.", 400, "ANSWER_REQUIRED");
        if (snapshot.kind !== "short" && !snapshot.options.includes(answer)) throw new AppError("보기 중에서 현장 정답을 선택해 주세요.", 400, "ANSWER_INVALID");
        await tx`update public.run_questions set selected_answer=${answer} where id=${run.current_run_question_id}`;
      }
      const updated = await tx`update public.runs set phase='revealed',version=version+1 where id=${run.id} returning version`;
      return { phase: "revealed", version: updated[0].version };
    }
    if (input.action === "void") {
      if (phase === "lobby") throw new AppError("진행 중인 문제가 없습니다.", 409);
      const rq = await tx`select * from public.run_questions where id=${run.current_run_question_id} for update`;
      if (!rq.length || rq[0].voided) throw new AppError("이미 무효 처리한 문제입니다.", 409);
      if (rq[0].graded_at) {
        const grades = await tx`select * from public.grades where run_question_id=${rq[0].id} for update`;
        for (const grade of grades) {
          if (grade.points) await tx`insert into public.score_entries(run_id,run_question_id,team_id,delta,reason,actor_id) values (${run.id},${rq[0].id},${grade.team_id},${-grade.points},'문제 무효 처리',${actorId})`;
          await tx`update public.grades set correct=false,points=0,revision=revision+1,updated_at=now() where run_question_id=${rq[0].id} and team_id=${grade.team_id}`;
        }
      }
      await tx`update public.run_questions set voided=true,graded_at=coalesce(graded_at,now()) where id=${rq[0].id}`;
      const updated = await tx`update public.runs set phase='graded',deadline_at=null,remaining_seconds=0,version=version+1 where id=${run.id} returning version`;
      return { phase: "graded", version: updated[0].version };
    }
    if (input.action === "finish") {
      if (phase !== "lobby" && phase !== "graded") throw new AppError("현재 문제를 마무리한 뒤 종료할 수 있습니다.", 409);
      const updated = await tx`update public.runs set phase='finished',finished_at=now(),version=version+1 where id=${run.id} returning version`;
      return { phase: "finished", version: updated[0].version };
    }
    throw new AppError("알 수 없는 진행 동작입니다.");
  });
}

export async function submitAnswer(teamId: string, input: { value: string; requestId: string; expectedVersion: number; }) {
  return db().begin(async tx => {
    const runs = await tx`select * from public.runs where phase <> 'finished' order by created_at desc limit 1 for update`;
    const run = runs[0];
    const duplicate = await tx`select ar.accepted_version,a.value from public.answer_requests ar join public.answers a on a.id=ar.answer_id where ar.id=${input.requestId} limit 1`;
    if (duplicate.length) return { version: duplicate[0].accepted_version, duplicate: true };
    if (!run || run.phase !== "live") throw new AppError("답변 시간이 종료되었습니다.", 409, "ANSWER_CLOSED");
    const runQuestions = await tx`select snapshot from public.run_questions where id=${run.current_run_question_id} and voided=false limit 1`;
    if (!runQuestions.length) throw new AppError("진행 중인 문제가 없습니다.", 409);
    const snapshot = runQuestions[0].snapshot as Snapshot;
    if (!snapshot.wait_for_all) {
      if (!run.deadline_at) throw new AppError("답변 시간이 종료되었습니다.", 409, "ANSWER_CLOSED");
      const clock = await tx`select clock_timestamp() < ${run.deadline_at}::timestamptz as open`;
      if (!clock[0].open) throw new AppError("답변 시간이 종료되었습니다.", 409, "ANSWER_CLOSED");
    }
    if (snapshot.kind === "typing") throw new AppError("타자 게임 전용 제출을 사용해 주세요.", 409);
    const value = input.value.trim();
    if (!value || value.length > 300) throw new AppError("답안을 1~300자로 입력해 주세요.");
    if ((snapshot.kind === "choice" || snapshot.kind === "ox") && !snapshot.options.includes(value)) throw new AppError("보기 중에서 답을 선택해 주세요.");
    const prior = await tx`select * from public.answers where run_question_id=${run.current_run_question_id} and team_id=${teamId} for update`;
    if (!prior.length && input.expectedVersion !== 0) throw new AppError("답안 상태가 바뀌었습니다. 화면을 새로고침해 주세요.", 409, "STALE_ANSWER");
    if (prior.length && prior[0].version !== input.expectedVersion) throw new AppError("다른 요청에서 답안이 수정되었습니다. 새로고침해 주세요.", 409, "STALE_ANSWER");
    if (prior.length && prior[0].value === value) {
      await tx`insert into public.answer_requests(id,answer_id,accepted_version) values (${input.requestId},${prior[0].id},${prior[0].version})`;
      return { version: prior[0].version, duplicate: false };
    }
    const saved = prior.length
      ? await tx`update public.answers set value=${value},version=version+1,updated_at=clock_timestamp() where id=${prior[0].id} returning id,version`
      : await tx`insert into public.answers(run_question_id,team_id,value,updated_at) values (${run.current_run_question_id},${teamId},${value},clock_timestamp()) returning id,version`;
    await tx`insert into public.answer_requests(id,answer_id,accepted_version) values (${input.requestId},${saved[0].id},${saved[0].version})`;
    return { version: saved[0].version, duplicate: false };
  });
}


async function gradeAnswers(tx: TransactionSql, runId: string, questionId: string, snapshot: Snapshot, correctAnswer: string, actorId: string, verdicts: Record<string, boolean>, answerVersions: Record<string, number> = {}) {
    const teams = await tx`select id from public.teams order by number`;
    const answers = await tx`select team_id,value,version from public.answers where run_question_id=${questionId} order by updated_at,team_id`;
    if (snapshot.answer_mode === "manual") {
      for (const answer of answers) {
        if (typeof verdicts[answer.team_id] !== "boolean") throw new AppError("제출한 모든 팀의 정답·오답을 선택해 주세요.", 409, "VERDICTS_REQUIRED");
        if (answerVersions[answer.team_id] !== Number(answer.version)) throw new AppError("팀이 답안을 수정했습니다. 바뀐 답안을 확인하고 다시 판정해 주세요.", 409, "STALE_VERDICT");
      }
    }
    const answerMap = new Map(answers.map(a => [a.team_id as string, a.value as string]));
    const correctTeams = new Set(teams.filter(team => {
      const answer = answerMap.get(team.id);
      return Boolean(answer && (snapshot.answer_mode === "manual" ? verdicts[team.id] === true : snapshot.kind === "short" ? (verdicts[team.id] ?? quizAnswerMatches(answer, correctAnswer)) : answer === correctAnswer));
    }).map(team => String(team.id)));
    const firstCorrectId = answers.find(answer => correctTeams.has(String(answer.team_id)))?.team_id;
    for (const team of teams) {
      const correct = correctTeams.has(String(team.id));
      const points = correct && !snapshot.practice && (snapshot.scoring_mode !== "first_correct" || team.id === firstCorrectId) ? snapshot.points ?? 1 : 0;
      await tx`insert into public.grades(run_question_id,team_id,correct,points) values (${questionId},${team.id},${correct},${points})`;
      if (points) await tx`insert into public.score_entries(run_id,run_question_id,team_id,delta,reason,actor_id) values (${runId},${questionId},${team.id},${points},'정답',${actorId})`;
    }
    await tx`update public.run_questions set graded_at=now() where id=${questionId}`;
}

export async function gradeCurrent(actorId: string, version: number, verdicts: Record<string, boolean>, answerVersions: Record<string, number> = {}) {
  return db().begin(async tx => {
    const runs = await tx`select * from public.runs where phase <> 'finished' order by created_at desc limit 1 for update`;
    const run = runs[0];
    if (!run) throw new AppError("게임이 없습니다.", 409);
    if (run.phase === "graded" && run.version === version + 1) return { phase: "graded", version: run.version, duplicate: true };
    if (run.version !== version) throw new AppError("진행 상태가 변경되었습니다.", 409, "STALE_VERSION");
    if (run.phase !== "revealed") throw new AppError("정답 공개 후 채점할 수 있습니다.", 409);
    const rq = await tx`select * from public.run_questions where id=${run.current_run_question_id} for update`;
    if (!rq.length || rq[0].voided || rq[0].graded_at) throw new AppError("채점할 수 없는 문제입니다.", 409);
    const snapshot = rq[0].snapshot as Snapshot;
    if (snapshot.kind === "typing") throw new AppError("타자 게임은 결과 공개 시 자동 확정됩니다.", 409);
    const correctAnswer = snapshot.answer_mode === "live" ? rq[0].selected_answer as string | null : snapshot.correct_answer;
    if (!correctAnswer && snapshot.answer_mode !== "manual") throw new AppError("정답을 확정한 뒤 채점해 주세요.", 409, "ANSWER_REQUIRED");
    await gradeAnswers(tx, String(run.id), String(rq[0].id), snapshot, correctAnswer ?? "", actorId, verdicts, answerVersions);
    const updated = await tx`update public.runs set phase='graded',version=version+1 where id=${run.id} returning version`;
    return { phase: "graded", version: updated[0].version, duplicate: false };
  });
}

export async function correctGrade(actorId: string, input: { runQuestionId: string; teamId: string; correct: boolean; reason: string; }) {
  return db().begin(async tx => {
    const rows = await tx`select rq.*, r.mode, r.id as run_id from public.run_questions rq join public.runs r on r.id=rq.run_id where rq.id=${input.runQuestionId} for update of rq`;
    const rq = rows[0];
    if (!rq || rq.voided || !rq.graded_at) throw new AppError("채점된 문제를 찾을 수 없습니다.", 404);
    const grades = await tx`select * from public.grades where run_question_id=${rq.id} for update`;
    const grade = grades.find(row => row.team_id === input.teamId);
    if (!grade) throw new AppError("팀 판정을 찾을 수 없습니다.", 404);
    const snapshot = rq.snapshot as Snapshot;
    if (snapshot.kind === "typing") throw new AppError("타자 게임의 기록은 직접 수정할 수 없습니다. 문제가 있으면 게임을 무효 처리해 주세요.", 409);
    const answer = await tx`select value from public.answers where run_question_id=${rq.id} and team_id=${input.teamId}`;
    if (input.correct && !answer.length) throw new AppError("제출한 답안이 없는 팀은 정답 처리할 수 없습니다.");
    if (grade.correct === input.correct) return { changed: false };
    const orderedAnswers = await tx`select team_id from public.answers where run_question_id=${rq.id} order by updated_at,team_id`;
    const verdictFor = (teamId: string) => teamId === input.teamId ? input.correct : Boolean(grades.find(row => row.team_id === teamId)?.correct);
    const winner = snapshot.scoring_mode === "first_correct" ? orderedAnswers.find(row => verdictFor(String(row.team_id)))?.team_id : null;
    for (const row of grades) {
      const correct = verdictFor(String(row.team_id));
      const points = correct && !snapshot.practice && (snapshot.scoring_mode !== "first_correct" || row.team_id === winner) ? snapshot.points ?? 1 : 0;
      const delta = points - Number(row.points);
      if (delta || row.correct !== correct) await tx`update public.grades set correct=${correct},points=${points},revision=revision+1,updated_at=now() where run_question_id=${rq.id} and team_id=${row.team_id}`;
      if (delta) await tx`insert into public.score_entries(run_id,run_question_id,team_id,delta,reason,actor_id) values (${rq.run_id},${rq.id},${row.team_id},${delta},${input.reason},${actorId})`;
    }
    return { changed: true };
  });
}

export async function stateFor(view: "screen" | "team" | "host", teamId?: string) {
  const sql = db();
  const [teams, run] = await Promise.all([sql`select id,number,name from public.teams order by number`, currentRun()]);
  if (!run) return { typing: null, phase: "lobby", runId: null, version: 0, teams: teams.map(t => ({ id:t.id, number:t.number, name:t.name, score: view === "host" ? 0 : null })), scoresVisible: view === "host", roundResultsPending: false, roundBreak: false, hasNextQuestion: false, question: null, deadlineAt: null, remainingSeconds: null, requiredTeamIds: [], serverNow: new Date().toISOString(), ...(view === "team" ? { teamId } : {}) };
  const scoreRows = await sql`select team_id,coalesce(sum(delta),0)::integer as score from public.score_entries where run_id=${run.id} group by team_id`;
  const scoreMap = new Map(scoreRows.map(row => [row.team_id as string, Number(row.score)]));
  const rq = run.current_run_question_id ? (await sql`select * from public.run_questions where id=${run.current_run_question_id} limit 1`)[0] : null;
  const snapshot = rq?.snapshot as Snapshot | undefined;
  let roundBreak = false;
  let hasNextQuestion = false;
  let nextImageUrl: string | null = null;
  if (run.phase === "lobby" || run.phase === "graded") {
    const next = await sql`select q.round_id,q.image_path from public.questions q join public.rounds r on r.id=q.round_id where q.active=true and not exists (select 1 from public.run_questions played where played.run_id=${run.id} and played.question_id=q.id) order by r.position,r.created_at,q.position,q.created_at limit 1`;
    hasNextQuestion = next.length > 0;
    if (view === "host" && next[0]?.image_path) nextImageUrl = `/api/media/${next[0].image_path}`;
    if (run.phase === "graded" && rq && snapshot) {
      const currentRoundId = snapshot.round_id ?? (await sql`select round_id from public.questions where id=${rq.question_id}`)[0]?.round_id;
      roundBreak = !next.length || next[0].round_id !== currentRoundId;
    }
  }
  const roundResultsPending = roundBreak && Boolean(run.round_results_pending);
  roundBreak = roundBreak && !run.round_results_pending;
  const scoresVisible = view === "host" || run.phase === "finished" || roundBreak;
  const publicTeams = teams.map(t => ({ id: t.id, number: t.number, name: t.name, score: scoresVisible ? scoreMap.get(t.id) ?? 0 : null }));
  const revealed = run.phase === "revealed" || run.phase === "graded" || run.phase === "finished";
  const correctAnswer = snapshot?.answer_mode === "live" ? rq?.selected_answer as string | null : snapshot?.correct_answer;
  const question = snapshot && rq ? {
    id: rq.id, prompt: snapshot.prompt, kind: snapshot.kind, options: snapshot.options,
    durationSeconds: snapshot.duration_seconds, points: snapshot.points ?? 1, practice: snapshot.practice,
    answerMode: snapshot.answer_mode ?? "fixed",
    scoringMode: snapshot.scoring_mode ?? "all_correct", waitForAll: snapshot.wait_for_all ?? false,
    roundTitle: snapshot.round_title,
    imageUrl: snapshot.image_path ? `/api/media/${snapshot.image_path}` : null,
    revealImageUrl: revealed && snapshot.reveal_image_path ? `/api/media/${snapshot.reveal_image_path}` : null,
    youtube: view !== "team" && revealed && snapshot.youtube_video_id ? { videoId: snapshot.youtube_video_id, startSeconds: snapshot.youtube_start_seconds ?? 0 } : null,
    ...((revealed || view === "host") && correctAnswer != null ? { correctAnswer } : {}),
  } : null;
  const answerRows = rq ? await sql`select a.team_id,a.value,a.version,g.correct,g.points from public.answers a left join public.grades g on g.run_question_id=a.run_question_id and g.team_id=a.team_id where a.run_question_id=${rq.id}` : [];
  const answerMap = new Map(answerRows.map(row => [row.team_id as string, row]));
  const screenAnswersVisible = view === "screen" && !rq?.voided && (run.phase === "revealed" || run.phase === "graded");
  const base = {
    phase: run.phase as Phase, runId: run.id as string, mode: run.mode as string, version: Number(run.version), scoresVisible, roundBreak, roundResultsPending, hasNextQuestion,
    typing: snapshot?.kind === "typing" && rq ? await typingState(String(rq.id), snapshot, String(run.phase), view, teamId, Boolean(rq.voided)) : null,
    ...(view === "screen" ? { teamAnswersVisible: screenAnswersVisible } : {}),
    serverNow: new Date().toISOString(), deadlineAt: run.deadline_at as Date | null,
    remainingSeconds: run.remaining_seconds as number | null, question,
    requiredTeamIds: snapshot?.required_team_ids ?? [],
    teams: publicTeams.map(t => ({ ...t, submitted: answerMap.has(t.id), required: snapshot?.wait_for_all ? snapshot.required_team_ids.includes(t.id) : false, ...((view === "host" || screenAnswersVisible) ? { answer: answerMap.get(t.id)?.value ?? null } : {}), ...(view === "host" ? { answerVersion: answerMap.get(t.id)?.version ?? null } : {}), ...((view === "host" || (snapshot?.answer_mode === "manual" && run.phase === "graded" && (view === "screen" || t.id === teamId))) ? { correct: answerMap.get(t.id)?.correct ?? null, earned: answerMap.get(t.id)?.points ?? 0 } : {}) })),
  };
  if (view === "team") {
    const own = answerMap.get(teamId ?? "");
    return { ...base, teamId, ownAnswer: own ? { value: own.value, version: own.version } : null };
  }
  if (view === "host") {
    const history = await sql`select se.id,se.team_id,se.run_question_id,se.delta,se.reason,se.created_at from public.score_entries se where se.run_id=${run.id} order by se.created_at desc limit 50`;
    const gradeRows = await sql`select rq.id as run_question_id,rq.snapshot,rq.voided,g.team_id,g.correct,g.points,a.value as answer from public.run_questions rq left join public.grades g on g.run_question_id=rq.id left join public.answers a on a.run_question_id=rq.id and a.team_id=g.team_id where rq.run_id=${run.id} and rq.graded_at is not null and rq.snapshot->>'kind'<>'typing' order by rq.started_at desc`;
    const gradedQuestions = gradeRows.reduce<Record<string,{ id:string; prompt:string; voided:boolean; grades:{teamId:string;correct:boolean;points:number;answer:string|null}[] }>>((acc,row) => {
      const id = row.run_question_id as string;
      if (!acc[id]) acc[id] = { id, prompt: (row.snapshot as Snapshot).prompt, voided: Boolean(row.voided), grades: [] };
      if (row.team_id) acc[id].grades.push({ teamId: row.team_id, correct: Boolean(row.correct), points: Number(row.points), answer: row.answer ?? null });
      return acc;
    }, {});
    return { ...base, nextImageUrl, history, gradedQuestions: Object.values(gradedQuestions) };
  }
  return base;
}
