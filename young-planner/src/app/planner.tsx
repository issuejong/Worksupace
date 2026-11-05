"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  example,
  adopted,
  none,
  calculate,
  householdSchema,
  solutionSchema,
  Household,
  Solutions,
  Simulation,
  facts,
  fmt,
  explanation,
  version,
} from "../lib/household";
import "./planner.css";
function save(name: string, text: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob(["\ufeff" + text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const groups: {
  title: string;
  fields: [keyof Household, string, string?][];
}[] = [
  {
    title: "본인과 배우자",
    fields: [
      ["birth", "본인 출생연월", "month"],
      ["spouseBirth", "배우자 출생연월", "month"],
      ["retire", "본인 은퇴 예정월", "month"],
      ["spouseEnd", "배우자 근로 종료월", "month"],
    ],
  },
  {
    title: "소득과 퇴직금",
    fields: [
      ["income", "본인 세후 월소득 (만 원)"],
      ["spouseIncome", "배우자 세후 월소득 (만 원)"],
      ["severance", "예상 세후 퇴직금 (만 원)"],
      ["tenure", "현 직장 근속연수 (참고)"],
    ],
  },
  {
    title: "자산과 생활비",
    fields: [
      ["assets", "금융자산 (만 원)"],
      ["house", "주택가격 (만 원)"],
      ["loan", "주택담보대출 잔액 (만 원)"],
      ["living", "부부 월 생활비 (만 원)"],
    ],
  },
  {
    title: "국민연금 예상액",
    fields: [
      ["pension", "본인 정상 수령 월액 (기준년 가치·만 원)"],
      ["spousePension", "배우자 정상 수령 월액 (만 원)"],
    ],
  },
];
const advanced: [keyof Household, string, string?][] = [
  ["start", "분석 시작월", "month"],
  ["endYear", "분석 종료 연도"],
  ["loanRate", "대출 연금리 (%)", "percent"],
  ["loanMonths", "대출 잔여 개월"],
  ["inflation", "물가상승률 (%)", "percent"],
  ["wageGrowth", "임금상승률 (%)", "percent"],
  ["beforeReturn", "설계 전 세후 수익률 (%)", "percent"],
  ["planReturn", "설계 후 세후 수익률 (%)", "percent"],
  ["child", "자녀 월 지원액 (만 원)"],
  ["childEnd", "자녀 지원 종료월", "month"],
  ["jobIncome", "재취업 세후 월급 (기준년 가치·만 원)"],
  ["jobDelay", "재취업 추가 지연 (개월)"],
  ["benefit", "구직급여 월액 가정 (만 원)"],
  ["benefitMonths", "구직급여 개월"],
  ["catchupCost", "추납 일시납 비용 (만 원)"],
  ["catchupPension", "추납 후 배우자 연금 월액 (만 원)"],
  ["reserveMonths", "비상자금 목표 (월 지출의 배수)"],
  ["shock", "일시 지출 (만 원)"],
  ["shockYear", "일시 지출 연도 (1월 반영)"],
];
export default function Planner() {
  const [h, setH] = useState<Household>({ ...example }),
    [s, setS] = useState<Solutions>({ ...adopted }),
    [step, setStep] = useState(0),
    [mode, setMode] = useState("예시"),
    [settings, setSettings] = useState(true),
    [ai, setAI] = useState(false),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [messages, setMessages] = useState<
      { question: string; answer: string; version: string; stale?: boolean }[]
    >([]),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 800px)").matches) setSettings(false);
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    if (ai && window.innerWidth <= 1400)
      document.getElementById("yp-ai")?.scrollIntoView({ block: "start" });
  }, [ai]);
  const valid = householdSchema.safeParse(h);
  const solutionValid = solutionSchema.safeParse(s);
  const snapshot = JSON.stringify({ h, s });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const result = useMemo(() => {
    try {
      return {
        before: calculate(h, none, false),
        after: calculate(h, s, true),
      };
    } catch {
      return null;
    }
  }, [h, s]);
  const active = result?.after;
  const axis = useMemo(() => {
    if (!result) return [-100, 100];
    const vals = [...result.before.rows, ...result.after.rows].map(
      (r) => r.realAssets,
    );
    return [
      Math.floor(Math.min(0, ...vals) / 1000) * 1000,
      Math.ceil(Math.max(...vals) / 1000) * 1000,
    ];
  }, [result]);
  const update = (key: keyof Household, value: number | string) => {
    setH((v) => ({ ...v, [key]: value }));
  };
  function field([key, label, type]: [keyof Household, string, string?]) {
    return (
      <label className="yp-field" key={key}>
        {label}
        <input
          type={type === "month" ? "month" : "number"}
          step={type === "month" ? undefined : "any"}
          value={
            type === "percent"
              ? Number(((h[key] as number) * 100).toFixed(6))
              : h[key]
          }
          onChange={(e) =>
            update(
              key,
              type === "month"
                ? e.target.value
                : Number(e.target.value) / (type === "percent" ? 100 : 1),
            )
          }
        />
      </label>
    );
  }
  function reset() {
    abort.current?.abort();
    setH({ ...example });
    setS({ ...adopted });
    setMode("예시");
    setError("");
    setMessages([]);
    setQuestion("");
    setBusy(false);
  }
  async function ask() {
    if (!active || !question.trim() || busy) return;
    const q = question.trim(),
      snap = snapshot,
      r = /설계\s*전/.test(q) ? result!.before : active;
    const initial = explanation(r, q);
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      if (!consent) {
        setMessages((m) => [
          ...m,
          { question: q, answer: initial, version: snap },
        ]);
        setQuestion("");
        return;
      }
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({ household: h, solutions: s, question: q }),
      });
      const body = await res.json();
      if (!res.ok) throw Error(body.error || "AI 연결 실패");
      if (body.notice) setError(body.notice);
      setMessages((m) => [
        ...m,
        { question: q, answer: body.answer, version: snap },
      ]);
      setQuestion("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message + " 계산 기반 설명을 대신 표시했습니다.");
        setMessages((m) => [
          ...m,
          { question: q, answer: initial, version: snap },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }
  function chart(r: Simulation, label: string, color: string) {
    const data = r.rows
      .filter((x) => x.date.endsWith("12"))
      .map((x) => ({ year: x.year, assets: Math.round(x.realAssets) }));
    return (
      <section className="yp-card yp-chart">
        <h3>{label}</h3>
        <p>연말 금융자산 · {h.start.slice(0, 4)}년 구매력 · 만 원</p>
        <div
          className="yp-plot"
          role="img"
          aria-label={`${label} 금융자산 추이. 최저 ${fmt(r.minAssets)}만 원, 최초 부족 ${r.firstNegative ?? "없음"}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ right: 24, left: 12, top: 15, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 4" />
              <XAxis dataKey="year" minTickGap={40} />
              <YAxis domain={axis} width={72} />
              <Tooltip formatter={(v) => `${fmt(Number(v))}만 원`} />
              <ReferenceLine y={0} stroke="#a14736" label="자산 0" />
              <ReferenceLine
                y={r.reserve}
                stroke="#9b792c"
                strokeDasharray="4 4"
              />
              <Line
                dataKey="assets"
                name={label}
                stroke={color}
                dot={false}
                strokeWidth={3}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p>점선: 비상자금 {fmt(r.reserve)}만 원 · 실선 기준: 금융자산 0</p>
      </section>
    );
  }
  function csv() {
    if (!result) return;
    const lines = [
      "모델,시나리오,월,수입,지출,운용수익,기말금융자산,실질금융자산,대출잔액",
    ];
    for (const [label, r] of [
      ["설계 전", result.before],
      ["설계 후", result.after],
    ] as const)
      for (const x of r.rows)
        lines.push(
          [
            version,
            label,
            x.date,
            x.income,
            x.expenses,
            x.interest,
            x.assets,
            x.realAssets,
            x.loan,
          ].join(","),
        );
    save("영플래너_월별계산.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }
  function verification() {
    save(
      "영플래너_검증대조.csv",
      "시나리오,지표,엑셀값,앱값,차이,판정\n" +
        [
          [
            "설계 전",
            "최초 부족월",
            "2031-02",
            calculate(example, none, false).firstNegative,
          ],
          [
            "설계 전",
            "생애 순수지",
            -29398.8546046442,
            calculate(example, none, false).lifeNet,
          ],
          [
            "설계 후",
            "최저 금융자산",
            3616.55185834155,
            calculate(example, adopted).minAssets,
          ],
          [
            "설계 후",
            "생애 순수지",
            5556.72076379601,
            calculate(example, adopted).lifeNet,
          ],
        ]
          .map(([a, b, c, d]) =>
            [
              a,
              b,
              c,
              d,
              typeof c === "number" && typeof d === "number" ? d - c : "",
              typeof c === "number" && typeof d === "number"
                ? Math.abs(c - d) < 0.0001
                  ? "일치(1원 이내)"
                  : "차이"
                : c === d
                  ? "일치"
                  : "차이",
            ].join(","),
          )
          .join("\n"),
      "text/csv;charset=utf-8",
    );
  }
  return (
    <div className="planner">
      <header>
        <a href="/">
          young<span>planner</span>
        </a>
        <small>은퇴 준비 계산기 · {version}</small>
      </header>
      <main>
        <div className="yp-intro">
          <div>
            <p className="yp-eyebrow">은퇴 후에도, 생활은 계속되니까</p>
            <h1>
              연금 전 공백부터
              <br className="yp-mobile" /> 함께 계산해요.
            </h1>
            <p>
              내 조건을 넣고, 해법을 하나씩 바꾸며 은퇴자금이 얼마나 이어지는지
              살펴보세요.
            </p>
          </div>
          <span className="yp-mode">{mode} 모드 · 자동 저장 안 함</span>
        </div>
        <div className="yp-actions">
          <button onClick={reset}>권 부장 부부 예시로 체험</button>
          <button
            className="yp-primary"
            onClick={() => {
              setMode("직접 입력");
              setStep(0);
              setSettings(true);
            }}
          >
            내 정보로 계산
          </button>
          <button
            onClick={() => setSettings(!settings)}
            aria-expanded={settings}
            aria-controls="yp-settings"
          >
            {settings ? "설정 접기" : "설정 펼치기"}
          </button>
          <button
            onClick={() => setAI(!ai)}
            aria-expanded={ai}
            aria-controls="yp-ai"
          >
            {ai ? "AI 설명 닫기" : "AI 설명 열기"}
          </button>
        </div>
        <p className="yp-note">
          {mode === "예시"
            ? "가상의 권 부장 부부 · 2026.11~2060.12 · 최신 보고서 기준"
            : "내 정보로 바꿔 주세요. 아직 수정하지 않은 값은 예시값입니다. 연금액·퇴직금은 확인한 예상액을 입력하세요."}
        </p>
        <div
          className={`yp-workspace ${settings ? "yp-settings-open" : ""} ${ai ? "yp-ai-open" : ""}`}
        >
          {settings && (
            <aside id="yp-settings" className="yp-card yp-settings">
              <h2>내 조건</h2>
              <div className="yp-progress" aria-label="입력 단계">
                {groups.map((g, i) => (
                  <button
                    key={g.title}
                    aria-pressed={step === i}
                    onClick={() => setStep(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <h3>{groups[step].title}</h3>
              <div className="yp-fields">{groups[step].fields.map(field)}</div>
              {step === 1 && (
                <p className="yp-note">
                  근속연수만으로 세후 퇴직금을 확정할 수 없습니다. 회사가 안내한
                  예상 세후 금액을 직접 입력해 주세요.
                </p>
              )}
              {step === 3 && (
                <p className="yp-note">
                  가입 이력 없이 개인 연금액을 자동 산정하지 않습니다. 공단
                  예상액을 기준년 구매력으로 입력하세요. 예시값은 개인 지급액이
                  아닙니다.
                </p>
              )}
              <div className="yp-actions">
                <button disabled={step === 0} onClick={() => setStep(step - 1)}>
                  이전
                </button>
                <button
                  className="yp-primary"
                  disabled={step === 3}
                  onClick={() => setStep(step + 1)}
                >
                  다음
                </button>
              </div>
              <details>
                <summary>세부 조건과 가정</summary>
                <div className="yp-fields">{advanced.map(field)}</div>
                <p className="yp-note">
                  건강보험은 보고서의 단순 산식(재산보험료 0)을 유지합니다. 세금
                  정밀 계산·유족연금·주택연금 채무는 제외합니다.
                </p>
              </details>
              <div className="yp-actions">
                <button
                  onClick={() =>
                    save(
                      "영플래너_조건.json",
                      JSON.stringify(
                        { version, household: h, solutions: s },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  조건 JSON 저장
                </button>
                <label className="yp-upload">
                  조건 불러오기
                  <input
                    type="file"
                    accept=".json"
                    aria-label="조건 JSON 불러오기"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        if (f.size > 100000) throw Error();
                        const v = JSON.parse(
                          (await f.text()).replace(/^\ufeff/, ""),
                        );
                        setH(householdSchema.parse(v.household));
                        setS(solutionSchema.parse(v.solutions));
                        setMode("불러온 조건");
                        setError("");
                      } catch {
                        setError(
                          "새 버전의 가구 정보 JSON이 아닙니다. 이전 파일은 기존 사례 화면에서 열어 주세요.",
                        );
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <a href="/legacy">이전 사례·저장 데이터 열기</a>
            </aside>
          )}
          <div className="yp-analysis">
            {!(valid.success && solutionValid.success) && (
              <p className="yp-error" role="alert">
                입력 범위를 확인해 주세요.{" "}
                {(!valid.success
                  ? valid.error.issues
                  : !solutionValid.success
                    ? solutionValid.error.issues
                    : []
                )
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join(" / ")}
              </p>
            )}
            {result && (
              <>
                <section className="yp-card">
                  <p className="yp-eyebrow">설계 전 진단</p>
                  <h2>
                    본인의 연금 전 공백은 {result.before.gapMonths}개월이에요.
                  </h2>
                  <p>
                    은퇴 다음 달부터 정상 국민연금 개시 전까지입니다. 배우자
                    소득과는 별개이며, 가구의 정기 수입이 전혀 없는 달은{" "}
                    {result.before.householdGap}개월입니다.
                  </p>
                  <div className="yp-metrics">
                    {[
                      [
                        "돈이 처음 부족한 달",
                        result.before.firstNegative ?? "부족 없음",
                      ],
                      ["최저 금융자산", fmt(result.before.minAssets) + "만 원"],
                      ["생애 순수지", fmt(result.before.lifeNet) + "만 원"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <span>{k}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="yp-card">
                  <h2>해법을 하나씩 적용해 보세요</h2>
                  <p>선택할 때마다 설계 후 결과가 바로 바뀝니다.</p>
                  <div className="yp-solutions">
                    {(
                      [
                        ["benefits", "구직급여 받기"],
                        ["job", "재취업하기"],
                        ["repay", "퇴직 시 주택담보대출 전액 갚기"],
                        ["catchup", "배우자 국민연금 추납"],
                        ["home", "주택연금 받기"],
                      ] as [keyof Solutions, string][]
                    ).map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={s[key] as boolean}
                          onChange={(e) =>
                            setS((v) => ({ ...v, [key]: e.target.checked }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="yp-note">
                    추납: 못 낸 기간의 보험료를 나중에 내는 제도. 비용과 증가한
                    월액은 세부 조건에 입력합니다. 해법은 수급 자격을 보장하지
                    않습니다.
                  </p>
                  <label className="yp-field">
                    주택연금 가입 연도: {s.homeYear}년 · 월{" "}
                    {fmt(result.after.homeMonthly)}만 원
                    <input
                      aria-label="주택연금 가입 연도"
                      type="range"
                      min={Math.max(2026, +h.retire.slice(0, 4))}
                      max={Math.max(2035, +h.retire.slice(0, 4) + 15)}
                      value={s.homeYear}
                      disabled={!s.home}
                      onChange={(e) =>
                        setS((v) => ({ ...v, homeYear: +e.target.value }))
                      }
                    />
                  </label>
                  <label className="yp-field">
                    확인한 주택연금 월액 (0이면 표 보간, 만 원)
                    <input
                      type="number"
                      min="0"
                      max="500"
                      step="any"
                      value={s.homeOverride}
                      onChange={(e) =>
                        setS((v) => ({ ...v, homeOverride: +e.target.value }))
                      }
                    />
                  </label>
                  <p className="yp-note">
                    주택연금은 보고서 표(연소자 55~70세)의 보간 추정입니다. 실제
                    가입 시 월액은 HF에서 확인해야 합니다.
                  </p>
                  <label className="yp-field">
                    본인 국민연금 수령 시기
                    <select
                      value={s.pensionOffset}
                      onChange={(e) =>
                        setS((v) => ({ ...v, pensionOffset: +e.target.value }))
                      }
                    >
                      {[
                        -60, -48, -39, -36, -24, -12, 0, 12, 24, 36, 48, 60,
                      ].map((n) => (
                        <option key={n} value={n}>
                          {n === 0
                            ? "정상 수령"
                            : `${Math.abs(n)}개월 ${n < 0 ? "조기" : "연기"} 수령`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="yp-note">
                    조기 월 0.5% 감액·연기 월 0.6% 가산의 단순 비교이며
                    소득·가입기간 자격은 별도 확인이 필요합니다.
                  </p>
                  <div className="yp-actions">
                    <button onClick={() => setS({ ...none })}>
                      해법 모두 끄기
                    </button>
                    <button onClick={() => setS({ ...adopted })}>
                      기획 채택안 적용
                    </button>
                  </div>
                  {result.after.warnings.map((w) => (
                    <p className="yp-warning" key={w}>
                      {w}
                    </p>
                  ))}
                </section>
                <section aria-label="설계 전후 비교">
                  <h2>같은 조건, 달라지는 결과</h2>
                  <p>
                    물가 {+(h.inflation * 100).toFixed(2)}% · 세후 수익률 설계
                    전 {+(h.beforeReturn * 100).toFixed(4)}% / 설계 후{" "}
                    {+(h.planReturn * 100).toFixed(4)}%. 수익률 차이도 결과에
                    반영됩니다.
                  </p>
                  <div className="yp-metrics">
                    {[
                      [
                        "돈이 처음 부족한 달",
                        result.before.firstNegative ?? "없음",
                        result.after.firstNegative ?? "없음",
                      ],
                      [
                        "최저 금융자산",
                        fmt(result.before.minAssets),
                        fmt(result.after.minAssets),
                      ],
                      [
                        "생애 순수지",
                        fmt(result.before.lifeNet),
                        fmt(result.after.lifeNet),
                      ],
                    ].map(([k, a, b]) => (
                      <div className="yp-card" key={k}>
                        <span>{k}</span>
                        <small>설계 전 {a}</small>
                        <strong>
                          {b}
                          {k.includes("달") ? "" : "만 원"}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <p
                    className={
                      result.after.passes ? "yp-success" : "yp-warning"
                    }
                  >
                    {result.after.firstNegative
                      ? "자산 부족 발생"
                      : result.after.passes
                        ? "비상자금 충족"
                        : "자산 소진 없음 · 비상자금 미달"}{" "}
                    · 기준 {fmt(result.after.reserve)}만 원 / 최저점{" "}
                    {result.after.minMonth}
                  </p>
                  <div className="yp-charts">
                    {chart(result.before, "설계 전", "#7b8983")}
                    {chart(result.after, "설계 후", "#216653")}
                  </div>
                  <p className="yp-note">
                    최저 자산·생애 순수지는 {h.start.slice(0, 4)}년
                    구매력입니다. 생애 순수지는 시작 자산을 포함하고 운용수익은
                    제외합니다. 기말 금융자산은 명목{" "}
                    {fmt(result.after.endAssets)}만 원이며 주택연금 채무를 뺀
                    순자산이 아닙니다.
                  </p>
                </section>
                <details className="yp-card">
                  <summary>월별 계산과 근거 보기</summary>
                  <p>
                    분석 {h.start}~{h.endYear}-12 · {result.after.rows.length}
                    개월. 음수는 미충당 부족액이며 실제 대출로 처리하지
                    않습니다.
                  </p>
                  <div className="yp-scroll">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "월",
                            "수입",
                            "지출",
                            "운용수익",
                            "금융자산",
                            "실질자산",
                            "주담대",
                          ].map((x) => (
                            <th key={x}>{x}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.after.rows.map((r) => (
                          <tr key={r.date}>
                            {[
                              r.date,
                              ...[
                                r.income,
                                r.expenses,
                                r.interest,
                                r.assets,
                                r.realAssets,
                                r.loan,
                              ].map(fmt),
                            ].map((v, i) => (
                              <td key={i}>{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <a
                    href="https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0100M0.do"
                    target="_blank"
                    rel="noreferrer"
                  >
                    국민연금공단 · 조기·연기 수령 안내
                  </a>
                  <p>
                    주택연금 보간·건강보험·추납 가정은 팀 확인 전입니다. 현재
                    기준은 첨부 엑셀 v1.1 / 본문 v11입니다.
                  </p>
                </details>
                <section className="yp-card yp-export">
                  <h2>결과와 보고서 자료</h2>
                  <div className="yp-actions">
                    <button onClick={csv}>월별 CSV 저장</button>
                    <button onClick={verification}>예시 검증 대조표 CSV</button>
                    <button
                      onClick={() =>
                        save(
                          "상담메모.txt",
                          explanation(result.after),
                          "text/plain;charset=utf-8",
                        )
                      }
                    >
                      상담 메모 저장
                    </button>
                    <button onClick={() => window.print()}>
                      보고서 화면 인쇄 / PDF
                    </button>
                  </div>
                  <p>
                    예시 대조표는 내 입력값과 무관하게 보고서 사례를 검증합니다.
                    현재 입력은 브라우저·서버에 자동 저장하지 않습니다.
                  </p>
                </section>
              </>
            )}
          </div>
          {ai && (
            <aside className="yp-card yp-agent" id="yp-ai">
              <div className="yp-actions">
                <h2>AI 상담 메모</h2>
                <button onClick={() => setAI(false)}>설명 패널 닫기</button>
              </div>
              <p>
                계산은 엔진이, 설명은 AI가 합니다. 이 패널은 설정을 변경하지
                않습니다.
              </p>
              <label className="yp-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                질문과 계산용 가구 조건을 AI 설명 서버로 보내기
              </label>
              <p className="yp-note">
                선택하지 않아도 계산 기반 설명을 제공합니다. 이름·연락처는
                수집하지 않으며 서버 DB에 저장하지 않습니다. AI 제공자의 처리
                정책은 별도로 적용됩니다.
              </p>
              <div className="yp-messages" role="log" aria-live="polite">
                {messages.map((m, i) => (
                  <article key={i}>
                    <strong>나 · {m.question}</strong>
                    {m.version !== snapshot && (
                      <p className="yp-warning">조건 변경 전의 설명입니다.</p>
                    )}
                    <p>{m.answer}</p>
                  </article>
                ))}
                {busy && (
                  <p role="status">현재 조건의 계산 결과를 설명하고 있어요…</p>
                )}
              </div>
              <div className="yp-actions">
                {[
                  "설계 전은 왜 2031년 2월에 부족해지나요?",
                  "현재 안의 취약한 가정은?",
                  "발표용 상담 메모를 써줘",
                ].map((q) => (
                  <button key={q} onClick={() => setQuestion(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <label className="yp-field">
                  궁금한 점
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </label>
                <button
                  className="yp-primary"
                  disabled={busy || !question.trim() || !result}
                >
                  {busy
                    ? "분석 중…"
                    : consent
                      ? "AI에 질문하기"
                      : "계산 결과로 설명하기"}
                </button>
                {busy && (
                  <button type="button" onClick={() => abort.current?.abort()}>
                    취소
                  </button>
                )}
              </form>
              {error && (
                <div role="alert">
                  <p className="yp-error">{error}</p>
                  <button disabled={busy} onClick={() => void ask()}>
                    다시 시도
                  </button>
                </div>
              )}
            </aside>
          )}
        </div>
        {error && !ai && (
          <p role="alert" className="yp-error">
            {error}
          </p>
        )}
        <footer>
          참고용 시뮬레이션이며 상품 권유가 아닙니다. 실제 지급액·가입
          자격·세금은 관련 기관에서 확인하세요.
        </footer>
      </main>
    </div>
  );
}
