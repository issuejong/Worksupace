export interface Team { id: string; number: number; name: string; score: number | null; submitted?: boolean; required?: boolean; answer?: string | null; correct?: boolean | null; earned?: number; }
export interface Question { id: string; prompt: string; kind: "short" | "choice" | "ox"; options: string[]; points: number; durationSeconds: number; scoringMode: "all_correct" | "first_correct"; waitForAll: boolean; practice: boolean; roundTitle: string; imageUrl: string | null; revealImageUrl: string | null; correctAnswer?: string; }
export interface GameState { phase: "lobby" | "live" | "paused" | "closed" | "revealed" | "graded" | "finished"; runId: string | null; mode?: string; version: number; serverNow: string; deadlineAt?: string | null; remainingSeconds?: number | null; scoresVisible: boolean; roundBreak: boolean; hasNextQuestion: boolean; question: Question | null; requiredTeamIds?: string[]; teams: Team[]; teamId?: string; ownAnswer?: { value: string; version: number } | null; history?: { id: string; team_id: string; run_question_id: string; delta: number; reason: string; created_at: string }[]; gradedQuestions?: { id: string; prompt: string; voided: boolean; grades: { teamId: string; correct: boolean; points: number; answer: string | null }[] }[]; }
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error ?? "요청에 실패했습니다.", response.status, data.code);
  return data as T;
}
export function formatPhase(phase: GameState["phase"]): string {
  return ({ lobby: "대기 중", live: "답변 중", paused: "일시정지", closed: "답변 마감", revealed: "정답 공개", graded: "채점 완료", finished: "최종 결과" })[phase];
}
export function rankTeams(teams: Team[]): (Team & { rank: number })[] {
  let rank = 0; let previous: number | null = null;
  return [...teams].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.number - b.number).map((team, index) => {
    if (previous !== (team.score ?? 0)) rank = index + 1;
    previous = team.score ?? 0;
    return { ...team, rank };
  });
}
export function secondsLeft(state: GameState, localNow: number): number | null {
  if (state.phase === "paused") return state.remainingSeconds ?? null;
  if (state.phase !== "live" || !state.deadlineAt) return null;
  return Math.max(0, Math.ceil((new Date(state.deadlineAt).getTime() - localNow) / 1000));
}
