# UMC Night

동국대학교 UMC 동아리 MT를 위한 현장 퀴즈 사이트입니다. 진행자는 노트북에서 문제를 운영하고, 팀 대표는 휴대폰으로 답안을 제출하며, 대형 화면에는 문제와 공개된 결과가 나타납니다.

## 현재 구현

- 주관식·객관식·O/X, 문제·정답 공개 이미지, 라운드와 출제 순서
- 현장 화면 QR 참가, 팀 대표가 이름을 입력하면 자동 등록, 팀 수 제한 없음, 답안 수정·재접속
- 진행자 화면에서 5분짜리 일회용 대표 기기 이전 QR 발급. 새 기기 연결 시 기존 세션만 해제하고 팀·답안·점수 유지
- 현장·진행 화면은 2초 간격, 행사 준비 목록은 3초 간격으로 자동 갱신
- 진행자가 팀 이름·라운드·문제를 수정하거나 삭제 가능. 답안·점수 기록이 있는 팀과 진행 기록에 사용된 문제는 삭제 차단
- 문제 시작 → 답변 → 일시정지/재개 → 마감 → 정답 공개 → 채점 → 다음 문제/최종 순위
- 객관식·O/X 자동 채점, 주관식 진행자 판정, 정답이면 전액·오답이면 0점
- 진행 중 점수는 진행자에게만 표시하고, 각 라운드 마지막 문제 채점 후 현장·참가자 화면에 누적 순위 공개
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

`DATABASE_URL`, `DATABASE_PASSWORD`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`에 본인 Supabase 프로젝트 값을 넣어야 데이터 기능이 동작합니다. `DATABASE_URL`은 Supabase Postgres **Session pooler** 연결 문자열(포트 5432)에서 비밀번호 부분을 뺀 값이며, `DATABASE_PASSWORD`는 프로젝트 생성 때 정한 비밀번호를 그대로 넣습니다. 모든 값은 서버 전용이며 `NEXT_PUBLIC_` 접두어를 붙이지 않습니다. `.env.local`은 커밋하지 않습니다.

1. Supabase 무료 프로젝트를 생성하고 SQL Editor에서 `supabase/migrations/202610140001_init.sql`, `supabase/migrations/202610150001_qr_join.sql`, `supabase/migrations/202610150002_team_transfer.sql` 순서로 실행합니다. `quiz-media` 비공개 Storage 버킷도 생성됩니다.
2. Supabase Authentication에서 진행자 계정을 만듭니다. 해당 사용자의 UUID를 확인하고 SQL Editor에서 `insert into public.host_users(user_id) values ('사용자-UUID');`를 실행합니다.
3. `npm run dev`로 실행한 뒤 `/admin`에서 로그인합니다. `/screen`의 QR을 띄우면 팀 대표가 `/join`으로 접속해 이름을 입력하고 자동 등록합니다. 한 팀당 대표 기기 하나를 사용하며, 같은 이름은 중복 등록할 수 없습니다.
4. 라운드와 문제를 등록하고 `/admin/live`에서 연습 게임을 만든 뒤 `/join`, `/play`, `/screen`을 각각 확인합니다.
5. 대표 휴대폰을 바꿔야 하면 진행자 노트북의 `/admin/live`에서 해당 팀의 `기기 이전 QR`을 발급하고 새 휴대폰으로 스캔합니다. 새 기기에서 `이 기기로 이어하기`를 누르면 기존 대표 기기의 접속이 해제됩니다. 다시 발급한 QR은 이전 QR을 무효화합니다.

개발 시 `npm run typecheck`, `npm run build`, `npm test`를 실행합니다. 실제 DB 흐름 통합 테스트는 **비어 있는 별도 테스트 DB**에 마이그레이션을 적용한 후 `TEST_DATABASE_URL=postgresql://... npm test`로 실행합니다. 테스트는 기존 팀 데이터가 있으면 중단합니다.

## Vercel 배포

Vercel에 이 저장소를 연결하고 **Root Directory를 `umc-night`**로 설정합니다. 프레임워크는 Next.js를 선택합니다. `.env.example`의 5개 변수를 Vercel 프로젝트의 Environment Variables에 추가하고 배포합니다. 프로덕션 빌드에서는 QR 참가·기기 이전 마이그레이션이 먼저 적용되며, 적용에 실패하면 빌드도 실패합니다. 로컬·미리보기 빌드에서는 이 자동 마이그레이션을 건너뜁니다. 기본 `*.vercel.app` 주소를 사용하면 별도 도메인 비용이 필요 없습니다. Supabase 무료 플랜과 Vercel Hobby 사용량·약관이 행사 용도와 계정 상황에 맞는지 배포 전에 확인하세요. 이 저장소에는 실제 Supabase 프로젝트나 Vercel 프로젝트 연결 정보가 포함되지 않습니다.

10월 23일까지 실제 배포 주소에서 팀 대표 기기들과 진행자 노트북, 16:9 대형 화면으로 전체 리허설을 끝내는 것을 목표로 합니다. 행사 당일에는 노트북 화면을 **확장**하고 `/admin/live`는 노트북에, `/screen`은 프로젝터에 띄웁니다. 인터넷이 끊기면 문제 진행을 멈추고 답안을 종이에 적어 둔 뒤 연결 복구 후 재개하세요. 네트워크 없이 자동으로 답안이 동기화되지는 않습니다.

## 권한과 데이터

브라우저는 데이터베이스에 직접 접근하지 않습니다. 서버가 Supabase Auth와 팀 쿠키를 확인한 뒤 PostgreSQL에 접근합니다. 정답과 이미지 공개 시점은 서버 응답으로 제어합니다. 답안·채점·점수는 DB에 저장되어 새로고침 후에도 유지됩니다. 실제 행사 기록은 UI에서 초기화할 수 없고, 연습 모드의 최근 실행만 초기화할 수 있습니다.

디자인 자산의 출처와 사용 조건은 [ASSETS.md](docs/ASSETS.md)를 확인하세요. 세부 요구사항과 계획은 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)에 기록되어 있습니다.
