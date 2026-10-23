export function normalizeTyping(value: string): string { return value.normalize("NFC").trim(); }
export function typingResult(elapsedMs: number, mistakes: number): number {
  return Math.round((Math.max(0, elapsedMs) + mistakes * 1000) / 10) * 10;
}
export function formatTypingTime(ms: number): string { return `${(Math.max(0, ms) / 1000).toFixed(2)}초`; }
export interface TypingProgress {
  teamId: string; ready: boolean; completed: boolean; turn: number; mistakes: number; version: number;
  completedAt: string | null; elapsedMs: number | null; resultMs: number | null;
}
export interface TypingState {
  startsAt: string | null; pausedAt: string | null; pausedMs: number; turns: number;
  phrase?: string; awardWinner: boolean; resultsVisible: boolean; voided: boolean;
  teams: TypingProgress[]; own: TypingProgress | null;
}
export function rankTyping(teams: TypingProgress[]): (TypingProgress & { rank: number | null })[] {
  let rank = 0; let previous: number | null = null;
  return [...teams].sort((a,b) => (a.resultMs ?? Infinity) - (b.resultMs ?? Infinity) || a.teamId.localeCompare(b.teamId)).map((team,index) => {
    if (team.resultMs === null) return { ...team, rank: null };
    if (previous !== team.resultMs) rank = index + 1;
    previous = team.resultMs;
    return { ...team, rank };
  });
}
