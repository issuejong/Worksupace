"use client";
import { formatPhase, rankTeams, secondsLeft } from "../../lib/client";
import { useGameState } from "../../lib/use-game-state";

export default function ScreenPage() {
  const { state, error, clock } = useGameState("screen");
  const left = state ? secondsLeft(state, clock) : null;
  const winners = state ? rankTeams(state.teams).filter(team => team.rank === 1) : [];
  return <main className="screen"><header className="screen-header"><div className="brand"><span className="brand-star">✦</span> UMC <span>NIGHT</span></div><span className="pill">{state ? formatPhase(state.phase) : "연결 중"}</span></header>
    <div className="screen-stage">{error && <p className="error">연결을 확인하고 잠시 기다려 주세요. {error}</p>}
      {!state ? <div className="loading">현장 화면을 준비하는 중...</div> : state.phase === "lobby" ? <><p className="eyebrow">DONGGUK UNIVERSITY · UMC</p><h1>우리의 밤,<br />우리 팀의 정답</h1><img className="logo-aco" src="/brand/aco-phone.png" alt="동국대학교 마스코트 아코" /><p>팀 대표는 참가 코드를 입력해 주세요.</p></> : state.phase === "finished" ? <><p className="eyebrow">FINAL RANKING</p><h1>{winners.length > 1 ? "공동 우승팀" : "오늘의 우승팀"}</h1><div className="result-answer">{winners.map(team => team.name).join(" · ")}</div><img className="logo-aco" src="/brand/aco-phone.png" alt="동국대학교 마스코트 아코" /></> : state.question ? <><p className="eyebrow">{state.question.roundTitle} · {state.question.practice ? "연습 문제" : `${state.question.points}점`}</p><p className="question-text">{state.question.prompt}</p>{state.question.imageUrl && <img className="question-image" src={state.question.imageUrl} alt="문제 이미지" />}
        {state.phase === "live" || state.phase === "paused" ? <>{state.question.kind !== "short" && <div className="screen-options">{state.question.options.map(option => <span className="pill" key={option}>{option}</span>)}</div>}{left !== null && <div className="timer">{left}s</div>}<p>{state.teams.filter(team => team.submitted).length} / {state.teams.length}팀 제출</p></> : state.phase === "closed" ? <h2>답변 마감! 정답은?</h2> : <><p>정답</p><div className="result-answer">{state.question.correctAnswer}</div>{state.question.revealImageUrl && <img className="question-image" src={state.question.revealImageUrl} alt="정답 이미지" />}</>}</> : <h1>잠시만 기다려 주세요</h1>}
      {state && <div className="screen-scoreboard">{rankTeams(state.teams).map(team => <div key={team.id}><strong>{team.rank}위 · {team.name}</strong><span className="score">{team.score}점</span></div>)}</div>}</div><footer className="screen-footer">UMC NIGHT · DONGGUK UNIVERSITY</footer></main>;
}
