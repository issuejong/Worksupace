import { z } from "zod";
import { db } from "./db";
import { hash, newTeamCode } from "./auth";
import { AppError } from "./errors";

const uuid = z.uuid();
const questionFields = z.object({
  roundId: uuid, kind: z.enum(["short", "choice", "ox"]),
  prompt: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
  correctAnswer: z.string().trim().min(1).max(120),
  points: z.number().int().min(1).max(1000),
  durationSeconds: z.number().int().min(5).max(300),
  position: z.number().int().min(0).max(9999).default(0),
  practice: z.boolean().default(false), active: z.boolean().default(true),
  imageId: uuid.nullable().default(null), revealImageId: uuid.nullable().default(null),
});

export async function setupState() {
  const sql = db();
  const [teams, rounds, questions] = await Promise.all([
    sql`select id,number,name from public.teams order by number`,
    sql`select id,title,position from public.rounds order by position,created_at`,
    sql`select id,round_id,kind,prompt,options,correct_answer,points,duration_seconds,position,practice,active,image_path,reveal_image_path from public.questions order by position,created_at`,
  ]);
  return { teams, rounds, questions };
}

export async function changeSetup(raw: unknown) {
  const input = z.discriminatedUnion("action", [
    z.object({ action: z.literal("team"), number: z.number().int().min(1).max(3), name: z.string().trim().min(1).max(32) }),
    z.object({ action: z.literal("rotateCode"), teamId: uuid }),
    z.object({ action: z.literal("round"), id: uuid.optional(), title: z.string().trim().min(1).max(80), position: z.number().int().min(0).max(9999) }),
    z.object({ action: z.literal("question"), id: uuid.optional(), ...questionFields.shape }),
    z.object({ action: z.literal("deleteQuestion"), id: uuid }),
    z.object({ action: z.literal("deleteRound"), id: uuid }),
  ]).parse(raw);
  const sql = db();
  if (input.action === "team") {
    const existing = await sql`select id,number,name from public.teams where number=${input.number}`;
    if (existing.length) {
      const rows = await sql`update public.teams set name=${input.name} where number=${input.number} returning id,number,name`;
      return { team: rows[0], code: null };
    }
    const code = newTeamCode();
    const rows = await sql`insert into public.teams(number,name,code_hash) values (${input.number},${input.name},${hash(code)}) returning id,number,name`;
    return { team: rows[0], code: code };
  }
  if (input.action === "rotateCode") {
    const code = newTeamCode();
    const rows = await sql`update public.teams set code_hash=${hash(code)} where id=${input.teamId} returning id,name`;
    if (!rows.length) throw new AppError("팀을 찾지 못했습니다.", 404);
    await sql`update public.team_sessions set revoked_at=now() where team_id=${input.teamId} and revoked_at is null`;
    return { team: rows[0], code };
  }
  if (input.action === "round") {
    const rows = input.id
      ? await sql`update public.rounds set title=${input.title},position=${input.position} where id=${input.id} returning id`
      : await sql`insert into public.rounds(title,position) values (${input.title},${input.position}) returning id`;
    if (!rows.length) throw new AppError("라운드를 찾지 못했습니다.", 404);
    return { id: rows[0].id };
  }
  if (input.action === "question") {
    const { id, roundId, kind, prompt, options, correctAnswer, points, durationSeconds, position, practice, active, imageId, revealImageId } = input;
    const effectiveOptions = kind === "ox" ? ["O", "X"] : kind === "short" ? [] : options;
    if (kind === "choice" && effectiveOptions.length < 2) throw new AppError("객관식은 보기가 2개 이상 필요합니다.");
    if (kind !== "short" && !effectiveOptions.includes(correctAnswer)) throw new AppError("정답이 보기에 있어야 합니다.");
    const rows = id
      ? await sql`update public.questions set round_id=${roundId},kind=${kind},prompt=${prompt},options=${sql.json(effectiveOptions)},correct_answer=${correctAnswer},points=${points},duration_seconds=${durationSeconds},position=${position},practice=${practice},active=${active},image_path=${imageId},reveal_image_path=${revealImageId} where id=${id} returning id`
      : await sql`insert into public.questions(round_id,kind,prompt,options,correct_answer,points,duration_seconds,position,practice,active,image_path,reveal_image_path) values (${roundId},${kind},${prompt},${sql.json(effectiveOptions)},${correctAnswer},${points},${durationSeconds},${position},${practice},${active},${imageId},${revealImageId}) returning id`;
    if (!rows.length) throw new AppError("문제를 찾지 못했습니다.", 404);
    return { id: rows[0].id };
  }
  if (input.action === "deleteQuestion") {
    const rows = await sql`delete from public.questions where id=${input.id} returning id`;
    if (!rows.length) throw new AppError("문제를 찾지 못했습니다.", 404);
    return { deleted: true };
  }
  const rows = await sql`delete from public.rounds where id=${input.id} returning id`;
  if (!rows.length) throw new AppError("라운드를 찾지 못했습니다.", 404);
  return { deleted: true };
}
