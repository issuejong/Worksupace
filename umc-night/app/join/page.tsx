"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/client";

interface JoinTeam { id: string; number: number; name: string; }
export default function JoinPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<JoinTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamId, setTeamId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api<{ teams: JoinTeam[] }>("/api/join").then(data => { setTeams(data.teams); setTeamId(data.teams[0]?.id ?? ""); }).catch(cause => setError(cause.message)).finally(() => setLoading(false)); }, []);
  async function join(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/join", { action: "join", teamId, code: code.toUpperCase().trim() }); router.push("/play"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "참가에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <main className="app-shell"><header className="site-header"><Link className="brand" href="/"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">팀 대표용</span></header>
    <div className="content narrow"><p className="section-label">JOIN THE NIGHT</p><h1 className="page-title">우리 팀으로 참가하기</h1><p className="page-lede">팀원들과 의논한 뒤 대표 한 명이 답안을 제출해 주세요. 진행자에게 받은 12자리 참가 코드가 필요해요.</p>
      <form className="card stack" onSubmit={join}><label className="field">팀 선택<select value={teamId} onChange={event => setTeamId(event.target.value)} required>{teams.length ? teams.map(team => <option value={team.id} key={team.id}>{team.number}팀 · {team.name}</option>) : <option value="">{loading ? "팀을 불러오는 중" : "등록된 팀이 없습니다"}</option>}</select></label>
        <label className="field">참가 코드<input value={code} onChange={event => setCode(event.target.value.toUpperCase())} maxLength={12} minLength={12} autoCapitalize="characters" autoComplete="off" placeholder="진행자에게 받은 12자리 코드" required /></label>
        {error && <p className="error" role="alert">{error}</p>}<button className="button button-primary button-wide" disabled={busy || !teamId}>{busy ? "확인 중..." : "입장하기 →"}</button></form>
      <p className="subtle" style={{ marginTop: 20 }}>새로고침해도 팀 세션이 유지됩니다. 코드가 바뀌면 다시 입장해 주세요.</p><img className="join-aco" src="/brand/aco-phone.png" alt="휴대폰을 든 동국대학교 마스코트 아코" /></div></main>;
}
