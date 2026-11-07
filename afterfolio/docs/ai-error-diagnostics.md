# AI 오류 추적

오류 화면의 ‘오류 추적 ID’는 `/api/agent` 응답 JSON의 `requestId`, 응답 헤더 `X-Request-Id`, Vercel 서버 로그의 `requestId`와 같다. AI가 생성한 값이 아니라 서버가 요청마다 만든 UUID다.

Vercel 로그에서 이 ID를 검색하면 두 종류의 기록을 연결할 수 있다.

- `Young Planner AI provider response`: 제공자 HTTP 실패별 상태, 시도 번호, HTTP 요청 처리 시간, 제한한 응답 헤더, 오류 본문 상태. 재시도 후 성공했어도 첫 실패 기록은 남는다.
- `Young Planner AI request failed` 또는 `completed`: 앱 최종 HTTP 상태, 전체 처리 시간, 제공자/모델, 입력 수집·분석 구분, 실제 실행 리전.

본문 상태는 `empty`(비어 있음), `json`, `text`(비JSON), `truncated`(8 KiB 제한), `unreadable`로 구분한다. JSON 오류의 code/type/status/message만 허용한다. 요청 본문, 성공한 AI 답변, 전체 오류 JSON, HTML/텍스트 원문, 인증/쿠키 헤더는 기록하지 않는다. 키·요청 문자열과 조각·이메일 등을 가리고 오류 메시지 속 숫자도 가린다. 허용된 헤더는 content-type, retry-after, x-request-id, x-goog-request-id, request-id다.

공개 오류 응답에는 사용자 안내·앱 오류 코드·추적 ID만 포함하며 제공자 원문은 포함하지 않는다. 원본 제공자 Response는 그대로 SDK로 전달해 재시도 동작을 유지한다. 응답에는 Cache-Control: no-store를 지정한다. 제공자가 보내지 않은 본문을 복원할 수는 없다.

검증: 테스트 62개, 타입 검사 및 프로덕션 빌드. 본문 없는 503, JSON 오류/헤더 마스킹, 본문 상한, SDK 원본 응답 유지, 성공 본문 미기록, 화면용 ID와 헤더/로그의 일치 포함.


2026-11-05 추적 `a506d68e-0aed-480d-9675-3ddf9f396ba2`: Gemini 첫 호출 503(1,278ms), 재시도 503(1,865ms), 전체 4,301ms. 두 응답 모두 200바이트 JSON 본문이 있었다. SDK가 인식하지 못한 오류도 기록하도록 배열·중첩 error/errors 봉투를 최대 깊이 5, 배열 항목 10개 이내에서 해석한다. 기존 로그만으로 실제 봉투 형태나 과부하 원문을 소급 복원할 수는 없다. 제공자가 보낸 새 오류에서 확인한다.
