"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/client";

interface SetupTeam { id: string; number: number; name: string; }
interface Round { id: string; title: string; position: number; }
interface SetupQuestion { id: string; round_id: string; kind: "short" | "choice" | "ox"; prompt: string; options: string[]; correct_answer: string | null; answer_mode: "fixed" | "live"; duration_seconds: number; scoring_mode: "all_correct" | "first_correct"; wait_for_all: boolean; position: number; practice: boolean; active: boolean; image_path: string | null; reveal_image_path: string | null; }
interface Setup { teams: SetupTeam[]; rounds: Round[]; questions: SetupQuestion[]; }
const blank = { id: "", roundId: "", kind: "short" as SetupQuestion["kind"], prompt: "", options: "", correctAnswer: "", answerMode: "fixed" as SetupQuestion["answer_mode"], durationSeconds: 45, scoringMode: "all_correct" as SetupQuestion["scoring_mode"], waitForAll: false, position: 0, practice: false, active: true, imageId: null as string | null, revealImageId: null as string | null };
export default function SetupPage() {
  const [setup, setSetup] = useState<Setup | null>(null); const [error, setError] = useState(""); const [loadError, setLoadError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [roundTitle, setRoundTitle] = useState(""); const [roundId, setRoundId] = useState(""); const [roundPosition, setRoundPosition] = useState(0);
  const [teamId, setTeamId] = useState(""); const [teamName, setTeamName] = useState(""); const [question, setQuestion] = useState(blank);
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const refreshId = useRef(0);
  const questionFormRef = useRef<HTMLFormElement>(null);
  const draggedQuestion = useRef<{ id: string; roundId: string } | null>(null);
  const reorderPending = useRef(false);
  async function refresh() { const id = ++refreshId.current; try { const next = await api<Setup>("/api/admin/setup"); if (id === refreshId.current) { setSetup(next); setLoadError(""); } } catch (cause) { if (id === refreshId.current) setLoadError(cause instanceof Error ? cause.message : "불러오기에 실패했습니다."); } }
  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible" && !draggedQuestion.current && !reorderPending.current) void refresh(); }, 3000);
    const resume = () => { if (document.visibilityState === "visible" && !draggedQuestion.current && !reorderPending.current) void refresh(); };
    document.addEventListener("visibilitychange", resume); window.addEventListener("focus", resume); window.addEventListener("online", resume);
    return () => { window.clearInterval(poll); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume); window.removeEventListener("online", resume); };
  }, []);
  async function mutate(body: unknown) {
    setBusy(true); setNotice(""); setError("");
    try { await api("/api/admin/setup", body); setNotice((body as { action?: string }).action?.startsWith("delete") ? "삭제했습니다." : "저장했습니다."); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "저장에 실패했습니다."); return false; }
    finally { setBusy(false); }
  }
  async function upload(file: File, target: "imageId" | "revealImageId") {
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/media", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "이미지 업로드에 실패했습니다.");
      setQuestion(previous => ({ ...previous, [target]: data.id })); setNotice("이미지를 올렸습니다. 문제를 저장하면 연결됩니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "이미지 업로드에 실패했습니다."); }
    finally { setBusy(false); }
  }
  function edit(value: SetupQuestion) { setQuestion({ id: value.id, roundId: value.round_id, kind: value.kind, prompt: value.prompt, options: value.options.join("\n"), correctAnswer: value.correct_answer ?? "", answerMode: value.answer_mode, durationSeconds: value.duration_seconds, scoringMode: value.scoring_mode, waitForAll: value.wait_for_all, position: value.position, practice: value.practice, active: value.active, imageId: value.image_path, revealImageId: value.reveal_image_path }); questionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function editRound(value: Round) { setRoundId(value.id); setRoundTitle(value.title); setRoundPosition(value.position); }
  function clearRound() { setRoundId(""); setRoundTitle(""); setRoundPosition(0); }
  function editTeam(value: SetupTeam) { setTeamId(value.id); setTeamName(value.name); }
  function clearTeam() { setTeamId(""); setTeamName(""); }
  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault(); const { id, options, ...rest } = question;
    const saved = await mutate({ action: "question", ...(id ? { id } : {}), ...rest, options: options.split("\n").map(item => item.trim()).filter(Boolean) });
    if (saved) setQuestion({ ...blank, roundId: question.roundId });
  }
  function questionsInRound(id: string) { return setup?.questions.filter(item => item.round_id === id).sort((a, b) => a.position - b.position) ?? []; }
  function endQuestionDrag() { draggedQuestion.current = null; setDraggedQuestionId(null); setDropTarget(null); }
  async function reorderQuestions(roundId: string, questionIds: string[]) {
    if (!setup || busy || reorderPending.current) return;
    const expectedQuestionIds = questionsInRound(roundId).map(item => item.id);
    if (questionIds.every((id, index) => id === expectedQuestionIds[index])) return;
    const positions = new Map(questionIds.map((id, index) => [id, index]));
    const before = setup;
    reorderPending.current = true; refreshId.current++;
    setBusy(true); setError(""); setNotice("");
    setSetup({ ...setup, questions: setup.questions.map(item => item.round_id === roundId ? { ...item, position: positions.get(item.id) ?? item.position } : item) });
    try {
      await api("/api/admin/setup", { action: "reorderQuestions", roundId, questionIds, expectedQuestionIds });
      setQuestion(current => current.id && positions.has(current.id) ? { ...current, position: positions.get(current.id)! } : current);
      setNotice("문제 순서를 저장했습니다.");
      await refresh();
    } catch (cause) {
      setSetup(before);
      setError(cause instanceof Error ? cause.message : "문제 순서를 저장하지 못했습니다.");
      await refresh();
    } finally { reorderPending.current = false; setBusy(false); }
  }
  function moveQuestion(roundId: string, id: string, offset: number) {
    const ids = questionsInRound(roundId).map(item => item.id);
    const index = ids.indexOf(id); const next = index + offset;
    if (busy || index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void reorderQuestions(roundId, ids);
  }
  function dropQuestion(event: React.DragEvent<HTMLDivElement>, target: SetupQuestion) {
    const source = draggedQuestion.current;
    if (!source || source.roundId !== target.round_id) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    const ids = questionsInRound(target.round_id).map(item => item.id).filter(id => id !== source.id);
    const targetIndex = ids.indexOf(target.id);
    if (targetIndex >= 0) ids.splice(targetIndex + (after ? 1 : 0), 0, source.id);
    endQuestionDrag();
    if (targetIndex >= 0) void reorderQuestions(target.round_id, ids);
  }
  return <main className="app-shell"><header className="site-header"><Link href="/" className="brand"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">행사 준비</span></header><div className="content"><nav className="admin-nav"><Link href="/admin">진행자 홈</Link><Link href="/admin/live">게임 진행</Link><Link href="/screen" target="_blank">현장 화면 ↗</Link></nav><p className="section-label">BUILD THE NIGHT</p><h1 className="page-title">행사 준비</h1><p className="page-lede">팀 대표는 현장 화면의 QR을 스캔해 팀 이름을 등록합니다. 문제를 시작하면 내용과 정답 방식이 그 게임에 저장됩니다.</p>
    {loadError && <p className="error" role="alert">{loadError}</p>}{error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {!setup ? <div className="loading">설정 불러오는 중...</div> : <div className="stack"><section className="card"><h2>① 참가 팀 · {setup.teams.length}팀</h2><p className="subtle">현장 화면의 QR로 등록한 팀이 자동으로 표시됩니다. 팀 수 제한은 없습니다.</p><div className="list">{setup.teams.length ? setup.teams.map(team => <div className="list-item row between" key={team.id}><strong>{team.name}</strong><div className="row"><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => editTeam(team)}>이름 수정</button><button type="button" className="button button-small button-danger" disabled={busy} onClick={() => { if (window.confirm(`‘${team.name}’ 팀을 삭제할까요? 해당 팀의 접속도 해제됩니다.`)) void mutate({ action: "deleteTeam", id: team.id }).then(ok => { if (ok && teamId === team.id) clearTeam(); }); }}>삭제</button></div></div>) : <p className="subtle">아직 등록된 팀이 없습니다.</p>}</div>{teamId && <form className="row muted-border" style={{ marginTop: 18 }} onSubmit={event => { event.preventDefault(); void mutate({ action: "updateTeam", id: teamId, name: teamName }).then(ok => { if (ok) clearTeam(); }); }}><input value={teamName} onChange={event => setTeamName(event.target.value)} maxLength={32} required className="setup-input" aria-label="팀 이름" /><button className="button button-primary button-small" disabled={busy}>이름 저장</button><button type="button" className="button button-small button-plain" onClick={clearTeam}>취소</button></form>}</section>
      <section className="card"><h2>② 라운드 구성</h2><div className="list">{setup.rounds.map(round => <div className="list-item row between" key={round.id}><strong>{round.position + 1}. {round.title}</strong><div className="row"><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => editRound(round)}>편집</button><button type="button" className="button button-small button-danger" disabled={busy} onClick={() => { if (window.confirm(`‘${round.title}’ 라운드를 삭제할까요? 문제를 먼저 삭제하거나 이동해야 합니다.`)) void mutate({ action: "deleteRound", id: round.id }).then(ok => { if (ok && roundId === round.id) clearRound(); }); }}>삭제</button></div></div>)}</div><form className="row muted-border" style={{ marginTop: 18 }} onSubmit={event => { event.preventDefault(); void mutate({ action: "round", ...(roundId ? { id: roundId } : {}), title: roundTitle, position: roundId ? roundPosition : setup.rounds.length }).then(ok => { if (ok) clearRound(); }); }}><input value={roundTitle} onChange={event => setRoundTitle(event.target.value)} placeholder="예: 동국대 초성 퀴즈" required maxLength={80} className="setup-input" aria-label="라운드 이름" />{roundId && <input type="number" value={roundPosition} onChange={event => setRoundPosition(Number(event.target.value))} min={0} max={9999} required className="setup-input" aria-label="라운드 순서" />}<button className="button button-primary button-small" disabled={busy}>{roundId ? "라운드 저장" : "라운드 추가"}</button>{roundId && <button type="button" className="button button-small button-plain" onClick={clearRound}>취소</button>}</form></section>
      <section className="card"><h2>③ 문제 편집</h2>{!setup.rounds.length && <p className="subtle">먼저 라운드를 추가해 주세요.</p>}<form ref={questionFormRef} className="stack" onSubmit={saveQuestion}><div className="grid"><label className="field">라운드<select value={question.roundId} onChange={event => setQuestion({ ...question, roundId: event.target.value })} required><option value="">선택</option>{setup.rounds.map(round => <option key={round.id} value={round.id}>{round.title}</option>)}</select></label><label className="field">유형<select value={question.kind} onChange={event => setQuestion({ ...question, kind: event.target.value as SetupQuestion["kind"], correctAnswer: "" })}><option value="short">주관식</option><option value="choice">객관식</option><option value="ox">O/X</option></select></label></div>
        <label className="field">문제<textarea value={question.prompt} onChange={event => setQuestion({ ...question, prompt: event.target.value })} maxLength={500} required /></label>{question.kind === "choice" && <label className="field">보기 · 한 줄에 하나씩<textarea value={question.options} onChange={event => setQuestion({ ...question, options: event.target.value })} placeholder={"보기 1\n보기 2\n보기 3"} /></label>}
        <label className="field">정답 방식<select value={question.answerMode} onChange={event => setQuestion({ ...question, answerMode: event.target.value as SetupQuestion["answer_mode"], correctAnswer: "" })}><option value="fixed">미리 정답 입력</option><option value="live">현장에서 정답 선택</option></select></label>
        {question.answerMode === "fixed" && <label className="field">정답{question.kind === "ox" ? <select value={question.correctAnswer} onChange={event => setQuestion({ ...question, correctAnswer: event.target.value })} required><option value="">선택</option><option value="O">O</option><option value="X">X</option></select> : <input value={question.correctAnswer} onChange={event => setQuestion({ ...question, correctAnswer: event.target.value })} maxLength={120} required />}</label>}
        {question.answerMode === "live" && <p className="subtle small">답변 마감 후 진행자 화면에서 실제 정답을 정하고 공개합니다.</p>}
        <div className="grid"><label className="field">{question.waitForAll ? "제한 시간 · 전원 제출 시 미적용" : "제한 시간 · 초"}<input type="number" min={5} max={300} value={question.durationSeconds} onChange={event => setQuestion({ ...question, durationSeconds: Number(event.target.value) })} disabled={question.waitForAll} required /></label><label className="field">순서<input type="number" min={0} max={9999} value={question.position} onChange={event => setQuestion({ ...question, position: Number(event.target.value) })} required /></label></div>
        <label className="field">채점 방식<select value={question.scoringMode} onChange={event => setQuestion({ ...question, scoringMode: event.target.value as SetupQuestion["scoring_mode"] })}><option value="all_correct">정답 팀 모두 집계</option><option value="first_correct">첫 정답 팀만 집계</option></select></label>
        <label><input type="checkbox" checked={question.waitForAll} onChange={event => setQuestion({ ...question, waitForAll: event.target.checked })} /> 시작 당시 모든 팀이 제출해야 마감 가능 · 시간 제한 없음</label>
        <div className="grid"><label className="field">문제 이미지<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, "imageId"); }} />{question.imageId && <span className="success small">연결됨 · {question.imageId}</span>}</label><label className="field">정답 공개 이미지<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, "revealImageId"); }} />{question.revealImageId && <span className="success small">연결됨 · {question.revealImageId}</span>}</label></div>
        <div className="row"><label><input type="checkbox" checked={question.practice} onChange={event => setQuestion({ ...question, practice: event.target.checked })} /> 연습 문제 · 정답 개수 제외</label><label><input type="checkbox" checked={question.active} onChange={event => setQuestion({ ...question, active: event.target.checked })} /> 진행에 포함</label></div><div className="row"><button className="button button-primary" disabled={busy || !setup.rounds.length}>{question.id ? "문제 수정" : "문제 추가"}</button>{question.id && <button type="button" className="button button-plain" onClick={() => setQuestion(blank)}>편집 취소</button>}</div></form>
        <hr className="divider" />
        <h3>등록된 문제 · {setup.questions.length}개</h3>
        <p className="subtle small">왼쪽 손잡이를 드래그해 같은 라운드 안에서 순서를 바꾸세요. 키보드는 손잡이를 선택한 뒤 ↑/↓를 누르세요.</p>
        <div className="list question-order-list">{setup.rounds.flatMap(round => questionsInRound(round.id).map((item, index) =>
          <div
            className={`list-item question-order-item row between${draggedQuestionId === item.id ? " dragging" : ""}${dropTarget?.id === item.id ? (dropTarget.after ? " drop-after" : " drop-before") : ""}`}
            key={item.id}
            onDragOver={event => {
              if (draggedQuestion.current?.roundId !== round.id || draggedQuestion.current.id === item.id) return;
              event.preventDefault(); event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              const after = event.clientY >= rect.top + rect.height / 2;
              setDropTarget(current => current?.id === item.id && current.after === after ? current : { id: item.id, after });
            }}
            onDrop={event => dropQuestion(event, item)}
          >
            <button
              type="button"
              className="question-drag-handle"
              disabled={busy}
              aria-label={`${item.prompt} 순서 변경. 드래그하거나 위아래 화살표를 누르세요.`}
              title="드래그하여 순서 변경"
              draggable={!busy}
              onDragStart={event => {
                if (busy) { event.preventDefault(); return; }
                refreshId.current++;
                draggedQuestion.current = { id: item.id, roundId: round.id };
                setDraggedQuestionId(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }}
              onDragEnd={endQuestionDrag}
              onKeyDown={event => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault(); moveQuestion(round.id, item.id, event.key === "ArrowUp" ? -1 : 1);
                }
              }}
            >⠿</button>
            <span className="question-order-index" aria-hidden="true">{index + 1}</span>
            <div className="question-order-copy"><strong>{round.title} · {item.prompt}</strong><p className="subtle small" style={{ margin: "5px 0 0" }}>{item.kind.toUpperCase()} · {item.wait_for_all ? "전원 제출 대기" : `${item.duration_seconds}초`} · {item.answer_mode === "live" ? "현장 정답 선택" : "미리 정답 입력"} · {item.scoring_mode === "first_correct" ? "첫 정답 팀만 집계" : "정답 팀 모두 집계"} {item.practice ? "· 연습" : ""} {!item.active ? "· 제외" : ""}</p></div>
            <div className="row"><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => edit(item)}>편집</button><button type="button" className="button button-small button-danger" disabled={busy} onClick={() => { if (window.confirm("이 문제를 삭제할까요? 진행 기록에 사용된 문제는 삭제할 수 없습니다.")) void mutate({ action: "deleteQuestion", id: item.id }).then(ok => { if (ok && question.id === item.id) setQuestion(blank); }); }}>삭제</button></div>
          </div>
        ))}</div></section></div>}</div></main>;
}
