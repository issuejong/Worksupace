"use client";
import type { GameState } from "../../lib/client";
import { TypingBoard } from "../components/typing-relay";

export function TypingControl({ state, clock, clockReady, busy, mutate }: { state: GameState; clock: number; clockReady: boolean; busy: boolean; mutate: (url: string, body: unknown) => Promise<boolean> }) {
  const relay = state.typing!;
  const allReady = relay.teams.every(team => team.ready);
  const allComplete = relay.teams.every(team => team.completed);
  const started = Boolean(relay.startsAt && clockReady && clock >= Date.parse(relay.startsAt));
  async function action(name: string, reason?: string) { await mutate("/api/run", { action: name, version: state.version, questionId: state.question?.id, ...(reason ? { reason } : {}) }); }
  return <><section className="card card-dark stack"><p className="section-label">TYPING RELAY</p><h2>{state.question?.prompt}</h2>
    <p>{state.question?.roundTitle} · {relay.turns}차례 · 오타 제출마다 +1초</p>
    <p>{relay.awardWinner && !state.question?.practice ? `공동 우승 포함, 우승팀 누적 점수 +${state.question?.points ?? 1}점` : "기록 대결 · 누적 점수에는 반영하지 않음"}</p>
    <div className="row">{state.phase === "live" && !relay.startsAt && <button className="button button-primary" disabled={busy || !allReady || !clockReady} onClick={() => void action("startTyping")}>전 팀 동시 시작 · 5초 카운트다운</button>}
      {state.phase === "live" && relay.startsAt && <button className="button button-outline" disabled={busy || !started} onClick={() => void action("pause")}>일시정지</button>}
      {state.phase === "paused" && <button className="button button-primary" disabled={busy} onClick={() => void action("resume")}>재개</button>}
      {(state.phase === "live" || state.phase === "paused") && <><button className="button button-primary" disabled={busy || !allComplete} onClick={() => void action("revealAndGrade")}>전 팀 완료 · 결과 공개</button><button className="button button-outline" disabled={busy} onClick={() => { const reason = window.prompt("미완료 팀은 DNF로 처리됩니다. 강제 마감 사유를 입력해 주세요."); if (reason?.trim()) void action("forceClose", reason.trim()); }}>강제 마감</button></>}
      {state.phase === "closed" && <button className="button button-primary" disabled={busy} onClick={() => void action("revealAndGrade")}>기록·순위 공개</button>}
      {state.phase === "graded" && <>{state.roundResultsPending && <button className="button button-primary" disabled={busy} onClick={() => void action("showRoundResults")}>{state.hasNextQuestion ? "중간 순위 공개" : "오늘의 우승팀은? 띄우기"}</button>}{state.hasNextQuestion && <button className="button button-primary" disabled={busy || state.roundResultsPending} onClick={() => void action("start")}>{state.roundBreak ? "다음 라운드 시작" : "다음 문제 시작"}</button>}<button className="button button-outline" disabled={busy} onClick={() => { if (window.confirm("행사 최종 결과를 공개할까요?")) void action("finish"); }}>최종 결과 공개</button></>}
      {!relay.voided && <button className="button button-outline" disabled={busy} onClick={() => { if (window.confirm("타자 게임을 무효 처리할까요? 이 게임의 누적 집계도 취소됩니다.")) void action("void"); }}>게임 무효</button>}
    </div>
    {!relay.startsAt && !relay.voided && <p>{relay.teams.filter(team => team.ready).length} / {relay.teams.length}팀 준비 완료 · 모바일에서 준비 완료를 눌러 주세요.</p>}
  </section><section className="card"><TypingBoard state={state} clock={clock} />{!relay.resultsVisible && <div className="list">{relay.teams.map(team => <p className="subtle small" key={team.teamId}>{state.teams.find(value => value.id === team.teamId)?.name} · {team.turn}/{relay.turns}차례 · 오타 {team.mistakes}회</p>)}</div>}</section></>;
}
