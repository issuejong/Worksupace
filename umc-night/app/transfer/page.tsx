"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../lib/client";

interface TransferTeam { id: string; number: number; name: string; }

export default function TransferPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [team, setTeam] = useState<TransferTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (!value) { setError("기기 이전 QR을 다시 스캔해 주세요."); setLoading(false); return; }
    setToken(value);
    void api<{ team: TransferTeam }>("/api/transfer", { action: "inspect", token: value })
      .then(result => setTeam(result.team))
      .catch(cause => setError(cause instanceof Error ? cause.message : "QR을 확인하지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  async function transfer() {
    setBusy(true); setError("");
    try { await api("/api/transfer", { action: "redeem", token }); router.replace("/play"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "기기를 연결하지 못했습니다."); setBusy(false); }
  }

  return <main className="app-shell"><header className="site-header"><Link className="brand" href="/"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">대표 기기 교체</span></header>
    <div className="content narrow"><p className="section-label">TEAM TRANSFER</p><h1 className="page-title">대표 기기 교체</h1><div className="card stack">{loading ? <p>팀을 확인하는 중...</p> : team ? <><h2>{team.name}</h2><p className="subtle">이 기기를 새 대표 휴대폰으로 연결합니다. 기존 대표 기기는 연결이 해제되고, 팀 점수와 답안은 그대로 유지됩니다.</p><button className="button button-primary button-wide" disabled={busy} onClick={() => void transfer()}>{busy ? "연결 중..." : "이 기기로 이어하기"}</button></> : <p className="subtle">진행자에게 새 기기 이전 QR을 요청해 주세요.</p>}{error && <p className="error" role="alert">{error}</p>}</div></div></main>;
}
