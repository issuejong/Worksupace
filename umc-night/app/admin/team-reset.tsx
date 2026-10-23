"use client";
import { useRef, useState } from "react";
import { api, type GameState } from "../../lib/client";

interface Preview { teamCount: number; gameCount: number; snapshot: string; }
export function TeamReset({ disabled, onBusyChange, onReset }: { disabled: boolean; onBusyChange: (busy: boolean) => void; onReset: (state: GameState) => void | Promise<void> }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const pending = useRef(false);
  async function inspect() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice(""); setConfirmation("");
    try { setPreview(await api<Preview>("/api/admin/reset")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "초기화할 정보를 확인하지 못했습니다."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function reset(event: React.FormEvent) {
    event.preventDefault();
    if (!preview || confirmation !== "팀 초기화" || pending.current) return;
    pending.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await api<{ state: GameState }>("/api/admin/reset", { confirmation, snapshot: preview.snapshot });
      setPreview(null); setConfirmation(""); setNotice("팀과 게임 기록을 초기화했습니다. 문제는 그대로 유지됩니다.");
      await onReset(result.state);
    } catch (cause) {
      setPreview(null); setConfirmation("");
      setError(cause instanceof Error ? cause.message : "초기화하지 못했습니다. 내용을 다시 확인해 주세요.");
    } finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  return <section className="card stack" aria-label="팀·게임 초기화"><h2>팀·게임 초기화</h2><p className="subtle">모든 팀·접속정보·답안·점수·게임 기록을 삭제하고 QR 대기화면으로 돌아갑니다. 등록한 문제·라운드·이미지는 유지됩니다.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="success" role="status">{notice}</p>}
    {preview ? <form className="stack" onSubmit={reset}><p className="error">팀 {preview.teamCount}개와 게임 {preview.gameCount}개의 기록을 삭제합니다. 진행 중인 게임도 중단되며 되돌릴 수 없습니다.</p><label className="field">계속하려면 ‘팀 초기화’를 입력하세요<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy || disabled} placeholder="팀 초기화" required /></label><div className="row"><button className="button button-danger" disabled={busy || disabled || confirmation !== "팀 초기화"}>{busy ? "초기화 중..." : "모든 팀·게임 기록 삭제"}</button><button type="button" className="button button-plain" disabled={busy || disabled} onClick={() => { setPreview(null); setConfirmation(""); }}>취소</button></div></form> : <div><button type="button" className="button button-danger" disabled={disabled || busy} onClick={() => void inspect()}>{busy ? "확인 중..." : "팀·게임 초기화"}</button></div>}
  </section>;
}
