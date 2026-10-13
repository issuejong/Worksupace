"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/client";

export default function AdminPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { void api("/api/admin/setup").then(() => setSignedIn(true)).catch(() => {}); }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/auth", { action: "login", email, password }); setSignedIn(true); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "로그인에 실패했습니다."); }
    finally { setBusy(false); }
  }
  async function logout() { await api("/api/auth", { action: "logout" }); setSignedIn(false); setPassword(""); }
  return <main className="app-shell"><header className="site-header"><Link href="/" className="brand"><span className="brand-star">✦</span> UMC <span>NIGHT</span></Link><span className="header-note">진행자</span></header><div className="content narrow"><p className="section-label">HOST CONTROL</p><h1 className="page-title">진행자 센터</h1><p className="page-lede">문제를 준비하고, 현장 진행과 채점을 한 곳에서 관리하세요.</p>
    {signedIn ? <div className="stack"><Link className="card" href="/admin/setup"><h2>① 행사 준비 →</h2><p className="subtle">팀, 라운드, 문제, 이미지, 참가 코드를 관리합니다.</p></Link><Link className="card card-dark" href="/admin/live"><h2>② 게임 진행 →</h2><p>문제 시작, 타이머, 정답 공개, 채점, 결과 발표</p></Link><button className="button button-plain" onClick={logout}>로그아웃</button></div> : <form className="card stack" onSubmit={login}><h2>진행자 로그인</h2><label className="field">이메일<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label><label className="field">비밀번호<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>{error && <p className="error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy}>{busy ? "로그인 중..." : "로그인"}</button><p className="subtle">행사 진행자 계정으로 로그인해 주세요.</p></form>}</div></main>;
}
