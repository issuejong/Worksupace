import Link from "next/link";

export default function HomePage() {
  return <main className="home">
    <div className="orbit orbit-one" aria-hidden="true" /><div className="orbit orbit-two" aria-hidden="true" />
    <div className="home-content">
      <p className="eyebrow">DONGGUK UNIVERSITY · UMC</p>
      <div className="night-mark" aria-hidden="true">✦</div>
      <h1>UMC <span>NIGHT</span></h1>
      <div className="home-actions"><Link className="button button-primary" href="/join">팀으로 참가하기 <span aria-hidden="true">↗</span></Link><Link className="button button-outline" href="/screen">현장 화면 보기</Link></div>
      <p className="home-meta">10.30 FRI · 20:00</p>
    </div>
    <img className="home-aco" src="/brand/aco-phone.png" alt="동국대학교 마스코트 아코" />
    <footer className="home-footer">동국대학교 UMC 동아리 행사 진행용 사이트 <Link href="/admin">진행자</Link></footer>
  </main>;
}
