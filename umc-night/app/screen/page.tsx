"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatPhase, rankTeams, secondsLeft } from "../../lib/client";
import { useGameState } from "../../lib/use-game-state";

export default function ScreenPage() {
  const { state, error, clock } = useGameState("screen");
  const [joinQr, setJoinQr] = useState("");
  useEffect(() => {
    const url = new URL("/join", window.location.origin).toString();
    void QRCode.toDataURL(url, { width: 288, margin: 2, errorCorrectionLevel: "M", color: { dark: "#241b18", light: "#fffdf9" } })
      .then(setJoinQr);
  }, []);
  const left = state ? secondsLeft(state, clock) : null;
  const winners = state ? rankTeams(state.teams).filter(team => team.rank === 1) : [];
  return <main className={state?.phase === "lobby" ? "screen screen-lobby" : "screen"}><header className="screen-header"><div className="brand"><span className="brand-star">✦</span> UMC <span>NIGHT</span></div><span className="pill">{state ? formatPhase(state.phase) : "연결 중"}</span></header>
    <div className="screen-stage">{error && <p className="error">연결을 확인하고 잠시 기다려 주세요. {error}</p>}
      {!state ? <div className="loading">현장 화면을 준비하는 중...</div> : state.phase === "lobby" ? <div className="screen-lobby-hero"><div className="screen-lobby-intro"><p className="eyebrow">DONGGUK UNIVERSITY · UMC</p><h1>UMC NIGHT</h1><img className="logo-aco" src="/brand/aco-phone.png" alt="동국대학교 마스코트 아코" /></div><div className="screen-lobby-qr">{joinQr && <img src={joinQr} alt="팀 등록 페이지 QR 코드" />}</div></div> : state.phase === "graded" && state.roundBreak ? <div className="screen-round-result"><p className="eyebrow">{state.question?.roundTitle} · ROUND RESULT</p><h1>중간 순위</h1><p className="result-answer">누적 정답 개수</p></div> : state.phase === "finished" ? <><p className="eyebrow">FINAL RANKING</p><h1>{winners.length > 1 ? "공동 우승팀" : "오늘의 우승팀"}</h1><div className="result-answer">{winners.map(team => team.name).join(" · ")}</div><img className="logo-aco" src="/brand/aco-phone.png" alt="동국대학교 마스코트 아코" /></> : state.question ? <><p className="eyebrow">{state.question.roundTitle} · {state.question.practice ? "연습 문제" : "퀴즈"}</p><p className="question-text">{state.question.prompt}</p>{state.question.imageUrl && <img className="question-image" src={state.question.imageUrl} alt="문제 이미지" />}
        {state.phase === "live" || state.phase === "paused" ? <>{state.question.kind !== "short" && <div className="screen-options">{state.question.options.map(option => <span className="pill" key={option}>{option}</span>)}</div>}{left !== null && <div className="timer">{left}s</div>}<p>{state.question.waitForAll ? state.teams.filter(team => team.required && team.submitted).length : state.teams.filter(team => team.submitted).length} / {state.question.waitForAll ? state.teams.filter(team => team.required).length : state.teams.length}팀 제출{state.question.waitForAll ? " · 전원 제출 후 마감" : ""}</p></> : state.phase === "closed" ? <h2>답변 마감! 정답은?</h2> : <><p>정답</p><div className="result-answer">{state.question.correctAnswer}</div>{state.question.revealImageUrl && <img className="question-image" src={state.question.revealImageUrl} alt="정답 이미지" />}</>}</> : <h1>잠시만 기다려 주세요</h1>}
      {state?.scoresVisible && <div className="screen-scoreboard">{rankTeams(state.teams).map(team => <div key={team.id}><strong>{team.rank}위 · {team.name}</strong><span className="score">{team.score}개</span></div>)}</div>}</div><footer className="screen-footer">UMC NIGHT · DONGGUK UNIVERSITY</footer></main>;
}
