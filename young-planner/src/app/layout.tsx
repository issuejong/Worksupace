import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Afterfolio",
  description: "생활비와 연금, 보유 자산을 입력하고 은퇴 계획별 자금 전망을 비교하세요.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
