# UMC Night

**팀원들과 함께 답을 고르고, 한 대의 휴대폰을 돌려가며 경쟁하는 동아리 레크레이션 웹사이트.**

동국대학교 UMC 동아리 MT에서 사용할 목적으로 만들었습니다. 진행자는 노트북으로 게임을 조작하고, 팀 대표는 QR 코드로 접속해 답안을 제출합니다. 대형 화면에는 문제와 공개된 결과를 보여줍니다.

[사이트](https://umc-night.vercel.app) · [현장 화면](https://umc-night.vercel.app/screen) · [운영 가이드](docs/OPERATIONS.md)

## 참여부터 우승팀 발표까지

1. 현장 화면의 **QR 코드**를 스캔하고 팀 이름을 입력합니다. 별도 참가 코드나 사전 팀 선택 없이 등록됩니다.
2. 진행자가 문제를 시작하면 팀 대표 휴대폰에 답안 입력 화면이 나타납니다.
3. 팀원들이 의논해 답을 제출합니다. 진행자는 현장 정답을 선택하거나 팀별 정답·오답을 판정합니다.
4. **정답 공개 · 채점 확정**으로 정답과 결과를 함께 공개합니다.
5. 라운드 사이에는 누적 순위를 확인하고, 마지막에는 **오늘의 우승팀은? → 우승팀 공개!** 순서로 마무리합니다.

## 주요 기능

| 구분 | 구현 내용 |
|---|---|
| 팀 참가 | QR 등록, 팀 이름 직접 입력, 대표 휴대폰 교체용 일회용 QR |
| 퀴즈 | 객관식·주관식·O/X, 제한 시간, 일시정지·재개, 전원 제출 대기 |
| 정답 판정 | 미리 등록한 정답, 현장에서 고르는 정답, 팀별 직접 판정 |
| 사진 퀴즈 | 문제용 사진과 정답용 원본 사진을 구분해 업로드·공개 |
| 가사 퀴즈 | 문제에서는 가사만 표시, 공개 후 가사·영상·정답·팀별 답안 표시 |
| 유튜브 | 정답 공개 영상의 시작 구간 지정, 재생·설정 구간부터 다시 재생 |
| 타자 릴레이 | 1~10차례 문장 자유 등록, 팀별 폰 돌려쓰기, 오타 제출마다 +1초 |
| 점수·순위 | 문제별 배점, 첫 정답 팀 또는 정답 팀 모두 득점, 동점 공동 순위 |
| 진행 관리 | 라운드별 목록, 문제 드래그 정렬, 수정·삭제, 채점 정정·이력, 문제 무효 |
| 리허설 | 연습 게임, 연습 전용 라운드 스킵, 기록 초기화, 결과 JSON 내보내기 |

> **타자 릴레이는 배점만 입력해도 점수가 부여되는 방식이 아닙니다.** `우승팀 점수를 누적 점수에 반영`을 켜야 득점합니다. 기본값은 꺼짐이며, 설정은 문제를 시작할 때 고정됩니다.

## 화면 구성

| 경로 | 대상 | 역할 |
|---|---|---|
| `/` | 공통 | 메인 화면 |
| `/join` | 팀 대표 | 팀 등록·참가 |
| `/play` | 팀 대표 | 답안 제출, 타자 릴레이, 공개된 결과 확인 |
| `/screen` | 대형 화면 | 참가 QR, 문제·사진·영상, 팀별 답안, 순위·우승팀 발표 |
| `/admin` | 진행자 | 로그인·관리 메뉴 |
| `/admin/setup` | 진행자 | 팀·라운드·문제·미디어 설정 |
| `/admin/live` | 진행자 | 게임 진행·채점·결과 관리 |
| `/transfer` | 새 팀 대표 기기 | 일회용 QR로 기존 팀 이어하기 |

## 기술 구성

| 영역 | 사용 기술 |
|---|---|
| 화면 | Next.js 16 App Router, React 19, TypeScript, CSS |
| 백엔드 | Next.js Route Handlers, Zod 입력 검증 |
| 데이터 | Supabase PostgreSQL, Postgres.js |
| 인증·파일 | Supabase Auth, 비공개 Storage 버킷 |
| 상태 알림 | Supabase Realtime, 같은 브라우저 탭 간 BroadcastChannel |
| 검증 | Vitest, TypeScript, Next.js 프로덕션 빌드 |
| 배포 | Vercel, 서울 실행 지역 `icn1` |

프런트엔드와 API를 같은 Next.js 프로젝트에서 제공합니다. 별도 백엔드 서버를 배포하지 않으며, Vercel에서 실행되는 API가 인증·진행 상태·답안·채점·점수를 처리합니다. 데이터베이스와 파일 저장소는 Supabase를 사용합니다.

브라우저는 게임 테이블을 직접 읽거나 수정하지 않습니다. 서버가 진행자 인증이나 팀 세션을 확인한 뒤 필요한 데이터만 응답합니다. Realtime에는 UUID와 생성 시각만 있는 변경 신호를 보내고, 각 화면은 자신의 권한으로 상태를 다시 조회합니다.

## 로컬 실행

Node.js 22 이상과 npm, 별도 Supabase 프로젝트가 필요합니다.

```bash
# 저장소 루트 기준
cd umc-night
npm ci
cp .env.example .env.local
```

환경변수를 입력하고 아래의 **DB 초기 설정**을 완료한 뒤 실행합니다.

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/admin`으로 접속합니다. 환경변수 없이도 화면 빌드는 가능하지만 로그인·게임·DB 기능은 사용할 수 없습니다.

### 환경변수

| 변수 | 용도 |
|---|---|
| `DATABASE_URL` | Supabase Session pooler 연결 문자열. 비밀번호를 제외하고 포트 `5432` 사용 |
| `DATABASE_PASSWORD` | Supabase 프로젝트의 DB 비밀번호 |
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_ANON_KEY` | Supabase 공개용 키. `/api/live`에서 Realtime 연결에 제공 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버가 비공개 이미지 파일에 접근하는 서비스 키 |

값의 형식은 [.env.example](.env.example)을 참고하세요. 모든 변수는 서버 환경변수로 설정하며 `NEXT_PUBLIC_` 접두어를 붙이지 않습니다. `.env.local`, DB 비밀번호, 서비스 키, 실제 로그인 정보는 커밋하지 않습니다.

### DB 초기 설정

**새 Supabase 프로젝트**의 SQL Editor에서 [supabase/migrations](supabase/migrations) 안의 파일을 파일명 오름차순으로 한 번씩 실행합니다.

```text
202610140001_init.sql
202610150001_qr_join.sql
202610150002_team_transfer.sql
202610160001_question_rules.sql
202610190001_live_answers.sql
202610200001_correct_counts.sql
202610230001_typing_relay.sql
202610230002_live_sync.sql
202610240001_configurable_points.sql
202610250001_manual_verdicts.sql
202610290001_youtube_questions.sql
```

이 과정에서 게임 테이블, 비공개 `quiz-media` 버킷, Realtime 변경 신호가 준비됩니다. 이미 운영 중인 DB에는 과거 마이그레이션 전체를 다시 실행하지 마세요. 프로덕션 배포의 후속 마이그레이션은 실행 스크립트가 적용 이력을 관리합니다.

Supabase Authentication에서 진행자 계정을 만든 다음, 사용자의 UUID를 `host_users`에 등록합니다.

```sql
insert into public.host_users (user_id)
values ('여기에-Supabase-Auth-사용자-UUID')
on conflict (user_id) do nothing;
```

이메일 계정으로 바로 로그인할 수 있습니다. 아이디 로그인이 필요하면 Auth 사용자를 `아이디@umc-night.invalid`로 만들고 이메일을 확인 처리합니다. 아이디는 영문·숫자·밑줄 3~32자이며 소문자로 변환됩니다. 이 별칭 주소는 메일을 수신하지 않으므로 비밀번호 재설정은 관리자가 처리해야 합니다.

## 검증 명령

`umc-night/`에서 실행합니다.

```bash
npm run typecheck
npm test
npm run build

# 프로덕션 빌드 실행
npm start
```

`npm test`는 DB가 없어도 순수 로직·일부 API 테스트를 실행하며, `TEST_DATABASE_URL`이 없으면 DB 통합 테스트는 건너뜁니다. 통합 테스트까지 실행하려면 마이그레이션을 적용한 **비어 있는 전용 Supabase 테스트 프로젝트 또는 동일한 스키마를 준비한 PostgreSQL DB**를 지정합니다.

```bash
TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/TEST_DB' npm test
```

테스트는 데이터를 생성·변경·삭제하므로 **운영 DB를 지정하면 안 됩니다.** 일반 PostgreSQL을 쓰는 경우 Supabase의 `anon`·`authenticated` 역할과 `storage.buckets` 등 마이그레이션이 참조하는 구조도 준비해야 합니다. `.env.local`은 Next.js가 읽는 파일이며, Vitest용 연결 주소는 실행 환경에 직접 전달합니다.

## Vercel 배포

1. 저장소를 Vercel에 연결합니다.
2. **Root Directory를 `umc-night`**, Framework Preset을 **Next.js**로 지정합니다.
3. 로컬에서 사용한 환경변수 5개를 해당 배포 환경에 등록합니다.
4. 새 DB라면 초기 스키마와 진행자 계정을 먼저 준비한 뒤 배포합니다.
5. `/admin` 로그인, QR 참가, `/screen` 연동을 확인합니다.

`npm run build`는 마이그레이션 스크립트를 먼저 실행합니다. `VERCEL_ENV=production`일 때만 후속 마이그레이션을 적용하며, 실패하면 배포 빌드도 실패합니다. 로컬과 Preview 빌드는 자동 마이그레이션을 건너뜁니다. **Preview에서 운영 데이터를 바꾸지 않도록 개발·테스트용 DB를 분리하세요.**

Vercel 기본 도메인과 외부 무료 DB를 사용하는 구성입니다. 비용과 사용 가능 범위는 서비스의 현재 플랜·사용량에 따르며, 별도 유료 도메인이나 유료 API를 필수로 사용하지 않습니다.

## 저장 구조

```text
umc-night/
├── app/
│   ├── admin/          # 행사 준비·진행자 화면
│   ├── api/            # 인증·게임·답안·채점·미디어 API
│   ├── components/     # 타자 릴레이·영상·사진·선택지
│   ├── join/           # 팀 등록
│   ├── play/           # 참가자 화면
│   ├── screen/         # 현장 대형 화면
│   └── transfer/       # 대표 기기 교체
├── lib/
│   ├── server/         # DB 접근·게임 전환·채점·권한 검증
│   └── ...             # 시간 보정·이미지 처리·공유 타입
├── supabase/migrations/
├── scripts/            # 배포 마이그레이션 실행
├── tests/              # 로직·API·DB 통합 테스트
├── public/brand/        # 디자인 자산
└── docs/               # 운영 가이드·설계·자산 출처
```

문제 원본은 `questions`, 실제 진행 당시의 설정은 `run_questions.snapshot`에 보관합니다. 답안·채점·점수 변경은 각각 `answers`, `grades`, `score_entries`에 저장하며, 누적 점수는 점수 이력의 합계로 계산합니다. 타자 릴레이는 별도의 진행·시도 기록을 저장합니다.

## 운영 시 알아둘 점

- 타자 릴레이 점수 반영 여부와 배점은 **문제를 열기 전** 확인하세요. 편집한 설정은 진행 중인 게임 기록에 소급 적용되지 않습니다.
- `연습 데이터 초기화`와 `팀·게임 초기화`의 삭제 범위가 다릅니다. 보관할 기록은 먼저 결과 JSON으로 내보내세요.
- 완전한 오프라인 진행은 지원하지 않습니다. 인터넷이 끊기면 진행을 멈추고, 별도 PPT·수기 점수표 등으로 전환해야 합니다.
- 현재 일반 퀴즈 제출에는 문제 ID 검사가 없고, 공통 API 요청에는 명시적인 타임아웃이 없습니다. 지연 답안이 다음 문제에 들어가거나 통신 장애 시 갱신이 오래 대기할 수 있어 보완이 필요합니다.
- DB 풀의 `max: 1`은 서버 인스턴스별 설정입니다. 서비스 전체의 동시 연결 수가 1개라는 뜻은 아닙니다.

세부 채점 규칙, 타자 기록 계산, 기기 교체와 리허설 절차는 [운영 가이드](docs/OPERATIONS.md)를 확인하세요.

## 관련 문서

- [운영 가이드](docs/OPERATIONS.md)
- [구현 계획](IMPLEMENTATION_PLAN.md)
- [타자 릴레이 설계](docs/TYPING_RELAY_PLAN.md)
- [디자인 자산 출처·사용 조건](docs/ASSETS.md)

디자인은 오렌지·차콜·크림색과 동국대학교 마스코트 아코를 사용합니다. 아코 이미지에는 코드와 별도의 사용 조건이 적용되므로 재사용 전에 자산 문서를 확인하세요.
