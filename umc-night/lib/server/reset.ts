import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { db } from "./db";
import { AppError } from "./errors";

async function preview(sql: Sql | TransactionSql) {
  const teams = await sql`select id from public.teams order by id`;
  const runs = await sql`select id,version from public.runs order by id`;
  const snapshot = createHash("sha256").update(JSON.stringify({ teams, runs })).digest("hex");
  return { teamCount: teams.length, gameCount: runs.length, snapshot };
}

export function resetPreview() { return preview(db()); }

export async function resetTeamsAndGames(snapshot: string) {
  try {
    return await db().begin(async tx => {
      // Registration uses this same lock. In-flight game/device mutations must
      // finish first; NOWAIT rolls the reset back instead of risking deadlocks.
      await tx`select pg_advisory_xact_lock(20261014,1)`;
      await tx`lock table public.runs,public.run_questions,public.answers,public.answer_requests,public.grades,public.score_entries,public.typing_runs,public.typing_team_progress,public.typing_attempts,public.teams,public.team_sessions,public.team_transfers in exclusive mode nowait`;
      const current = await preview(tx);
      if (snapshot !== current.snapshot) throw new AppError("팀이나 게임 상태가 변경됐습니다. 초기화 내용을 다시 확인해 주세요.",409,"RESET_CHANGED");
      // Cascades remove play records and device sessions. Question definitions,
      // rounds, media, host permissions and join rate limits are preserved.
      await tx`delete from public.runs`;
      await tx`delete from public.teams`;
      return { reset: true, deletedTeams: current.teamCount, deletedGames: current.gameCount };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "55P03") throw new AppError("다른 요청을 처리 중입니다. 잠시 뒤 다시 초기화해 주세요.",409,"RESET_BUSY");
    throw error;
  }
}
