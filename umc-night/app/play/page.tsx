"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatPhase, rankTeams, secondsLeft } from "../../lib/client";
import { useGameState } from "../../lib/use-game-state";

export default function PlayPage() {
  const { state, error, clock, refresh } = useGameState("team");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!state?.question) return;
    if (editing !== state.question.id) { setEditing(state.question.id); setValue(state.ownAnswer?.value ?? ""); setMessage(""); }
  }, [state?.question?.id, state?.ownAnswer?.value, editing]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!state) return;
    setBusy(true); setMessage("");
    try {
      await api("/api/answer", { value, requestId: crypto.randomUUID(), expectedVersion: state.ownAnswer?.version ?? 0 });
      setMessage("답안이 저장됐어요. 마감 전까지 수정할 수 있어요."); await refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "저장에 실패했습니다."); await refresh(); }
    finally { setBusy(false); }
  }
  const ownTeam = state?.teams.find(team => team.id === state.teamId);
  const left = state ? secondsLeft(state, clock) : null;
  return <main className="app-shell"><header className="site-header"><Link className="brand" href="/"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">{ownTeam?.name ?? "팀 참가"}</span></header>
    <div className="content narrow"><p className="section-label">TEAM PLAY</p><h1 className="page-title">{ownTeam?.name ?? "우리 팀"}</h1>
      {error && <p className="error" role="alert">{error} {error.includes("참가") && <Link href="/join">다시 참가하기</Link>}</p>}
      {!state && !error && <div className="loading">게임을 불러오는 중...</div>}
      {state && <div className="stack"><div className="row between"><span className="pill">{state.roundBreak ? "라운드 결과" : formatPhase(state.phase)}</span>{state.scoresVisible && <strong className="score">{ownTeam?.score ?? 0}점</strong>}</div>
        {state.question && state.phase !== "lobby" && state.phase !== "finished" && !state.roundBreak ? <section className="card stack"><div className="row between"><span className="section-label">{state.question.roundTitle} · {state.question.practice ? "연습 문제" : `${state.question.points}점`} · {state.question.scoringMode === "first_correct" ? "첫 정답만 득점" : "정답 팀 모두 득점"}</span>{left !== null && <span className="timer" aria-label={`남은 시간 ${left}초`}>{left}s</span>}</div>
          {state.question.waitForAll && <p className="subtle small">모든 팀이 답안을 제출할 때까지 기다립니다. 시간 제한은 없습니다.</p>}<h2 className="question-text">{state.question.prompt}</h2>{state.question.imageUrl && <img className="question-image" src={state.question.imageUrl} alt="퀴즈 문제 이미지" />}
          {state.phase === "live" ? <form className="stack" onSubmit={submit}>{state.question.kind === "short" ? <label className="field">우리 팀 답안<input value={value} onChange={event => setValue(event.target.value)} maxLength={300} placeholder="팀원들과 의논한 정답" required /></label> : <div className="option-grid">{state.question.options.map(option => <button type="button" className={`option ${value === option ? "selected" : ""}`} key={option} onClick={() => setValue(option)}>{option}</button>)}</div>}
              <button className="button button-primary button-wide" disabled={busy || !value || left === 0}>{busy ? "저장 중..." : state.ownAnswer ? "답안 수정하기" : "답안 제출하기"}</button>{state.ownAnswer && <p className="success">저장된 답안: <strong>{state.ownAnswer.value}</strong></p>}{message && <p className={message.includes("저장") ? "success" : "error"} role="status">{message}</p>}</form> : <div className="status-banner">{state.phase === "paused" ? "진행자가 잠시 멈췄어요. 곧 다시 시작합니다." : state.phase === "closed" ? "답변이 마감됐어요. 정답을 기다려 주세요." : <>정답: <strong>{state.question.correctAnswer}</strong>{state.question.revealImageUrl && <img className="question-image" src={state.question.revealImageUrl} alt="정답 설명 이미지" />}</>}</div>}
        </section> : <section className="card"><h2>{state.phase === "finished" ? "오늘의 최종 순위" : state.roundBreak ? "중간 순위" : "곧 시작합니다"}</h2><p className="subtle">{state.phase === "finished" ? "팀원 모두 수고했어요!" : state.roundBreak ? "이번 라운드가 끝났습니다. 현재까지의 누적 점수를 확인해 주세요." : "진행자가 시작하면 이 화면에 문제가 나타나요."}</p></section>}
        {state.scoresVisible && <section className="card"><h2>팀 순위</h2><div className="list">{rankTeams(state.teams).map(team => <div className="list-item row between" key={team.id}><div className="team-chip"><span className="team-dot">{team.rank}</span><strong>{team.name}</strong></div><strong>{team.score}점</strong></div>)}</div></section>}
      </div>}</div></main>;
}
