import { NextRequest } from "next/server";
import { hostRoute } from "../../../lib/server/auth";
import { db } from "../../../lib/server/db";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return hostRoute(request, async () => {
    const sql = db();
    const runs = await sql`select id,mode,phase,created_at,finished_at from public.runs order by created_at desc limit 1`;
    if (!runs.length) return { run: null, teams: [], questions: [], answers: [], grades: [], scoreEntries: [] };
    const run = runs[0];
    const [teams, questions, answers, grades, scoreEntries] = await Promise.all([
      sql`select id,number,name from public.teams order by number`,
      sql`select id,question_id,snapshot,voided,graded_at,started_at from public.run_questions where run_id=${run.id} order by started_at`,
      sql`select a.run_question_id,a.team_id,a.value,a.updated_at from public.answers a join public.run_questions rq on rq.id=a.run_question_id where rq.run_id=${run.id}`,
      sql`select g.* from public.grades g join public.run_questions rq on rq.id=g.run_question_id where rq.run_id=${run.id}`,
      sql`select team_id,run_question_id,delta,reason,created_at from public.score_entries where run_id=${run.id} order by created_at`,
    ]);
    return { run, teams, questions, answers, grades, scoreEntries };
  });
}
