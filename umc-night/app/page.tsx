import Link from "next/link";

export default function HomePage() {
  return <main className="home">
    <div className="orbit orbit-one" aria-hidden="true" /><div className="orbit orbit-two" aria-hidden="true" />
    <div className="home-content">
      <p className="eyebrow">DONGGUK UNIVERSITY · UMC</p>
      <div className="night-mark" aria-hidden="true">✦</div>
      <h1>UMC<span>NIGHT</span></h1>
      <p className="home-subtitle">우리의 밤, 우리 팀의 정답</p>
      <p className="home-description">팀원과 함께 풀고, 함께 빛나는 밤.<br />대표 한 명이 휴대폰으로 답안을 제출해 주세요.</p>
      <div className="home-actions"><Link className="button button-primary" href="/join">팀으로 참가하기 <span aria-hidden="true">↗</span></Link><Link className="button button-outline" href="/screen">현장 화면 보기</Link></div>
      <p className="home-meta">10.30 FRI · 20:00 · 3 TEAMS</p>
    </div>
    <img className="home-aco" src="/brand/aco-phone.png" alt="동국대학교 마스코트 아코" />
    <footer className="home-footer">동국대학교 UMC 동아리 행사 진행용 사이트 <Link href="/admin">진행자</Link></footer>
  </main>;
}
