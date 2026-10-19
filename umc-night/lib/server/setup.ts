import { z } from "zod";
import { db } from "./db";
import { AppError } from "./errors";

const uuid = z.uuid();
const questionFields = z.object({
  roundId: uuid, kind: z.enum(["short", "choice", "ox"]),
  prompt: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  correctAnswer: z.string().trim().max(120).default(""),
  answerMode: z.enum(["fixed", "live"]).default("fixed"),
  points: z.number().int().min(1).max(1000),
  durationSeconds: z.number().int().min(5).max(300),
  scoringMode: z.enum(["all_correct", "first_correct"]).default("all_correct"),
  waitForAll: z.boolean().default(false),
  position: z.number().int().min(0).max(9999).default(0),
  practice: z.boolean().default(false), active: z.boolean().default(true),
  imageId: uuid.nullable().default(null), revealImageId: uuid.nullable().default(null),
});

export async function setupState() {
  const sql = db();
  const [teams, rounds, questions] = await Promise.all([
    sql`select id,number,name from public.teams order by number`,
    sql`select id,title,position from public.rounds order by position,created_at`,
    sql`select id,round_id,kind,prompt,options,correct_answer,answer_mode,points,duration_seconds,scoring_mode,wait_for_all,position,practice,active,image_path,reveal_image_path from public.questions order by position,created_at`,
  ]);
  return { teams, rounds, questions };
}

export async function changeSetup(raw: unknown) {
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("updateTeam"), id: uuid, name: z.string().trim().min(1).max(32) }),
    z.object({ action: z.literal("deleteTeam"), id: uuid }),
    z.object({ action: z.literal("round"), id: uuid.optional(), title: z.string().trim().min(1).max(80), position: z.number().int().min(0).max(9999) }),
    z.object({ action: z.literal("question"), id: uuid.optional(), ...questionFields.shape }),
    z.object({ action: z.literal("deleteQuestion"), id: uuid }),
    z.object({ action: z.literal("deleteRound"), id: uuid }),
  ]).parse(raw);
  const sql = db();
  if (input.action === "updateTeam") {
    return sql.begin(async tx => {
      // Share the join lock so a simultaneous registration cannot claim this name.
      await tx`select pg_advisory_xact_lock(20261014, 1)`;
      const existing = await tx`select id from public.teams where id=${input.id} for update`;
      if (!existing.length) throw new AppError("팀을 찾지 못했습니다.", 404);
      const duplicate = await tx`select id from public.teams where lower(name)=lower(${input.name}) and id<>${input.id} limit 1`;
      if (duplicate.length) throw new AppError("이미 등록된 팀 이름입니다.", 409, "TEAM_NAME_TAKEN");
      await tx`update public.teams set name=${input.name} where id=${input.id}`;
      return { id: input.id };
    });
  }
  if (input.action === "deleteTeam") {
    return sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(20261014, 1)`;
      const existing = await tx`select id from public.teams where id=${input.id} for update`;
      if (!existing.length) throw new AppError("팀을 찾지 못했습니다.", 404);
      const active = await tx`select id from public.runs where phase <> 'finished' limit 1`;
      if (active.length) throw new AppError("진행 중인 게임이 있어 팀을 삭제할 수 없습니다. 게임을 마친 뒤 다시 시도해 주세요.", 409, "RUN_ACTIVE");
      const used = await tx`select 1 from public.answers where team_id=${input.id} union all select 1 from public.grades where team_id=${input.id} union all select 1 from public.score_entries where team_id=${input.id} limit 1`;
      if (used.length) throw new AppError("답안이나 점수 기록이 있는 팀은 삭제할 수 없습니다. 연습 기록은 초기화한 뒤 다시 시도해 주세요.", 409, "TEAM_HAS_HISTORY");
      await tx`delete from public.teams where id=${input.id}`;
      return { deleted: true };
    });
  }
  if (input.action === "round") {
    const rows = input.id
      ? await sql`update public.rounds set title=${input.title},position=${input.position} where id=${input.id} returning id`
      : await sql`insert into public.rounds(title,position) values (${input.title},${input.position}) returning id`;
    if (!rows.length) throw new AppError("라운드를 찾지 못했습니다.", 404);
    return { id: rows[0].id };
  }
  if (input.action === "question") {
    const { id, roundId, kind, prompt, options, correctAnswer, answerMode, points, durationSeconds, scoringMode, waitForAll, position, practice, active, imageId, revealImageId } = input;
    const effectiveOptions = kind === "ox" ? ["O", "X"] : kind === "short" ? [] : options;
    if (kind === "choice" && effectiveOptions.length < 2) throw new AppError("객관식은 보기가 2개 이상 필요합니다.");
    if (answerMode === "fixed" && !correctAnswer) throw new AppError("미리 정답을 정하는 문제는 정답을 입력해 주세요.");
    if (answerMode === "fixed" && kind !== "short" && !effectiveOptions.includes(correctAnswer)) throw new AppError("정답이 보기에 있어야 합니다.");
    const storedAnswer = answerMode === "live" ? null : correctAnswer;
    const rows = id
      ? await sql`update public.questions set round_id=${roundId},kind=${kind},prompt=${prompt},options=${sql.json(effectiveOptions)},correct_answer=${storedAnswer},answer_mode=${answerMode},points=${points},duration_seconds=${durationSeconds},scoring_mode=${scoringMode},wait_for_all=${waitForAll},position=${position},practice=${practice},active=${active},image_path=${imageId},reveal_image_path=${revealImageId} where id=${id} returning id`
      : await sql`insert into public.questions(round_id,kind,prompt,options,correct_answer,answer_mode,points,duration_seconds,scoring_mode,wait_for_all,position,practice,active,image_path,reveal_image_path) values (${roundId},${kind},${prompt},${sql.json(effectiveOptions)},${storedAnswer},${answerMode},${points},${durationSeconds},${scoringMode},${waitForAll},${position},${practice},${active},${imageId},${revealImageId}) returning id`;
    if (!rows.length) throw new AppError("문제를 찾지 못했습니다.", 404);
    return { id: rows[0].id };
  }
  if (input.action === "deleteQuestion") {
    const used = await sql`select 1 from public.run_questions where question_id=${input.id} limit 1`;
    if (used.length) throw new AppError("진행 기록에 사용된 문제는 삭제할 수 없습니다. 연습 기록은 초기화한 뒤 다시 시도해 주세요.", 409, "QUESTION_HAS_HISTORY");
    const rows = await sql`delete from public.questions where id=${input.id} returning id`;
    if (!rows.length) throw new AppError("문제를 찾지 못했습니다.", 404);
    return { deleted: true };
  }
  const questions = await sql`select 1 from public.questions where round_id=${input.id} limit 1`;
  if (questions.length) throw new AppError("라운드의 문제를 먼저 삭제하거나 다른 라운드로 옮겨 주세요.", 409, "ROUND_HAS_QUESTIONS");
  const rows = await sql`delete from public.rounds where id=${input.id} returning id`;
  if (!rows.length) throw new AppError("라운드를 찾지 못했습니다.", 404);
  return { deleted: true };
}
