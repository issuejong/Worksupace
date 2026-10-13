# UMC Night

동국대학교 UMC 동아리 MT에서 3팀이 함께 푸는 현장 퀴즈 사이트입니다. 진행자는 노트북에서 문제를 운영하고, 팀 대표는 휴대폰으로 답안을 제출하며, 대형 화면에는 문제와 공개된 결과가 나타납니다.

## 현재 구현

- 주관식·객관식·O/X, 문제·정답 공개 이미지, 라운드와 출제 순서
- 팀별 12자리 코드 참가, 대표 기기 세션, 답안 수정·재접속
- 문제 시작 → 답변 → 일시정지/재개 → 마감 → 정답 공개 → 채점 → 다음 문제/최종 순위
- 객관식·O/X 자동 채점, 주관식 진행자 판정, 정답이면 전액·오답이면 0점
- 점수 정정과 이력, 연습 문제, 리허설 모드와 초기화, 결과 JSON 다운로드
- 동점 공동 순위, 문제 무효 처리, 서버 기준 마감 시간, 공개 전 정답 숨김

## 로컬 실행

Node.js 22 이상을 권장합니다.

```bash
cd umc-night
npm ci
cp .env.example .env.local
npm run dev
```

`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`에 본인 Supabase 프로젝트 값을 넣어야 데이터 기능이 동작합니다. `DATABASE_URL`은 Supabase Postgres **Transaction pooler** 연결 문자열을 사용합니다. 모든 값은 서버 전용이며 `NEXT_PUBLIC_` 접두어를 붙이지 않습니다. `.env.local`과 실제 참가 코드는 커밋하지 않습니다.

1. Supabase 무료 프로젝트를 생성하고 SQL Editor에서 `supabase/migrations/202610140001_init.sql`을 실행합니다. `quiz-media` 비공개 Storage 버킷도 생성됩니다.
2. Supabase Authentication에서 진행자 계정을 만듭니다. 해당 사용자의 UUID를 확인하고 SQL Editor에서 `insert into public.host_users(user_id) values ('사용자-UUID');`를 실행합니다.
3. `npm run dev`로 실행한 뒤 `/admin`에서 로그인합니다. `/admin/setup`에서 3팀을 등록하고 생성된 코드를 각각 저장합니다. 코드는 생성 직후 한 번만 표시되며 DB에는 해시만 남습니다.
4. 라운드와 문제를 등록하고 `/admin/live`에서 연습 게임을 만든 뒤 `/join`, `/play`, `/screen`을 각각 확인합니다.

개발 시 `npm run typecheck`, `npm run build`, `npm test`를 실행합니다. 실제 DB 흐름 통합 테스트는 **비어 있는 별도 테스트 DB**에 마이그레이션을 적용한 후 `TEST_DATABASE_URL=postgresql://... npm test`로 실행합니다. 테스트는 기존 팀 데이터가 있으면 중단합니다.

## Vercel 배포

Vercel에 이 저장소를 연결하고 **Root Directory를 `umc-night`**로 설정합니다. 프레임워크는 Next.js를 선택합니다. `.env.example`의 4개 변수를 Vercel 프로젝트의 Environment Variables에 추가하고 배포합니다. 기본 `*.vercel.app` 주소를 사용하면 별도 도메인 비용이 필요 없습니다. Supabase 무료 플랜과 Vercel Hobby 사용량·약관이 행사 용도와 계정 상황에 맞는지 배포 전에 확인하세요. 이 저장소에는 실제 Supabase 프로젝트나 Vercel 프로젝트 연결 정보가 포함되지 않습니다.

10월 23일까지 실제 배포 주소에서 세 팀 대표 기기와 진행자 노트북, 16:9 대형 화면으로 전체 리허설을 끝내는 것을 목표로 합니다. 행사 당일에는 노트북 화면을 **확장**하고 `/admin/live`는 노트북에, `/screen`은 프로젝터에 띄웁니다. 인터넷이 끊기면 문제 진행을 멈추고 답안을 종이에 적어 둔 뒤 연결 복구 후 재개하세요. 네트워크 없이 자동으로 답안이 동기화되지는 않습니다.

## 권한과 데이터

브라우저는 데이터베이스에 직접 접근하지 않습니다. 서버가 Supabase Auth와 팀 쿠키를 확인한 뒤 PostgreSQL에 접근합니다. 정답과 이미지 공개 시점은 서버 응답으로 제어합니다. 답안·채점·점수는 DB에 저장되어 새로고침 후에도 유지됩니다. 실제 행사 기록은 UI에서 초기화할 수 없고, 연습 모드의 최근 실행만 초기화할 수 있습니다.

디자인 자산의 출처와 사용 조건은 [ASSETS.md](docs/ASSETS.md)를 확인하세요. 세부 요구사항과 계획은 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)에 기록되어 있습니다.
