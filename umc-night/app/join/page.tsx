"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/client";

export default function JoinPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ team: { id: string } | null }>("/api/join")
      .then(data => { if (data.team) router.replace("/play"); })
      .catch(cause => setError(cause instanceof Error ? cause.message : "접속 상태를 확인하지 못했습니다."))
      .finally(() => setLoading(false));
  }, [router]);
  async function join(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/join", { action: "join", name: name.trim() }); router.replace("/play"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "참가에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <main className="app-shell"><header className="site-header"><Link className="brand" href="/"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">팀 대표용</span></header>
    <div className="content narrow"><p className="section-label">JOIN THE NIGHT</p><h1 className="page-title">우리 팀 등록하기</h1><p className="page-lede">팀원들과 이름을 정한 뒤 대표 한 명이 입력해 주세요. 등록된 이름이 순위표에 표시됩니다.</p>
      <form className="card stack" onSubmit={join}><label className="field">우리 팀 이름<input value={name} onChange={event => setName(event.target.value)} maxLength={32} autoComplete="off" placeholder="팀원들과 정한 이름" required disabled={loading || busy} /></label>
        {error && <p className="error" role="alert">{error}</p>}<button className="button button-primary button-wide" disabled={loading || busy}>{loading ? "접속 상태 확인 중..." : busy ? "등록 중..." : "팀 등록하고 입장하기 →"}</button></form>
      <p className="subtle" style={{ marginTop: 20 }}>이 기기에서는 새로고침해도 팀 접속이 유지됩니다. 다른 기기에서 같은 이름으로 새 팀을 만들 수는 없습니다.</p><img className="join-aco" src="/brand/aco-phone.png" alt="휴대폰을 든 동국대학교 마스코트 아코" /></div></main>;
}
