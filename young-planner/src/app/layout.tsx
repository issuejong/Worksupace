import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'Young Planner | 은퇴의 다음 장',description:'은퇴자금 시나리오 비교와 AI 분석'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
