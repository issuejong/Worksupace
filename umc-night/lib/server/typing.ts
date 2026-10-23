import type { TransactionSql } from "postgres";
import { db } from "./db";
import { AppError } from "./errors";
import type { Snapshot } from "./game";
import { normalizeTyping, typingResult, type TypingProgress, type TypingState } from "../typing";

const iso = (value: unknown) => value == null ? null : new Date(value as string).toISOString();
function progressOf(row: Record<string, unknown>): TypingProgress {
  return { teamId: String(row.team_id), ready: Boolean(row.ready), completed: Boolean(row.completed_at), turn: Number(row.turn), mistakes: Number(row.mistakes), version: Number(row.version), completedAt: iso(row.completed_at), elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms), resultMs: row.result_ms == null ? null : Number(row.result_ms) };
}

export async function initializeTyping(tx: TransactionSql, questionId: string, teamIds: string[]) {
  await tx`insert into public.typing_runs(run_question_id) values (${questionId})`;
  for (const teamId of teamIds) await tx`insert into public.typing_team_progress(run_question_id,team_id) values (${questionId},${teamId})`;
}

export async function typingState(questionId: string, snapshot: Snapshot, phase: string, view: string, teamId?: string, voided = false): Promise<TypingState> {
  const sql = db();
  const [runs, rows] = await Promise.all([
    sql`select * from public.typing_runs where run_question_id=${questionId}`,
    sql`select * from public.typing_team_progress where run_question_id=${questionId} order by team_id`,
  ]);
  const run = runs[0];
  const resultsVisible = !voided && ["revealed","graded","finished"].includes(phase);
  const own = rows.find(row => row.team_id === teamId);
  return {
    startsAt: iso(run?.starts_at), pausedAt: iso(run?.paused_at), pausedMs: Number(run?.paused_ms ?? 0),
    turns: snapshot.typing_phrases.length, awardWinner: snapshot.typing_award_winner, resultsVisible, voided,
    teams: rows.map(row => { const progress = progressOf(row); return view === "host" || resultsVisible || row.team_id === teamId ? progress : { ...progress, completedAt: null, mistakes: 0, elapsedMs: null, resultMs: null }; }),
    own: own ? progressOf(own) : null,
    ...((view === "host" || view === "team") ? { phrase: snapshot.typing_phrases[Math.min(Number(own?.turn ?? 0), snapshot.typing_phrases.length - 1)] } : {}),
  };
}

export type TypingInput = { action: "ready"; questionId: string } | { action: "submit"; questionId: string; turn: number; value: string; requestId: string; version: number };
export async function typingRequest(teamId: string, input: TypingInput) {
  return db().begin(async tx => {
    // Shared run lock permits teams to submit concurrently, but excludes host transitions.
    const runs = await tx`select r.*,rq.snapshot,rq.voided from public.runs r join public.run_questions rq on rq.id=r.current_run_question_id where r.phase<>'finished' for share of r`;
    const run = runs[0];
    if (!run || run.current_run_question_id !== input.questionId || run.voided || (run.snapshot as Snapshot).kind !== "typing") throw new AppError("현재 타자 게임이 아닙니다.", 409, "TYPING_CLOSED");
    const snapshot = run.snapshot as Snapshot;
    const rows = await tx`select * from public.typing_team_progress where run_question_id=${input.questionId} and team_id=${teamId} for update`;
    if (!rows.length) throw new AppError("게임 시작 전에 등록된 팀만 참가할 수 있습니다.", 403, "NOT_IN_RELAY");
    const progress = rows[0];
    if (input.action === "submit") {
      const duplicate = await tx`select result from public.typing_attempts where id=${input.requestId} and run_question_id=${input.questionId} and team_id=${teamId}`;
      if (duplicate.length) return duplicate[0].result as { correct: boolean; progress: TypingProgress; phrase: string | null };
    }
    const relay = (await tx`select *,clock_timestamp() as server_now from public.typing_runs where run_question_id=${input.questionId}`)[0];
    if (input.action === "ready") {
      if (run.phase !== "live" || relay.starts_at) throw new AppError("이미 시작한 게임입니다.", 409);
      await tx`update public.typing_team_progress set ready=true where run_question_id=${input.questionId} and team_id=${teamId}`;
      return { ready: true };
    }
    if (run.phase !== "live" || !relay.starts_at || relay.paused_at || new Date(relay.server_now).getTime() < new Date(relay.starts_at).getTime()) throw new AppError("아직 입력 시간이 아니거나 게임이 마감됐습니다.", 409, "TYPING_CLOSED");
    if (progress.completed_at || progress.turn !== input.turn || progress.version !== input.version) throw new AppError("차례가 변경됐습니다. 현재 진행 상태를 확인해 주세요.", 409, "STALE_TYPING");
    const value = normalizeTyping(input.value);
    if (!value || [...value].length > 200) throw new AppError("입력할 문장을 확인해 주세요.");
    const correct = value === normalizeTyping(snapshot.typing_phrases[input.turn]);
    const nextTurn = Number(progress.turn) + (correct ? 1 : 0);
    const mistakes = Number(progress.mistakes) + (correct ? 0 : 1);
    const complete = nextTurn === snapshot.typing_phrases.length;
    const elapsed = complete ? Math.max(0, new Date(relay.server_now).getTime() - new Date(relay.starts_at).getTime() - Number(relay.paused_ms)) : null;
    const resultMs = elapsed === null ? null : typingResult(elapsed, mistakes);
    const updated = await tx`update public.typing_team_progress set turn=${nextTurn},mistakes=${mistakes},version=version+1,completed_at=${complete ? relay.server_now : null},elapsed_ms=${elapsed},result_ms=${resultMs} where run_question_id=${input.questionId} and team_id=${teamId} returning *`;
    const result = { correct, progress: progressOf(updated[0]), phrase: complete ? null : snapshot.typing_phrases[nextTurn] };
    await tx`insert into public.typing_attempts(id,run_question_id,team_id,turn,value,correct,received_at,result) values (${input.requestId},${input.questionId},${teamId},${input.turn},${value},${correct},${relay.server_now},${tx.json({ ...result, progress: { ...result.progress } })})`;
    return result;
  });
}

export async function typingTransition(tx: TransactionSql, run: Record<string, unknown>, input: { action: string; reason?: string }, actorId: string) {
  const id = String(run.current_run_question_id);
  const relay = (await tx`select *,clock_timestamp() as server_now from public.typing_runs where run_question_id=${id}`)[0];
  const snapshot = (await tx`select snapshot from public.run_questions where id=${id}`)[0].snapshot as Snapshot;
  if (input.action === "startTyping") {
    if (run.phase !== "live" || relay.starts_at) throw new AppError("이미 시작한 게임입니다.", 409);
    const waiting = await tx`select 1 from public.typing_team_progress where run_question_id=${id} and ready=false limit 1`;
    if (waiting.length) throw new AppError("모든 팀이 준비 완료를 눌러야 시작할 수 있습니다.", 409, "WAITING_FOR_TEAMS");
    await tx`update public.typing_runs set starts_at=clock_timestamp()+interval '5 seconds' where run_question_id=${id}`;
  } else if (input.action === "pause") {
    if (run.phase !== "live" || !relay.starts_at || new Date(relay.server_now) < new Date(relay.starts_at)) throw new AppError("카운트다운이 끝난 뒤 일시정지할 수 있습니다.", 409);
    await tx`update public.typing_runs set paused_at=${relay.server_now} where run_question_id=${id}`;
  } else if (input.action === "resume") {
    if (run.phase !== "paused" || !relay.paused_at) throw new AppError("일시정지 상태가 아닙니다.", 409);
    await tx`update public.typing_runs set paused_ms=paused_ms+floor(extract(epoch from (${relay.server_now}::timestamptz-paused_at))*1000)::bigint,paused_at=null where run_question_id=${id}`;
  } else if (input.action === "close" || input.action === "forceClose") {
    if (!["live","paused"].includes(String(run.phase))) throw new AppError("진행 중인 게임만 마감할 수 있습니다.", 409);
    const waiting = await tx`select 1 from public.typing_team_progress where run_question_id=${id} and completed_at is null limit 1`;
    if (input.action === "close" && waiting.length) throw new AppError("모든 팀이 완료해야 마감할 수 있습니다.", 409, "WAITING_FOR_TEAMS");
    if (input.action === "forceClose" && !input.reason?.trim()) throw new AppError("강제 마감 사유를 입력해 주세요.");
    await tx`update public.typing_runs set close_reason=${input.reason?.trim() ?? null},closed_by=${actorId},paused_at=coalesce(paused_at,${relay.server_now}) where run_question_id=${id}`;
  } else if (input.action === "reveal") {
    if (run.phase !== "closed") throw new AppError("마감 후 결과를 공개할 수 있습니다.", 409);
    const rows = await tx`select * from public.typing_team_progress where run_question_id=${id} order by result_ms nulls last`;
    const best = rows.find(row => row.result_ms != null)?.result_ms;
    for (const team of rows) {
      const winner = best != null && team.result_ms === best;
      const points = winner && snapshot.typing_award_winner && !snapshot.practice ? 1 : 0;
      await tx`insert into public.grades(run_question_id,team_id,correct,points) values (${id},${team.team_id},${winner},${points})`;
      if (points) await tx`insert into public.score_entries(run_id,run_question_id,team_id,delta,reason,actor_id) values (${String(run.id)},${id},${team.team_id},1,'타자 릴레이 우승',${actorId})`;
    }
    await tx`update public.run_questions set graded_at=clock_timestamp() where id=${id}`;
  } else throw new AppError("타자 게임에서 사용할 수 없는 동작입니다.");
  const phase = ({ pause: "paused", resume: "live", close: "closed", forceClose: "closed", reveal: "graded", startTyping: "live" } as Record<string,string>)[input.action];
  const updated = await tx`update public.runs set phase=${phase},version=version+1 where id=${String(run.id)} returning version`;
  return { phase, version: Number(updated[0].version) };
}
