import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UMC Night | 동국대학교",
  description: "동국대학교 UMC 동아리 MT 레크레이션",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
