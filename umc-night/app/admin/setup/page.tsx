"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/client";
import { TeamReset } from "../team-reset";
import { QuestionImage } from "../question-image";
import { YouTubeVideo } from "../../components/youtube-video";
import { formatVideoTime, parseYouTubeVideo } from "../../../lib/youtube";
import { prepareQuizImage } from "../../../lib/quiz-image";

interface SetupTeam { id: string; number: number; name: string; }
interface Round { id: string; title: string; position: number; }
interface SetupQuestion { id: string; round_id: string; kind: "short" | "choice" | "ox" | "typing"; typing_phrases: string[]; typing_award_winner: boolean; prompt: string; options: string[]; correct_answer: string | null; answer_mode: "fixed" | "live" | "manual"; duration_seconds: number; points: number; scoring_mode: "all_correct" | "first_correct"; wait_for_all: boolean; position: number; practice: boolean; active: boolean; image_path: string | null; reveal_image_path: string | null; youtube_video_id: string | null; youtube_start_seconds: number; }
interface Setup { teams: SetupTeam[]; rounds: Round[]; questions: SetupQuestion[]; }
const blank = { youtubeUrl: "", youtubeStart: "", id: "", roundId: "", kind: "short" as SetupQuestion["kind"], prompt: "", options: "", typingPhrases: ["", "", "", "", ""], typingAwardWinner: false, correctAnswer: "", answerMode: "manual" as SetupQuestion["answer_mode"], durationSeconds: 45, points: 1, scoringMode: "all_correct" as SetupQuestion["scoring_mode"], waitForAll: false, position: 0, practice: false, active: true, imageId: null as string | null, revealImageId: null as string | null };
export default function SetupPage() {
  const [setup, setSetup] = useState<Setup | null>(null); const [error, setError] = useState(""); const [loadError, setLoadError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  const [roundTitle, setRoundTitle] = useState(""); const [roundId, setRoundId] = useState(""); const [roundPosition, setRoundPosition] = useState(0);
  const [teamId, setTeamId] = useState(""); const [teamName, setTeamName] = useState(""); const [question, setQuestion] = useState(blank);
  const [videoPreview, setVideoPreview] = useState(false);
  useEffect(() => { setVideoPreview(false); }, [question.youtubeUrl, question.youtubeStart, question.id]);
  let previewVideo = null; let videoError = "";
  try { previewVideo = parseYouTubeVideo(question.youtubeUrl, question.youtubeStart); } catch (cause) { videoError = cause instanceof Error ? cause.message : "영상 설정을 확인해 주세요."; }
  const [questionRoundFilter, setQuestionRoundFilter] = useState("");
  const questionListRef = useRef<HTMLElement>(null);
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
      const prepared = await prepareQuizImage(file);
      const form = new FormData(); form.set("file", prepared);
      const response = await fetch("/api/media", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "이미지 업로드에 실패했습니다.");
      setQuestion(previous => ({ ...previous, [target]: data.id })); setNotice("이미지를 올렸습니다. 문제를 저장하면 연결됩니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "이미지 업로드에 실패했습니다."); }
    finally { setBusy(false); }
  }
  function edit(value: SetupQuestion) { setQuestion({ id: value.id, roundId: value.round_id, kind: value.kind, typingPhrases: value.typing_phrases?.length ? value.typing_phrases : ["", "", "", "", ""], typingAwardWinner: value.typing_award_winner ?? false, prompt: value.prompt, options: value.options.join("\n"), correctAnswer: value.correct_answer ?? "", answerMode: value.answer_mode, durationSeconds: value.duration_seconds, points: value.points ?? 1, scoringMode: value.scoring_mode, waitForAll: value.wait_for_all, position: value.position, practice: value.practice, active: value.active, imageId: value.image_path, revealImageId: value.reveal_image_path, youtubeUrl: value.youtube_video_id ? `https://youtu.be/${value.youtube_video_id}` : "", youtubeStart: value.youtube_video_id ? formatVideoTime(value.youtube_start_seconds ?? 0) : "" }); questionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  function editRound(value: Round) { setRoundId(value.id); setRoundTitle(value.title); setRoundPosition(value.position); }
  function clearRound() { setRoundId(""); setRoundTitle(""); setRoundPosition(0); }
  function editTeam(value: SetupTeam) { setTeamId(value.id); setTeamName(value.name); }
  function clearTeam() { setTeamId(""); setTeamName(""); }
  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    if (question.kind !== "typing" && videoError) { setError(videoError); return; }
    const { id, options, ...rest } = question;
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
  const activeRoundFilter = setup?.rounds.some(round => round.id === questionRoundFilter) ? questionRoundFilter : "";
  return <main className="app-shell"><header className="site-header"><Link href="/" className="brand"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">행사 준비</span></header><div className="content"><nav className="admin-nav"><Link href="/admin">진행자 홈</Link><Link href="/admin/live">게임 진행</Link><Link href="/screen" target="_blank">현장 화면 ↗</Link></nav><p className="section-label">BUILD THE NIGHT</p><h1 className="page-title">행사 준비</h1><p className="page-lede">팀 대표는 현장 화면의 QR을 스캔해 팀 이름을 등록합니다. 문제를 시작하면 내용과 정답 방식이 그 게임에 저장됩니다.</p>
    {loadError && <p className="error" role="alert">{loadError}</p>}{error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {!setup ? <div className="loading">설정 불러오는 중...</div> : <div className="stack"><section className="card"><h2>① 참가 팀 · {setup.teams.length}팀</h2><p className="subtle">현장 화면의 QR로 등록한 팀이 자동으로 표시됩니다. 팀 수 제한은 없습니다.</p><div className="list">{setup.teams.length ? setup.teams.map(team => <div className="list-item row between" key={team.id}><strong>{team.name}</strong><div className="row"><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => editTeam(team)}>이름 수정</button><button type="button" className="button button-small button-danger" disabled={busy} onClick={() => { if (window.confirm(`‘${team.name}’ 팀을 삭제할까요? 해당 팀의 접속도 해제됩니다.`)) void mutate({ action: "deleteTeam", id: team.id }).then(ok => { if (ok && teamId === team.id) clearTeam(); }); }}>삭제</button></div></div>) : <p className="subtle">아직 등록된 팀이 없습니다.</p>}</div>{teamId && <form className="row muted-border" style={{ marginTop: 18 }} onSubmit={event => { event.preventDefault(); void mutate({ action: "updateTeam", id: teamId, name: teamName }).then(ok => { if (ok) clearTeam(); }); }}><input value={teamName} onChange={event => setTeamName(event.target.value)} maxLength={32} required className="setup-input" aria-label="팀 이름" /><button className="button button-primary button-small" disabled={busy}>이름 저장</button><button type="button" className="button button-small button-plain" onClick={clearTeam}>취소</button></form>}</section>
      <TeamReset disabled={busy} onBusyChange={setBusy} onReset={async () => { clearTeam(); setError(""); setNotice(""); await refresh(); }} />
      <section className="card"><h2>② 라운드 구성</h2><div className="list">{setup.rounds.map(round => <div className="list-item row between" key={round.id}><strong>{round.position + 1}. {round.title}</strong><div className="row"><button type="button" className="button button-small button-plain" onClick={() => { setQuestionRoundFilter(round.id); questionListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>문제 보기 · {questionsInRound(round.id).length}개</button><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => editRound(round)}>편집</button><button type="button" className="button button-small button-danger" disabled={busy} onClick={() => { if (window.confirm(`‘${round.title}’ 라운드를 삭제할까요? 문제를 먼저 삭제하거나 이동해야 합니다.`)) void mutate({ action: "deleteRound", id: round.id }).then(ok => { if (ok && roundId === round.id) clearRound(); }); }}>삭제</button></div></div>)}</div><form className="row muted-border" style={{ marginTop: 18 }} onSubmit={event => { event.preventDefault(); void mutate({ action: "round", ...(roundId ? { id: roundId } : {}), title: roundTitle, position: roundId ? roundPosition : setup.rounds.length }).then(ok => { if (ok) clearRound(); }); }}><input value={roundTitle} onChange={event => setRoundTitle(event.target.value)} placeholder="예: 동국대 초성 퀴즈" required maxLength={80} className="setup-input" aria-label="라운드 이름" />{roundId && <input type="number" value={roundPosition} onChange={event => setRoundPosition(Number(event.target.value))} min={0} max={9999} required className="setup-input" aria-label="라운드 순서" />}<button className="button button-primary button-small" disabled={busy}>{roundId ? "라운드 저장" : "라운드 추가"}</button>{roundId && <button type="button" className="button button-small button-plain" onClick={clearRound}>취소</button>}</form></section>
      <section className="card"><div className="row between"><h2>③ 문제 편집</h2><button type="button" className="button button-small button-plain" disabled={busy || !setup.rounds.length} onClick={() => { setQuestion({ ...blank, roundId: question.roundId || setup.rounds[0]?.id || "", prompt: "눈·코·입의 주인공은 누구일까요?" }); setNotice("문제 사진을 올려 주세요. 팀은 이름을 텍스트로 제출하고, 진행자가 팀별 정답·오답을 직접 판정합니다."); setError(""); questionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>눈코입 퀴즈 새로 만들기</button></div>{!setup.rounds.length && <p className="subtle">먼저 라운드를 추가해 주세요.</p>}<form ref={questionFormRef} className="stack" onSubmit={saveQuestion}><div className="grid"><label className="field">라운드<select value={question.roundId} onChange={event => setQuestion({ ...question, roundId: event.target.value })} required><option value="">선택</option>{setup.rounds.map(round => <option key={round.id} value={round.id}>{round.title}</option>)}</select></label><label className="field">유형<select value={question.kind} onChange={event => setQuestion({ ...question, kind: event.target.value as SetupQuestion["kind"], answerMode: event.target.value === "short" ? "manual" : question.answerMode === "manual" ? "fixed" : question.answerMode, correctAnswer: "" })}><option value="short">주관식</option><option value="choice">객관식</option><option value="ox">O/X</option><option value="typing">타자 릴레이</option></select></label></div>
        <label className="field">{question.kind === "typing" ? "게임 제목" : "문제"}<textarea value={question.prompt} onChange={event => setQuestion({ ...question, prompt: event.target.value })} maxLength={500} required /></label>{question.kind === "choice" && <label className="field">보기 · 한 줄에 하나씩<textarea value={question.options} onChange={event => setQuestion({ ...question, options: event.target.value })} placeholder={"보기 1\n보기 2\n보기 3"} /></label>}
        {question.kind === "typing" ? <div className="stack typing-editor">
          <div className="grid"><label className="field">공통 차례 수 · 모든 팀 동일<input type="number" min={1} max={10} value={question.typingPhrases.length} onChange={event => { const count = Math.max(1, Math.min(10, Number(event.target.value) || 1)); setQuestion({ ...question, typingPhrases: Array.from({ length: count }, (_, index) => question.typingPhrases[index] ?? "") }); }} /></label><label className="field">순서<input type="number" min={0} max={9999} value={question.position} onChange={event => setQuestion({ ...question, position: Number(event.target.value) })} required /></label></div>
          <p className="subtle">한 사람당 한 문장을 정확히 제출하고 휴대폰을 넘깁니다. 오타 제출마다 +1초, 정확히 고쳐야 다음 차례로 넘어갑니다.</p>
          {question.typingPhrases.map((phrase, index) => <div className="typing-editor-row" key={index}><label className="field">{index + 1}번째 문장<input value={phrase} maxLength={200} required placeholder="참가자가 그대로 입력할 문장" onChange={event => setQuestion({ ...question, typingPhrases: question.typingPhrases.map((value, i) => i === index ? event.target.value : value) })} /></label><div className="row"><button type="button" className="button button-small button-plain" disabled={index === 0} aria-label={`${index + 1}번째 문장 위로`} onClick={() => { const phrases = [...question.typingPhrases]; [phrases[index - 1], phrases[index]] = [phrases[index], phrases[index - 1]]; setQuestion({ ...question, typingPhrases: phrases }); }}>↑</button><button type="button" className="button button-small button-plain" disabled={index === question.typingPhrases.length - 1} aria-label={`${index + 1}번째 문장 아래로`} onClick={() => { const phrases = [...question.typingPhrases]; [phrases[index + 1], phrases[index]] = [phrases[index], phrases[index + 1]]; setQuestion({ ...question, typingPhrases: phrases }); }}>↓</button><button type="button" className="button button-small button-danger" disabled={question.typingPhrases.length === 1} aria-label={`${index + 1}번째 문장 삭제`} onClick={() => setQuestion({ ...question, typingPhrases: question.typingPhrases.filter((_, i) => i !== index) })}>삭제</button></div></div>)}
          <button type="button" className="button button-plain" disabled={!question.typingPhrases[0].trim()} onClick={() => setQuestion({ ...question, typingPhrases: question.typingPhrases.map(() => question.typingPhrases[0]) })}>첫 문장을 전체 차례에 적용</button>
          <label><input type="checkbox" checked={question.typingAwardWinner} onChange={event => setQuestion({ ...question, typingAwardWinner: event.target.checked })} /> 우승팀 점수를 누적 점수에 반영 · 공동 우승팀 모두 적용</label>
          <div className="typing-phrase"><span className="section-label">모바일 문장 미리보기</span><p>{question.typingPhrases[0] || "여기에 첫 문장이 표시됩니다."}</p></div>
        </div> : <>        <label className="field">정답 방식<select value={question.answerMode} onChange={event => setQuestion({ ...question, answerMode: event.target.value as SetupQuestion["answer_mode"], correctAnswer: "" })}><option value="fixed">미리 정답 입력</option><option value="live">현장에서 정답 선택</option>{question.kind === "short" && <option value="manual">팀별 직접 판정</option>}</select></label>
        {question.answerMode === "fixed" && <label className="field">정답{question.kind === "ox" ? <select value={question.correctAnswer} onChange={event => setQuestion({ ...question, correctAnswer: event.target.value })} required><option value="">선택</option><option value="O">O</option><option value="X">X</option></select> : <input value={question.correctAnswer} onChange={event => setQuestion({ ...question, correctAnswer: event.target.value })} maxLength={120} required />}</label>}
        {question.answerMode === "manual" && <><p className="subtle small">텍스트 답안을 받아 팀마다 정답·오답을 직접 선택합니다. 자동 정답 판정은 하지 않습니다.</p><label className="field">공개할 정답 · 선택<input value={question.correctAnswer} onChange={event => setQuestion({ ...question, correctAnswer: event.target.value })} maxLength={120} placeholder="비워 두어도 진행할 수 있어요" /></label></>}{question.answerMode === "live" && <p className="subtle small">진행 중에도 실제 정답을 미리 선택하고, 공개와 채점을 한 번에 처리합니다.</p>}
        <div className="grid"><label className="field">{question.waitForAll ? "제한 시간 · 전원 제출 시 미적용" : "제한 시간 · 초"}<input type="number" min={5} max={300} value={question.durationSeconds} onChange={event => setQuestion({ ...question, durationSeconds: Number(event.target.value) })} disabled={question.waitForAll} required /></label><label className="field">순서<input type="number" min={0} max={9999} value={question.position} onChange={event => setQuestion({ ...question, position: Number(event.target.value) })} required /></label></div>
        <label className="field">채점 방식<select value={question.scoringMode} onChange={event => setQuestion({ ...question, scoringMode: event.target.value as SetupQuestion["scoring_mode"] })}><option value="all_correct">정답 팀 모두 집계</option><option value="first_correct">첫 정답 팀만 집계</option></select></label>
        <label><input type="checkbox" checked={question.waitForAll} onChange={event => setQuestion({ ...question, waitForAll: event.target.checked })} /> 시작 당시 모든 팀이 제출해야 마감 가능 · 시간 제한 없음</label>
        <div className="grid"><QuestionImage label="문제 사진" description="눈·코·입만 잘라둔 사진을 올려 주세요. 문제를 시작하면 현장 화면과 참가자 휴대폰에 표시됩니다." imageId={question.imageId} disabled={busy} onUpload={file => upload(file, "imageId")} onRemove={() => setQuestion({ ...question, imageId: null })} /><QuestionImage label="정답 공개 사진 · 선택" description="전체 얼굴이나 원본 사진을 올려 주세요. 진행자가 정답을 공개할 때만 참가자에게 표시됩니다." imageId={question.revealImageId} disabled={busy} onUpload={file => upload(file, "revealImageId")} onRemove={() => setQuestion({ ...question, revealImageId: null })} /></div>
        <p className="subtle small">사진을 올리거나 연결 해제한 뒤 아래 문제 추가·수정 버튼을 눌러야 저장됩니다.</p>
        <section className="question-video-editor stack" aria-label="유튜브 영상 설정"><h3>유튜브 영상 · 선택</h3><p className="subtle small">현장 화면에서 재생합니다. 참가자 휴대폰에서는 답안만 제출합니다.</p><div className="grid"><label className="field">유튜브 링크<input type="url" value={question.youtubeUrl} maxLength={2048} placeholder="https://youtu.be/..." onChange={event => setQuestion({ ...question, youtubeUrl: event.target.value })} /></label><label className="field">재생 시작 시간<input type="text" value={question.youtubeStart} maxLength={30} placeholder="예: 1:20 또는 80" onChange={event => setQuestion({ ...question, youtubeStart: event.target.value })} /><span className="subtle small">비워 두면 링크의 시작 시간 적용 · 없으면 0:00</span></label></div>{videoError && <p className="error">{videoError}</p>}{previewVideo && <><div className="row"><span className="pill">{formatVideoTime(previewVideo.startSeconds)}부터 재생</span><button type="button" className="button button-small button-plain" onClick={() => setVideoPreview(value => !value)}>{videoPreview ? "미리보기 닫기" : "영상 미리보기"}</button><button type="button" className="button button-small button-danger" onClick={() => setQuestion({ ...question, youtubeUrl: "", youtubeStart: "" })}>영상 연결 해제</button></div>{videoPreview && <YouTubeVideo key={`${previewVideo.videoId}:${previewVideo.startSeconds}`} video={previewVideo} />}</>}<p className="subtle small">문제를 저장하면 적용됩니다. 현장 화면에서 영상 재생을 누르면 설정한 시간부터 시작하며, 퀴즈 제한 시간은 문제 시작부터 흐릅니다.</p></section>
        </>}
        <label className="field">{question.kind === "typing" ? "우승팀 배점 · 점" : "정답 배점 · 점"}<input type="number" min={1} max={1000} step={1} value={question.points} onChange={event => setQuestion({ ...question, points: Number(event.target.value) })} disabled={question.kind === "typing" && !question.typingAwardWinner} required /></label>
        <p className="subtle small">1~1,000점으로 설정합니다. 타자 릴레이는 우승팀 점수 반영을 켜면 적용됩니다. 문제를 시작한 뒤 수정한 배점은 다음 실행부터 적용됩니다.</p>
        <div className="row"><label><input type="checkbox" checked={question.practice} onChange={event => setQuestion({ ...question, practice: event.target.checked })} /> 연습 문제 · 점수 제외</label><label><input type="checkbox" checked={question.active} onChange={event => setQuestion({ ...question, active: event.target.checked })} /> 진행에 포함</label></div><div className="row"><button className="button button-primary" disabled={busy || !setup.rounds.length}>{question.id ? "문제 수정" : "문제 추가"}</button>{question.id && <button type="button" className="button button-plain" disabled={busy} onClick={() => setQuestion(blank)}>편집 취소</button>}</div></form>
        <hr className="divider" />
        <section ref={questionListRef} className="question-library" aria-labelledby="question-library-title">
        <div className="row between question-library-toolbar"><h3 id="question-library-title">등록된 문제 · {setup.questions.length}개</h3><label className="field question-round-filter">라운드별 보기<select value={activeRoundFilter} onChange={event => { endQuestionDrag(); setQuestionRoundFilter(event.target.value); }} disabled={busy}><option value="">전체 라운드</option>{setup.rounds.map(round => <option value={round.id} key={round.id}>{round.title} · {questionsInRound(round.id).length}개</option>)}</select></label></div>
        <p className="subtle small">라운드 안에서 왼쪽 손잡이를 드래그해 문제 순서를 바꾸세요. 키보드는 손잡이를 선택한 뒤 ↑/↓를 누르세요.</p>
        <div className="stack question-round-groups">{setup.rounds.filter(round => !activeRoundFilter || round.id === activeRoundFilter).map(round => {
          const items = questionsInRound(round.id);
          return <section className="question-round-group" key={round.id} aria-labelledby={`question-round-${round.id}`}><header className="question-round-heading"><div><span className="question-round-number">ROUND {round.position + 1}</span><h4 id={`question-round-${round.id}`}>{round.title}</h4></div><span className="pill">{items.length}개</span></header>{!items.length ? <p className="subtle question-round-empty">이 라운드에 등록된 문제가 없습니다.</p> : <div className="list question-order-list">{items.map((item, index) =>
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
            <div className="question-order-copy"><strong>{item.prompt}</strong><p className="subtle small" style={{ margin: "5px 0 0" }}>{item.kind === "typing" ? `타자 릴레이 · ${item.typing_phrases.length}차례 · 오타 +1초${item.typing_award_winner ? ` · 우승팀 +${item.points}점` : " · 기록 대결"}` : <>{item.kind.toUpperCase()} · {item.points}점 · {item.wait_for_all ? "전원 제출 대기" : `${item.duration_seconds}초`} · {item.answer_mode === "manual" ? "팀별 직접 판정" : item.answer_mode === "live" ? "현장 정답 선택" : "미리 정답 입력"} · {item.scoring_mode === "first_correct" ? "첫 정답 팀만 집계" : "정답 팀 모두 집계"} </>} {item.practice ? "· 연습" : ""} {!item.active ? "· 제외" : ""}</p></div>
            <div className="row"><button type="button" className="button button-small button-plain" disabled={busy} onClick={() => edit(item)}>편집</button><button type="button" className="button button-small button-danger" disabled={busy} onClick={() => { if (window.confirm("이 문제를 삭제할까요? 진행 기록에 사용된 문제는 삭제할 수 없습니다.")) void mutate({ action: "deleteQuestion", id: item.id }).then(ok => { if (ok && question.id === item.id) setQuestion(blank); }); }}>삭제</button></div>
          </div>
        )}</div>}</section>;
        })}</div>{!setup.rounds.length && <p className="subtle">라운드를 추가하면 이곳에 문제 목록이 표시됩니다.</p>}</section></section></div>}</div></main>;
}
