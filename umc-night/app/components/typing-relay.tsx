"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type GameState } from "../../lib/client";
import { formatTypingTime, rankTyping, type TypingProgress, type TypingState } from "../../lib/typing";

function Stopwatch({ relay, own, clock }: { relay: TypingState; own?: TypingProgress | null; clock: number }) {
  const elapsed = own?.elapsedMs ?? (relay.startsAt ? Math.max(0, (relay.pausedAt ? Date.parse(relay.pausedAt) : clock) - Date.parse(relay.startsAt) - relay.pausedMs) : 0);
  return <div className="typing-clock"><span>경과 시간</span><strong>{formatTypingTime(elapsed)}</strong>{own && <span className="typing-penalty">오타 벌칙 +{own.mistakes}초</span>}</div>;
}

export function TypingBoard({ state, clock }: { state: GameState; clock: number }) {
  const relay = state.typing;
  if (!relay) return null;
  const teams = relay.resultsVisible ? rankTyping(relay.teams) : relay.teams.map(team => ({ ...team, rank: null }));
  return <section className="typing-board stack" aria-label="타자 릴레이 팀별 현황">
    <div className="row between"><h2>{relay.voided ? "무효 처리된 게임" : relay.resultsVisible ? "타자 릴레이 결과" : "타자 릴레이"}</h2><span className="pill">{relay.turns}차례 · 오타 +1초</span></div>
    {!relay.resultsVisible && !relay.voided && <Stopwatch relay={relay} clock={clock} />}
    <div className="typing-team-grid">{teams.map(team => <div className={`typing-team${team.completed ? " complete" : ""}`} key={team.teamId}>
      <div className="row between"><strong>{state.teams.find(value => value.id === team.teamId)?.name ?? "팀"}</strong><span className="pill">{relay.resultsVisible ? team.rank ? `${team.rank}위` : "미완료" : team.completed ? "완료" : !relay.startsAt ? team.ready ? "준비 완료" : "준비 중" : `${team.turn} / ${relay.turns}`}</span></div>
      <progress value={team.turn} max={relay.turns} aria-label="완료한 차례" />
      {relay.resultsVisible && <><strong className="typing-result">{team.resultMs === null ? "DNF" : formatTypingTime(team.resultMs)}</strong><p className="subtle small">{team.elapsedMs === null ? `${team.turn}/${relay.turns}차례 완료` : `실제 ${formatTypingTime(team.elapsedMs)} + 벌칙 ${team.mistakes}초`}</p></>}
    </div>)}</div>
  </section>;
}

type Attempt = { action: "submit"; questionId: string; turn: number; version: number; value: string; requestId: string };
export function TypingPlay({ state, clock, clockReady, refresh }: { state: GameState; clock: number; clockReady: boolean; refresh: () => Promise<void> }) {
  const relay = state.typing!;
  const questionId = state.question!.id;
  const [local, setLocal] = useState<{ progress: TypingProgress; phrase: string | null } | null>(null);
  const own = local && local.progress.version > (relay.own?.version ?? -1) ? local.progress : relay.own;
  const phrase = local && local.progress.version > (relay.own?.version ?? -1) ? local.phrase : relay.phrase;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Attempt | null>(null);
  const composing = useRef(false);
  const sending = useRef(false);
  const storageKey = `umc-typing:${questionId}:${state.teamId}`;
  const draftKey = `${storageKey}:${own?.turn ?? 0}`;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try { setValue(sessionStorage.getItem(draftKey) ?? ""); } catch { setValue(""); }
  }, [draftKey]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`${storageKey}:pending`);
      if (saved) setPending(JSON.parse(saved) as Attempt);
    } catch { /* Storage is optional; the server remains authoritative. */ }
  }, [storageKey]);
  useEffect(() => {
    if (state.phase !== "live" && state.phase !== "paused") {
      try { for (let index = 0; index < relay.turns; index++) sessionStorage.removeItem(`${storageKey}:${index}`); sessionStorage.removeItem(`${storageKey}:pending`); } catch {}
      setPending(null);
    }
  }, [state.phase, storageKey, relay.turns]);
  function clearPending() { setPending(null); try { sessionStorage.removeItem(`${storageKey}:pending`); } catch {} }
  const beforeStart = !relay.startsAt || clock < Date.parse(relay.startsAt);
  const enabled = clockReady && state.phase === "live" && !beforeStart && !own?.completedAt && !relay.voided;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (composing.current || sending.current || !own || !enabled) return;
    sending.current = true; setBusy(true); setMessage("");
    const attempt: Attempt = pending ?? { action: "submit", questionId, turn: own.turn, version: own.version, value, requestId: crypto.randomUUID() };
    setPending(attempt);
    try { sessionStorage.setItem(`${storageKey}:pending`, JSON.stringify(attempt)); } catch {}
    try {
      const result = await api<{ correct: boolean; progress: TypingProgress; phrase: string | null }>("/api/typing", attempt);
      clearPending(); setLocal(result);
      if (result.correct) {
        try { sessionStorage.removeItem(draftKey); } catch {}
        setValue(""); setMessage(result.progress.completedAt ? "모든 차례 완료! 결과 공개를 기다려 주세요." : "정확해요! 다음 사람에게 휴대폰을 넘겨주세요.");
      } else setMessage("문장이 일치하지 않아요 · 벌칙 +1초. 같은 사람이 고쳐서 다시 제출해 주세요.");
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError) clearPending();
      setMessage(cause instanceof Error ? cause.message : "저장 여부를 확인할 수 없어요. 같은 요청으로 다시 시도해 주세요.");
      await refresh();
    } finally { sending.current = false; setBusy(false); }
  }
  async function ready() {
    if (sending.current) return; sending.current = true; setBusy(true); setMessage("");
    try { await api("/api/typing", { action: "ready", questionId }); await refresh(); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "준비 상태를 저장하지 못했어요."); }
    finally { sending.current = false; setBusy(false); }
  }
  if (!own) return <section className="card"><h2>다음 게임부터 참가할 수 있어요</h2><p>이 타자 게임을 열기 전에 등록된 팀이 참여합니다.</p></section>;
  if (relay.resultsVisible || relay.voided) return <section className="card"><TypingBoard state={state} clock={clock} /></section>;
  return <section className="card stack typing-play">
    <div className="row between"><span className="section-label">TYPING RELAY</span><span className="pill">{Math.min(own.turn + 1, relay.turns)} / {relay.turns}번째 차례</span></div>
    <h2>{state.question!.prompt}</h2>{!clockReady && <p className="subtle small" role="status">서버 시간 동기화 중...</p>}<Stopwatch relay={relay} own={own} clock={clock} />
    {own.completedAt ? <div className="typing-finished"><span>우리 팀 잠정 기록</span><strong>{formatTypingTime(own.resultMs!)}</strong><p>모두 수고했어요! 다른 팀의 완료를 기다려 주세요.</p></div> : <>
      <div className="typing-phrase"><span className="section-label">그대로 입력해 주세요</span><p>{phrase}</p></div>
      {!relay.startsAt ? <><p className="subtle">한 사람이 한 문장을 제출하고 폰을 넘겨주세요. 띄어쓰기·문장부호도 같아야 해요. 오타 제출마다 +1초, 고쳐서 제출하면 다음 차례로 넘어가요.</p><button className="button button-primary button-wide" disabled={busy || !clockReady || own.ready || state.phase !== "live"} onClick={() => void ready()}>{own.ready ? "준비 완료 · 진행자 시작 대기" : "준비 완료"}</button></> : <form className="stack" onSubmit={submit}>
        {beforeStart && <div className="typing-countdown" role="status">{Math.max(1, Math.ceil((Date.parse(relay.startsAt) - clock) / 1000))}</div>}
        {state.phase === "paused" && <p className="status-banner">일시정지 · 진행자가 재개하면 이어서 입력해 주세요.</p>}
        <label className="field">{own.turn + 1}번째 사람의 입력<textarea ref={inputRef} className="typing-input" value={value} maxLength={400} disabled={!enabled || busy || Boolean(pending)} placeholder="위 문장을 그대로 입력하세요" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" onPaste={event => { event.preventDefault(); setMessage("직접 타이핑해 주세요."); }} onDrop={event => event.preventDefault()} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!event.nativeEvent.isComposing && !composing.current) event.currentTarget.form?.requestSubmit(); } }} onChange={event => { setValue(event.target.value); try { sessionStorage.setItem(draftKey, event.target.value); } catch {} }} /></label>
        <button className="button button-primary button-wide typing-submit" disabled={!enabled || busy || (!pending && !value.trim())}>{busy ? "확인 중..." : pending ? "같은 제출 다시 확인하기" : "제출"}</button>
      </form>}
    </>}
    {state.phase === "closed" && !own.completedAt && <p className="status-banner">게임이 마감됐어요. 결과 공개를 기다려 주세요.</p>}
    {message && <p className="status-banner" role="status">{message}</p>}
    <p className="subtle small">실제 소요 시간 + 오타 제출 횟수 × 1초로 순위를 정해요. 휴대폰 전달 시간도 포함돼요.</p>
  </section>;
}
