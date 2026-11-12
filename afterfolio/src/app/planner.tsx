"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  homePaymentDetails,
  homePaymentSource,
  Household,
  Solutions,
  Simulation,
  fmt,
  version,
} from "../lib/household";
import {
  blankHousehold,
  cleanDraft,
  prepareScenario,
  inputLabels,
  mergeIntake,
  readScenarioFile,
  optionalPlanHint,
  isSkippableMoneyField,
  nextIntakeField,
  intakeAnswer,
  resolveIntakeInputAction,
  inputLookups,
  skippableMoneyFields,
} from "../lib/input";
import type { Candidate } from "../lib/household-agent";
import {
  readPlannerSession,
  sessionKey,
  type Message,
  type Origin,
} from "../lib/planner-session";
import { money, moneyAxis } from "../lib/money";
import "./planner.css";

type FieldSpec = [keyof Household, string, string?];
const groups: { title: string; description: string; fields: FieldSpec[] }[] = [
  {
    title: "생활비와 자산",
    description: "지금 가진 돈과 매달 필요한 돈이에요.",
    fields: [
      ["living", "부부 월 생활비"],
      ["assets", "지금 가진 예금·투자금"],
      ["house", "현재 주택가격"],
      ["loan", "주택담보대출 잔액"],
    ],
  },
  {
    title: "나와 배우자",
    description: "언제 월급이 끝나고 연금이 시작되는지 계산해요.",
    fields: [
      ["birth", "본인 출생연월", "month"],
      ["spouseBirth", "배우자 출생연월", "month"],
      ["retire", "본인 은퇴 예정월", "month"],
      ["spouseEnd", "배우자 근로 종료월", "month"],
    ],
  },
  {
    title: "월급과 퇴직금",
    description: "세금 등을 뺀 실제 수령액을 입력해 주세요.",
    fields: [
      ["income", "본인 월급"],
      ["spouseIncome", "배우자 월급"],
      ["severance", "예상 퇴직금"],
    ],
  },
  {
    title: "국민연금 예상액",
    description:
      "국민연금공단에서 확인한 정상 수령 시의 월 예상액을 입력해 주세요. 미래가치가 아닌 현재가치 금액을 사용해요.",
    fields: [
      ["pension", "본인 월 연금"],
      ["spousePension", "배우자 월 연금"],
    ],
  },
];
const assumptionFields: FieldSpec[] = [
  ["start", "계산 시작월", "month"],
  ["endYear", "계산 종료 연도", "년"],
  ["inflation", "연 물가상승률", "%"],
  ["wageGrowth", "연 임금상승률", "%"],
  ["beforeReturn", "계획 적용 전 연 수익률", "%"],
  ["planReturn", "계획 적용 후 연 수익률", "%"],
  ["propertyHealthPremium", "지역건강보험료 중 월 재산보험료", "원"],
  ["loanRate", "대출 연금리", "%"],
  ["loanMonths", "대출 남은 기간", "개월"],
  ["reserveMonths", "비상자금 목표", "개월치"],
  ["child", "자녀 월 지원금"],
  ["childEnd", "자녀 지원 종료월", "month"],
  ["shock", "추가 일시 지출"],
  ["shockYear", "추가 지출 연도", "년"],
];
const planLabels: Record<keyof Solutions, string> = {
  benefits: "구직급여",
  job: "재취업",
  repay: "대출 상환",
  catchup: "배우자 연금 추납",
  home: "주택연금",
  homeYear: "주택연금 시작 연도",
  homeMonth: "주택연금 시작 월",
  pensionOffset: "국민연금 수령 시기",
  homeOverride: "주택연금 월액",
};
const fieldNames = Object.fromEntries(
  [
    ...groups.flatMap((g) => g.fields),
    ...assumptionFields,
    ["jobIncome", "재취업 월급"],
    ["jobDelay", "재취업 대기 기간"],
    ["benefit", "구직급여 월액"],
    ["benefitMonths", "구직급여 기간"],
    ["catchupCost", "추납 비용"],
    ["catchupPension", "추납 후 월 연금"],
  ].map(([k, v]) => [k, v]),
);
const dateText = (date: string | null) =>
  date ? `${date.slice(0, 4)}년 ${Number(date.slice(5))}월` : "부족 없음";
const showValue = (v: unknown, key?: string) =>
  typeof v === "boolean"
    ? v
      ? "선택"
      : "미선택"
    : typeof v === "number"
      ? key === "homeOverride"
        ? money(v)
        : `${fmt(v)}${key === "pensionOffset" || key === "homeMonth" ? "개월" : key === "homeYear" ? "년" : ""}`
      : String(v);
function householdValue(value: unknown, key: string) {
  if (key === "hasSpouse" && typeof value === "boolean")
    return value ? "있어요" : "없어요";
  const rate = [
    "inflation",
    "wageGrowth",
    "beforeReturn",
    "planReturn",
    "loanRate",
  ].includes(key);
  return typeof value === "number"
    ? !rate &&
      ![
        "endYear",
        "shockYear",
        "jobDelay",
        "benefitMonths",
        "loanMonths",
        "reserveMonths",
      ].includes(key)
      ? money(value)
      : rate
        ? `${fmt(value * 100)}%`
        : `${fmt(value)}${["endYear", "shockYear"].includes(key) ? "년" : ["jobDelay", "benefitMonths", "loanMonths"].includes(key) ? "개월" : key === "reserveMonths" ? "개월치" : "만 원"}`
    : String(value);
}
function LookupHelp({ field }: { field: keyof Household }) {
  const lookup = inputLookups[field];
  if (!lookup) return null;
  return (
    <span className="yp-field-help">
      {lookup.description}
      {lookup.link && (
        <>
          {" "}
          <a href={lookup.link.href} target="_blank" rel="noopener noreferrer">
            {lookup.link.label} (새 창)
          </a>
        </>
      )}
    </span>
  );
}
function save(name: string, text: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob(["\ufeff" + text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

function DetailSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="yp-detail-summary">
      <span>{children}</span>
      <span className="yp-detail-action" aria-hidden="true">
        <span className="yp-detail-open">열기</span>
        <span className="yp-detail-close">닫기</span>
      </span>
    </summary>
  );
}

function InputSources() {
  return (
    <details className="yp-input-sources">
      <DetailSummary>입력할 금액을 모르겠다면</DetailSummary>
      <p>
        <LookupHelp field="pension" />
      </p>
      <p>
        <LookupHelp field="assets" />
      </p>
    </details>
  );
}

function NumberField({
  label,
  value,
  unit = "만 원",
  precision = 1,
  onChange,
  error,
  hint,
  onBlur,
  help,
  onSkip,
}: {
  label: string;
  value: number;
  unit?: string;
  precision?: number;
  onChange: (v: number) => void;
  error?: string;
  hint?: string;
  onBlur?: () => void;
  help?: ReactNode;
  onSkip?: () => void;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const display = Number.isFinite(value)
    ? String(Number(value.toFixed(precision)))
    : "";
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  return (
    <div className="yp-field">
      <div className="yp-field-heading">
        <label htmlFor={inputId}>{label}</label>
        {onSkip && !Number.isFinite(value) && (
          <button
            type="button"
            className="yp-skip-amount"
            onClick={onSkip}
            aria-label={`${label} 건너뛰기 (0원)`}
          >
            건너뛰기
          </button>
        )}
      </div>
      <span className={`yp-input ${error ? "invalid" : ""}`}>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={draft}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          aria-label={label}
          onChange={(e) => {
            const v = e.target.value;
            if (
              !/^-?\d*(\.\d*)?$/.test(v) ||
              (v.split(".")[1]?.length ?? 0) > precision
            )
              return;
            setDraft(v);
            if (v === "") onChange(NaN);
            if (
              v !== "" &&
              v !== "-" &&
              v !== "." &&
              Number.isFinite(Number(v))
            )
              onChange(Number(v));
          }}
          onBlur={() => {
            setDraft(display);
            onBlur?.();
          }}
        />
        <span>{unit}</span>
      </span>
      {unit === "만 원" && Number.isFinite(value) && (
        <small className="yp-note">{money(value)}</small>
      )}
      {help}
      {hint && <small className="yp-note">{hint}</small>}
      {error && (
        <small id={errorId} className="yp-error">
          {error}
        </small>
      )}
    </div>
  );
}
function Charts({
  before,
  after,
  year,
}: {
  before: Simulation;
  after: Simulation;
  year: string;
}) {
  const [separate, setSeparate] = useState(false);
  const data = after.rows
    .filter((r) => r.date.endsWith("12"))
    .map((r) => ({
      year: r.year,
      before: before.rows.find((b) => b.date === r.date)?.realAssets,
      after: r.realAssets,
    }));
  const all = [...before.rows, ...after.rows].map((r) => r.realAssets),
    lo = Math.min(0, ...all),
    hi = Math.max(...all, after.reserve),
    padding = (hi - lo) * 0.08 || 100;
  const plot = (which?: "before" | "after") => (
    <div
      className="yp-plot"
      role="img"
      aria-label={`${which === "before" ? "계획 적용 전" : which === "after" ? "계획 적용 후" : "계획 적용 전후"} 금융자산 그래프. 최저 ${money((which === "before" ? before : after).minAssets)}, 최초 부족 ${dateText((which === "before" ? before : after).firstNegative)}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 18, right: 12, bottom: 2, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="year"
            minTickGap={35}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)" }}
          />
          <YAxis
            width={80}
            domain={[lo - padding, hi + padding]}
            tickFormatter={(v) => moneyAxis(Number(v))}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)" }}
          />
          <Tooltip
            formatter={(v) => money(Number(v))}
            labelFormatter={(v) => `${v}년 말`}
            contentStyle={{
              borderRadius: 12,
              borderColor: "var(--line)",
              backgroundColor: "var(--flow-surface)",
            }}
            itemStyle={{ color: "var(--ink)" }}
          />
          <ReferenceLine y={0} stroke="var(--error-ink)" />
          <ReferenceLine
            y={after.reserve}
            stroke="var(--warning-ink)"
            strokeDasharray="3 5"
          />
          {which !== "after" && (
            <Line
              dataKey="before"
              name="계획 적용 전"
              dot={false}
              stroke="var(--baseline)"
              strokeDasharray="6 4"
              strokeWidth={2}
              isAnimationActive={false}
            />
          )}
          {which !== "before" && (
            <Line
              dataKey="after"
              name="계획 적용 후"
              dot={false}
              stroke="var(--plot-plan)"
              strokeWidth={3}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <section className="yp-card">
      <div className="yp-section-heading">
        <div>
          <h2>연도별 남는 돈</h2>
          <p>연말 잔액 · {year}년 돈의 가치로 환산</p>
        </div>
        <button aria-pressed={separate} onClick={() => setSeparate(!separate)}>
          {separate ? "겹쳐 보기" : "나란히 보기"}
        </button>
      </div>
      <div className="yp-legend">
        <span>┅ 계획 적용 전</span>
        <span>━ 계획 적용 후</span>
        <span>┈ 비상자금 기준</span>
        <span>─ 자산 0</span>
      </div>
      {separate ? (
        <div className="yp-two-charts">
          <div>
            <h3>계획 적용 전</h3>
            {plot("before")}
          </div>
          <div>
            <h3>계획 적용 후</h3>
            {plot("after")}
          </div>
        </div>
      ) : (
        plot()
      )}
      <p className="yp-note">
        0 아래는 충당하지 못한 부족액이에요. 비상자금 기준은{" "}
        {money(after.reserve)}이에요.
      </p>
    </section>
  );
}
type PlannerView = "home" | "chat" | "manual" | "result";

const guideSteps = [
  [
    "은퇴 시기와 생활비를 알려주세요",
    "은퇴 예정월부터 한 가지씩 답하면 자금 전망을 계산할 수 있어요.",
  ],
  [
    "돈이 언제 부족해지는지 확인해요",
    "잔액이 처음 0원 아래로 내려가는 달부터 확인해 보세요.",
  ],
  [
    "준비 방법을 바꿔 결과를 비교해요",
    "재취업이나 주택연금을 눌러 보세요. 아래 금액이 바로 바뀌어요.",
  ],
];

function PlanningGuide({
  onStart,
  onManual,
  onExample,
}: {
  onStart: () => void;
  onManual: () => void;
  onExample: () => void;
}) {
  const [demoLiving, setDemoLiving] = useState(example.living);
  const [demoPlan, setDemoPlan] = useState(adopted);
  const before = useMemo(() => calculate(example, none, false), []);
  const after = useMemo(() => calculate(example, demoPlan), [demoPlan]);

  return (
    <section
      className="yp-planning-guide"
      id="yp-guide"
      aria-labelledby="yp-guide-title"
      tabIndex={-1}
    >
      <div className="yp-guide-hero">
        <h1 id="yp-guide-title">이용안내</h1>
        <p>
          직접 입력과 대화 중 편한 방법을 고르고, 권 부장 부부 예시로 결과를
          살펴보세요.
        </p>
      </div>
      <nav className="yp-guide-index" aria-label="기능별 이용안내">
        <a href="#yp-guide-manual">직접 입력</a>
        <a href="#yp-guide-step-1">대화로 입력</a>
        <a href="#yp-guide-step-2">자금 전망</a>
        <a href="#yp-guide-step-3">은퇴 계획 선택</a>
        <a href="#yp-guide-chart">그래프 비교</a>
        <a href="#yp-guide-tools">결과 설명·저장</a>
      </nav>
      <section
        className="yp-guide-stage"
        id="yp-guide-manual"
        aria-labelledby="yp-guide-manual-title"
        tabIndex={-1}
      >
        <div className="yp-guide-step">
          <h2 id="yp-guide-manual-title">내 정보를 직접 입력해요</h2>
          <p>
            생활비, 모아둔 돈, 예상 연금을 알고 있다면 입력 화면에서 바로 시작할
            수 있어요.
          </p>
        </div>
        <section className="yp-guide-demo" aria-label="직접 입력 예시">
          <header>
            <h3>생활비와 자산</h3>
          </header>
          <div className="yp-guide-demo-body">
            <div className="yp-guide-spotlight">
              <NumberField
                label="월 생활비"
                value={demoLiving}
                onChange={setDemoLiving}
              />
            </div>
            <p className="yp-guide-bubble">
              250만 원은 250으로 입력해요. 여기서 바꾼 금액은 안내 예시에만
              쓰여요.
            </p>
            <button type="button" className="yp-primary" onClick={onManual}>
              내 정보 직접 입력하기
            </button>
          </div>
        </section>
      </section>
      <ol className="yp-guide-stages" role="list">
        {guideSteps.map(([title, description], step) => (
          <li
            className="yp-guide-stage"
            id={`yp-guide-step-${step + 1}`}
            key={title}
            tabIndex={-1}
          >
            <div className="yp-guide-step">
              <p className="yp-guide-count">{step + 1}단계</p>
              <h2>{title}</h2>
            </div>
            <section
              className="yp-guide-demo"
              aria-label={`${title} 예시 화면`}
            >
              <header>
                <h3>{["은퇴 계획 상담", "자금 전망", "은퇴 계획"][step]}</h3>
              </header>
              <div className="yp-guide-demo-body">
                {step === 0 ? (
                  <>
                    <p
                      className="yp-guide-spotlight"
                      aria-describedby="yp-guide-chat-tip"
                    >
                      은퇴 예정월은 언제인가요?
                    </p>
                    <p className="yp-guide-bubble" id="yp-guide-chat-tip">
                      {description}
                    </p>
                    <p className="yp-guide-reply">
                      {dateText(example.retire)}에 은퇴할 예정이에요.
                    </p>
                  </>
                ) : (
                  <>
                    {step === 2 && (
                      <fieldset
                        className="yp-guide-options yp-guide-spotlight"
                        aria-describedby="yp-guide-plan-tip"
                      >
                        <legend>은퇴 준비 방법 선택</legend>
                        {(
                          [
                            ["job", "재취업"],
                            ["home", "주택연금"],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={demoPlan[key]}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setDemoPlan((current) => ({
                                  ...current,
                                  [key]: checked,
                                }));
                              }}
                            />
                            {label}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {step === 2 && (
                      <p className="yp-guide-bubble" id="yp-guide-plan-tip">
                        {description}
                      </p>
                    )}
                    <dl
                      className="yp-guide-metrics"
                      aria-describedby={
                        step === 1 ? "yp-guide-result-tip" : undefined
                      }
                      aria-live={step === 2 ? "polite" : undefined}
                    >
                      <div
                        className={
                          step === 1 ? "yp-guide-result-spotlight" : undefined
                        }
                      >
                        <dt>돈이 처음 부족한 때</dt>
                        <dd>
                          {dateText(
                            (step === 1 ? before : after).firstNegative,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>가장 적게 남는 돈</dt>
                        <dd>
                          {money((step === 1 ? before : after).minAssets)}
                        </dd>
                      </div>
                    </dl>
                    {step === 1 && (
                      <p className="yp-guide-bubble" id="yp-guide-result-tip">
                        {description}
                      </p>
                    )}
                  </>
                )}
                {step < 2 ? (
                  <a
                    className="yp-guide-next"
                    href={`#yp-guide-step-${step + 2}`}
                  >
                    {step === 0 ? "예시 답변 보내기" : "은퇴 계획 열기"}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="yp-primary"
                    onClick={onStart}
                  >
                    내 정보로 시작하기
                  </button>
                )}
              </div>
            </section>
          </li>
        ))}
      </ol>
      <section
        className="yp-guide-stage yp-guide-chart-stage"
        id="yp-guide-chart"
        aria-labelledby="yp-guide-chart-title"
        tabIndex={-1}
      >
        <div className="yp-guide-step">
          <h2 id="yp-guide-chart-title">계획 적용 전후를 비교해요</h2>
          <p>
            같은 가구 정보를 기준으로 준비 방법을 적용했을 때 잔액이 어떻게
            달라지는지 볼 수 있어요.
          </p>
        </div>
        <div className="yp-guide-chart">
          <Charts
            before={before}
            after={after}
            year={example.start.slice(0, 4)}
          />
          <p className="yp-guide-bubble">
            점선은 계획 적용 전, 실선은 적용 후예요. ‘나란히 보기’를 누르면
            그래프를 각각 볼 수 있어요.
          </p>
        </div>
      </section>
      <section
        className="yp-guide-stage"
        id="yp-guide-tools"
        aria-labelledby="yp-guide-tools-title"
        tabIndex={-1}
      >
        <div className="yp-guide-step">
          <h2 id="yp-guide-tools-title">결과를 더 살펴보고 이어서 봐요</h2>
        </div>
        <dl className="yp-guide-tool-list">
          <div>
            <dt>결과 설명 보기</dt>
            <dd>
              결과 화면에서 누르면 상담이 열리고 현재 계산 결과에 대한 설명을
              요청해요.
            </dd>
          </div>
          <div>
            <dt>계산 기준</dt>
            <dd>
              결과 화면에서 물가 상승률과 수익률, 월별 수입·지출 내역을 확인할
              수 있어요.
            </dd>
          </div>
          <div>
            <dt>저장한 결과 이어보기</dt>
            <dd>
              내가 입력한 내용은 같은 브라우저에 저장돼요. 메인에서 저장한
              입력이나 결과를 다시 열 수 있어요.
            </dd>
          </div>
        </dl>
      </section>
      <div className="yp-guide-controls">
        <button type="button" onClick={onExample}>
          권 부장 부부 예시 보기
        </button>
        <button type="button" className="yp-text-button" onClick={onManual}>
          직접 입력하기
        </button>
      </div>
    </section>
  );
}

type Theme = "light" | "dark";
const themeKey = "afterfolio:theme";

export default function Planner() {
  const pathname = usePathname();
  const isExample = pathname === "/dashboard/example";
  const [chatOpen, setChatOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(themeKey);
    } catch {
      // A blocked storage setting can still use the device preference.
    }
    setTheme(
      saved === "dark" || saved === "light"
        ? saved
        : preference.matches
          ? "dark"
          : "light",
    );
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      window.localStorage.setItem(themeKey, next);
    } catch {
      // Keep the selection for the current session.
    }
  }
  return (
    <PlannerWorkspace
      key={isExample ? "example" : "personal"}
      pathname={pathname}
      isExample={isExample}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      accessToken={accessToken}
      setAccessToken={setAccessToken}
      theme={theme}
      onToggleTheme={toggleTheme}
    />
  );
}

function PlannerWorkspace({
  pathname,
  isExample,
  chatOpen,
  setChatOpen,
  accessToken,
  setAccessToken,
  theme,
  onToggleTheme,
}: {
  pathname: string;
  isExample: boolean;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  accessToken: string;
  setAccessToken: (token: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [h, setHousehold] = useState<Household>(() =>
      isExample ? { ...example } : blankHousehold(),
    ),
    [s, setS] = useState<Solutions>(() =>
      isExample
        ? { ...adopted }
        : { ...none, homeYear: new Date().getFullYear() },
    );
  const revision = useRef(0);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [origins, setOrigins] = useState<
    Partial<Record<keyof Household, Origin>>
  >({});
  function setH(action: Household | ((v: Household) => Household)) {
    revision.current++;
    setHousehold(action);
  }
  const [exampleInfo, setExampleInfo] = useState(false);
  const [hasOpenedChat, setHasOpenedChat] = useState(chatOpen);
  const router = useRouter();
  const [view, setView] = useState<"manual" | "result" | null>(null);
  const [showMonthly, setShowMonthly] = useState(false);
  const chatLauncher = useRef<HTMLButtonElement | null>(null);
  const chatClose = useRef<HTMLButtonElement | null>(null);
  const main = useRef<HTMLElement | null>(null);
  const [notice, setNotice] = useState(""),
    [fileError, setFileError] = useState(""),
    [question, setQuestion] = useState(""),
    [submittedQuestion, setSubmittedQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [waitingSeconds, setWaitingSeconds] = useState(0),
    [aiError, setAIError] = useState(""),
    [retryUntil, setRetryUntil] = useState(0),
    [retrySeconds, setRetrySeconds] = useState(0),
    [homeOverrideError, setHomeOverrideError] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [undo, setUndo] = useState<{
      h: Household;
      s: Solutions;
      origins?: Partial<Record<keyof Household, Origin>>;
    } | null>(null),
    [applied, setApplied] = useState("");
  const abort = useRef<AbortController | null>(null),
    submittedExplanation = useRef(false),
    sending = useRef(false),
    thread = useRef<HTMLDivElement | null>(null),
    agentInput = useRef<HTMLTextAreaElement | null>(null),
    resetDialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, busy, aiError, view, chatOpen, pathname]);
  useEffect(() => {
    setWaitingSeconds(0);
    if (!busy) return;
    const timer = window.setInterval(
      () => setWaitingSeconds((v) => v + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!retryUntil) return;
    function tick() {
      const seconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setRetrySeconds(seconds);
      if (!seconds) setRetryUntil(0);
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  const [needsToken, setNeedsToken] = useState(false);
  const snapshot = JSON.stringify({ h, s }),
    snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    if (isExample) return;
    try {
      const saved = window.localStorage.getItem(sessionKey);
      if (saved) {
        const restored = readPlannerSession(saved);
        revision.current = restored.revision;
        setHousehold(restored.household);
        setS(restored.solutions);
        setOrigins(restored.origins);
        setMessages(restored.messages);
        setQuestion(restored.question);
      }
    } catch {
      setStorageError("이 브라우저에 저장된 내용을 불러오지 못했어요.");
    } finally {
      setStorageReady(true);
    }
  }, [isExample]);
  useEffect(() => {
    if (
      isExample ||
      !storageReady ||
      (!Object.keys(origins).length && !messages.length && !question)
    )
      return;
    try {
      window.localStorage.setItem(
        sessionKey,
        JSON.stringify({
          household: h,
          solutions: s,
          origins,
          messages,
          question,
          tab: "result",
          ai: chatOpen,
          revision: revision.current,
          snapshot,
        }),
      );
      setStorageError("");
    } catch {
      setStorageError("이 브라우저에 자동 저장하지 못했어요.");
    }
  }, [
    isExample,
    storageReady,
    h,
    s,
    origins,
    messages,
    question,
    chatOpen,
    snapshot,
  ]);
  const result = useMemo(() => {
    try {
      const ready = prepareScenario(h, s).household;
      if (!ready) return null;
      return {
        before: calculate(ready, none, false),
        after: calculate(ready, s, true),
      };
    } catch {
      return null;
    }
  }, [h, s]);
  useEffect(() => {
    if (pathname === "/dashboard" && view === null && result) setView("result");
  }, [pathname, view, result]);
  const prepared = prepareScenario(h, s);
  const pendingIntake = messages.findLast(
    (m) =>
      m.reply.intake &&
      m.snapshot === snapshot &&
      m.revision === revision.current,
  );
  const pendingPatch = pendingIntake?.reply.intake?.patch ?? {};
  const pendingSkips = pendingIntake?.reply.intake?.skipped ?? [];
  const intake = mergeIntake(h, s, pendingPatch);
  const intakePrepared = prepareScenario(intake.household, intake.solutions);
  const nextAmount = nextIntakeField(intake.household, intake.solutions);
  const skippedAmounts = skippableMoneyFields.filter(
    (key) =>
      origins[key] === "skipped" &&
      h[key] === 0 &&
      !(
        h.hasSpouse === false &&
        (key.startsWith("spouse") || key.startsWith("catchup"))
      ),
  );
  const intakeComplete =
    Boolean(intakePrepared.household) &&
    solutionSchema.safeParse(intake.solutions).success;
  const activeView =
    pathname === "/main"
      ? "home"
      : pathname === "/guide"
        ? "guide"
        : pathname === "/chat"
          ? "chat"
          : isExample
            ? "result"
            : (view ?? (result ? "result" : "manual"));
  const inlineChat = activeView === "chat";
  const collecting = inlineChat || !result;
  const chatting = inlineChat || chatOpen;
  const showConversation = chatting || hasOpenedChat;
  const settings = activeView === "manual";
  const conversation = messages.filter(
    (m) => Boolean(m.reply.intake) === collecting,
  );
  const [checkInput, setCheckInput] = useState(false);

  function goTo(next: PlannerView) {
    const request = abort.current;
    abort.current = null;
    request?.abort();
    sending.current = false;
    setBusy(false);
    if (next === "manual" || next === "result") setView(next);
    const path =
      next === "home"
        ? "/main"
        : next === "chat"
          ? "/chat"
          : next === "result" && isExample
            ? "/dashboard/example"
            : "/dashboard";
    if (path !== pathname) router.push(path);
    setCheckInput(false);
    setAIError("");
    if (next !== "result") setExampleInfo(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      main.current?.focus({ preventScroll: true });
    });
  }

  function openChat() {
    setHasOpenedChat(true);
    setChatOpen(true);
    requestAnimationFrame(() => {
      const touchLayout = window.matchMedia(
        "(max-width: 700px), (pointer: coarse)",
      ).matches;
      (touchLayout ? chatClose.current : agentInput.current)?.focus({
        preventScroll: true,
      });
    });
  }

  function closeChat() {
    setChatOpen(false);
    requestAnimationFrame(() =>
      chatLauncher.current?.focus({ preventScroll: true }),
    );
  }

  function showResult() {
    goTo("result");
  }

  function jumpToSection(section: "plan" | "result") {
    const target = document.getElementById(`yp-${section}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
  }
  function applyIntake(openResult: boolean) {
    if (busy || (openResult && !intakeComplete)) {
      setCheckInput(true);
      return;
    }
    if (Object.keys(pendingPatch).length) {
      setUndo({ h, s, origins });
      setH(intake.household);
      setS(intake.solutions);
      setOrigins((previous) => ({
        ...previous,
        ...Object.fromEntries(
          Object.keys(pendingPatch).map((key) => [
            key,
            pendingSkips.some((field) => field === key) ? "skipped" : "chat",
          ]),
        ),
      }));
      setApplied("");
      setNotice("대화에서 확인한 정보를 반영했어요.");
    }
    setCheckInput(false);
    if (openResult) showResult();
  }
  const validation = householdSchema.safeParse(h),
    planValidation = solutionSchema.safeParse(s);
  const update = (
    key: keyof Household,
    value: string | number | boolean | undefined,
    origin: Origin = "manual",
  ) => {
    if (key === "hasSpouse" && value === false)
      setS((v) => ({ ...v, catchup: false }));
    setH((v) => ({ ...v, [key]: value }));
    setOrigins((v) => ({ ...v, [key]: origin }));
    setNotice("");
    setApplied("");
    setUndo(null);
  };
  const setPlan = (patch: Partial<Solutions>) => {
    setS((v) => ({ ...v, ...patch }));
    setApplied("");
    setUndo(null);
  };
  function field([key, label, unit]: FieldSpec) {
    if (h.hasSpouse === false && key.startsWith("spouse")) return null;
    if (key === "living" && h.hasSpouse === false) label = "본인 월 생활비";
    const issues = validation.success ? [] : validation.error.issues;
    const issue = issues.find((i) => i.path[0] === key);
    const invalid =
      Boolean(issue) &&
      (typeof h[key] === "number" ? Number.isFinite(h[key]) : Boolean(h[key]));
    const suffix = unit || "만 원",
      scale = unit === "%" ? 100 : unit === "원" ? 10000 : 1;
    const error = !invalid
      ? undefined
      : issue?.code === "too_small"
        ? `${fmt(Number(issue.minimum) * scale)}${suffix} 이상으로 입력해 주세요.`
        : issue?.code === "too_big"
          ? `${fmt(Number(issue.maximum) * scale)}${suffix} 이하로 입력해 주세요.`
          : issue
            ? "숫자 형식을 확인해 주세요. 연도·기간은 정수로 입력해요."
            : undefined;
    if (unit === "month")
      return (
        <label key={key} className="yp-field">
          <span>{label}</span>
          <input
            type="month"
            aria-label={label}
            value={h[key] as string}
            min="1950-01"
            max="2120-12"
            onChange={(e) => update(key, e.target.value)}
            aria-invalid={invalid}
          />
          {origins[key] === "example" && (
            <small className="yp-note">예시에서 채운 값</small>
          )}
        </label>
      );
    const value = h[key] as number;
    return (
      <NumberField
        key={key}
        label={label}
        value={value * scale}
        unit={unit}
        precision={unit === "%" ? 4 : unit === "원" ? 0 : 1}
        onChange={(v) => update(key, v / scale)}
        error={error}
        help={
          isSkippableMoneyField(key) ? <LookupHelp field={key} /> : undefined
        }
        onSkip={
          isSkippableMoneyField(key)
            ? () => update(key, 0, "skipped")
            : undefined
        }
        hint={
          key === "propertyHealthPremium"
            ? "지역가입 때 적용할 재산분만 입력해 주세요. 0원 또는 빈칸이면 재산분은 0원으로 계산해요."
            : origins[key] === "skipped"
              ? "건너뛴 금액은 0원으로 계산해요."
              : origins[key] === "example"
                ? "예시에서 채운 값"
                : undefined
        }
      />
    );
  }
  function resetPlanner() {
    resetDialog.current?.close();
    try {
      window.localStorage.removeItem(sessionKey);
      setStorageError("");
    } catch {
      setStorageError("브라우저에 저장된 내용을 지우지 못했어요.");
      return;
    }
    setUndo(null);
    setH(blankHousehold());
    setS({
      ...none,
      homeYear: new Date().getFullYear(),
      homeMonth: 2,
    });
    setOrigins({});
    setMessages([]);
    setQuestion("");
    setChatOpen(false);
    goTo("home");
    setExampleInfo(false);
    setApplied("");
    setFileError("");
    setAIError("");
    setNotice("입력과 대화를 초기화했어요.");
  }
  function restoreInput() {
    if (!undo) return;
    if (activeView === "result" && !prepareScenario(undo.h, undo.s).household)
      goTo("manual");
    setH(undo.h);
    setS(undo.s);
    setOrigins(undo.origins || {});
    setUndo(null);
    setApplied("");
    setNotice("이전 입력으로 되돌렸어요.");
  }
  async function ask(prompt = question, clearDraft = true, explain = false) {
    const q = prompt.trim();
    const inputAction =
      collecting &&
      !explain &&
      resolveIntakeInputAction(q, intake.household, intake.solutions);
    if (!q || sending.current || (!inputAction && retryUntil > Date.now()))
      return;
    sending.current = true;
    submittedExplanation.current = explain;
    setSubmittedQuestion(q);
    setBusy(true);
    setAIError("");
    setCheckInput(false);
    const request = new AbortController();
    abort.current = request;
    const signal = request.signal,
      snap = snapshot;
    const requestRevision = revision.current;
    const pendingPatch = collecting
      ? pendingIntake?.reply.intake?.patch
      : undefined;
    const history = conversation.slice(-5).flatMap((m) => [
      { role: "user" as const, content: m.question },
      { role: "assistant" as const, content: m.reply.answer.slice(0, 6000) },
    ]);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          question: q,
          operation: explain ? "explain" : collecting ? "collect" : "analyze",
          household: cleanDraft({ ...h, ...pendingPatch }),
          pendingIntake: Boolean(
            pendingPatch && Object.keys(pendingPatch).length,
          ),
          solutions: s,
          history,
          previousCandidates: messages
            .filter((m) => m.snapshot === snap)
            .flatMap((m) => m.reply.candidates)
            .slice(-6),
        }),
        signal,
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 401) setNeedsToken(true);
        const wait = Number(response.headers.get("Retry-After"));
        if (Number.isInteger(wait) && wait > 0) {
          setRetrySeconds(wait);
          setRetryUntil(Date.now() + wait * 1000);
        }
        const reference =
          typeof body.requestId === "string" &&
          /^[a-f0-9-]{36}$/i.test(body.requestId)
            ? `\n오류 추적 ID: ${body.requestId}`
            : "";
        throw Error((body.error || "AI 연결을 확인해 주세요.") + reference);
      }
      if (signal.aborted) return;
      if (body.intake) {
        const latestPatch = body.intake.patch;
        const patch = { ...pendingPatch, ...latestPatch };
        if ((patch.hasSpouse ?? h.hasSpouse) === false) {
          delete patch.spouseBirth;
          delete patch.spouseIncome;
          delete patch.spousePension;
          delete patch.spouseEnd;
        }
        body.intake.patch = patch;
        body.intake.skipped = skippableMoneyFields.filter(
          (field) =>
            patch[field] === 0 &&
            (body.intake.skipped?.includes(field) ||
              (collecting &&
                pendingSkips.includes(field) &&
                !Object.hasOwn(latestPatch, field))),
        );
      }
      setMessages((m) => [
        ...m,
        { question: q, reply: body, snapshot: snap, revision: requestRevision },
      ]);
      if (clearDraft) setQuestion("");
    } catch (e) {
      if (abort.current !== request) return;
      if (signal.aborted)
        setAIError("분석을 중단했어요. 질문을 수정하거나 다시 보낼 수 있어요.");
      else setAIError(e instanceof Error ? e.message : "AI 연결에 실패했어요.");
    } finally {
      if (abort.current === request) {
        abort.current = null;
        sending.current = false;
        setBusy(false);
        agentInput.current?.focus();
      }
    }
  }
  function applyCandidate(c: Candidate, snap: string) {
    if (snapshotRef.current !== snap) {
      setAIError(
        "분석 이후 조건이 바뀌었어요. 현재 조건으로 다시 질문해 주세요.",
      );
      return;
    }
    const nextH = householdSchema.safeParse(c.household),
      nextS = solutionSchema.safeParse(c.plan);
    if (!nextH.success || !nextS.success) {
      setAIError("제안된 조건을 적용할 수 없어요. 다시 분석해 주세요.");
      return;
    }
    setUndo({ h, s, origins });
    const baseline = prepareScenario(h, s).household;
    if (!baseline) return;
    const changed = Object.keys(nextH.data).filter(
      (k) =>
        nextH.data[k as keyof Household] !== baseline[k as keyof Household],
    );
    setH((v) => ({
      ...v,
      ...Object.fromEntries(
        changed.map((k) => [k, nextH.data[k as keyof Household]]),
      ),
    }));
    setOrigins((v) => ({
      ...v,
      ...Object.fromEntries(changed.map((k) => [k, "chat"])),
    }));
    setS(nextS.data);
    setApplied(c.name);
    setNotice(`${c.name}을 적용했어요.`);
    requestAnimationFrame(() => jumpToSection("result"));
  }
  const changes = (Object.keys(s) as (keyof Solutions)[]).filter(
    (k) => s[k] !== adopted[k],
  );
  function csv() {
    if (!result) return;
    const lines = [
      "모델,계획,월,수입,지출,운용수익,금융자산,기준년구매력자산,대출잔액,건강보험료,주택연금",
    ];
    for (const [name, r] of [
      ["계획 적용 전", result.before],
      ["계획 적용 후", result.after],
    ] as const)
      for (const row of r.rows)
        lines.push(
          [
            version,
            name,
            row.date,
            row.income,
            row.expenses,
            row.interest,
            row.assets,
            row.realAssets,
            row.loan,
            row.components.건강보험,
            row.components.주택연금,
          ].join(","),
        );
    save("영플래너_월별계산.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }
  function verification() {
    const before = calculate(example, none, false),
      after = calculate(example, adopted);
    const amounts = [
      ["계획 적용 전 생애 순수지", -29594.690440884406, before.lifeNet],
      ["계획 적용 전 최저 자산", -21448.8646698769, before.minAssets],
      ["계획 적용 전 기말 자산", -42054.2748723114, before.endAssets],
      ["계획 적용 후 최저 자산", 3558.62969139837, after.minAssets],
      ["계획 적용 후 생애 순수지", 5297.375649082209, after.lifeNet],
      ["계획 적용 후 기말 자산", 13544.9407901184, after.endAssets],
    ] as const;
    const rows = [
      ["모델", "지표", "단위", "기준값", "계산값", "차이"],
      [
        version,
        "계획 적용 전 최초 부족월",
        "연월",
        "2031-02",
        before.firstNegative ?? "없음",
        before.firstNegative === "2031-02" ? "일치" : "불일치",
      ],
      [
        version,
        "계획 적용 후 최초 부족월",
        "연월",
        "없음",
        after.firstNegative ?? "없음",
        after.firstNegative === null ? "일치" : "불일치",
      ],
      ...amounts.map(([label, expected, actual]) => [
        version,
        label,
        "만원",
        expected,
        actual,
        actual - expected,
      ]),
    ];
    save(
      "영플래너_검증대조.csv",
      rows.map((row) => row.join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }
  const current = result?.after;
  const housing = homePaymentDetails(
    h,
    s.homeYear,
    s.homeMonth,
    s.homeOverride,
  );
  const housingStart = s.home
    ? current?.rows.find((row) => row.components.주택연금 > 0)?.date
    : undefined;
  return (
    <div
      className={`yp-app yp-flow yp-view-${activeView} ${chatOpen && !inlineChat ? "yp-chat-visible" : ""}`}
      data-theme={theme}
    >
      <a className="yp-skip" href="#yp-main">
        본문으로 건너뛰기
      </a>
      <header className="yp-header">
        <Link className="yp-brand" href="/main">
          <svg className="yp-brand-mark" viewBox="0 0 36 44" aria-hidden="true">
            <path fill="currentColor" d="m6 9 12-7 12 7-4 2v6H10v-6Z" />
            <path fill="#7194c1" d="m18 2 12 7-4 2v6h-8Z" />
            <path fill="currentColor" d="M8 17h20l6 25H23l-2-7h-6l-2 7H2Z" />
            <path fill="#a2b9d8" d="M18 17h10l6 25H23l-2-7h-3Z" />
            <path fill="#789aca" d="m3 15 15-3 15 3v4l-15-2-15 2Z" />
            <path fill="var(--coast-paper)" d="m18 23 3 7h-6Z" />
          </svg>
          afterfolio
        </Link>
        <div className="yp-header-actions">
          <button
            className="yp-theme-toggle"
            type="button"
            aria-label={
              theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"
            }
            title={
              theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"
            }
            onClick={onToggleTheme}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {theme === "light" ? (
                <path d="M20.8 14.2A9 9 0 0 1 9.8 3.2a9 9 0 1 0 11 11Z" />
              ) : (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" />
                </>
              )}
            </svg>
          </button>
          {activeView !== "home" && (
            <button
              className="yp-header-action"
              type="button"
              onClick={() => goTo("home")}
            >
              처음으로
            </button>
          )}
        </div>
      </header>
      <main className="yp-main" id="yp-main" tabIndex={-1} ref={main}>
        {activeView === "home" ? (
          <section className="yp-landing" aria-labelledby="yp-landing-title">
            <div className="yp-landing-copy">
              <div className="yp-landing-sky">
                <h1 id="yp-landing-title">
                  은퇴 후 생활비,
                  <br />
                  얼마나 오래 쓸 수 있을까요?
                </h1>
                <p>
                  매달 쓰는 돈과 연금, 모아둔 돈을 입력하면 앞으로의 생활을 미리
                  살펴볼 수 있어요.
                </p>
              </div>
              <div className="yp-landing-sea">
                <div className="yp-landing-actions">
                  <button className="yp-primary" onClick={() => goTo("chat")}>
                    대화로 시작하기
                  </button>
                  <Link href="/guide">이용안내</Link>
                </div>
                {storageReady &&
                  (result || Object.keys(origins).length > 0) && (
                    <button
                      className="yp-text-button"
                      onClick={() => (result ? showResult() : goTo("manual"))}
                    >
                      저장한 {result ? "결과" : "입력"} 이어보기
                    </button>
                  )}
              </div>
            </div>
          </section>
        ) : activeView === "guide" ? (
          <PlanningGuide
            onStart={() => goTo("chat")}
            onManual={() => goTo("manual")}
            onExample={() => router.push("/dashboard/example")}
          />
        ) : (
          <section className="yp-intro">
            <h1>
              {
                {
                  chat: "은퇴 계획 상담",
                  manual: "은퇴 계획 입력",
                  result: isExample
                    ? "권 부장 부부의 자금 전망"
                    : "내 자금 전망",
                }[activeView]
              }
            </h1>
            <p>
              {activeView === "chat"
                ? "필요한 정보를 하나씩 묻고, 입력한 내용으로 은퇴 후 생활비를 계산해요."
                : activeView === "manual"
                  ? "생활비, 모아둔 돈, 연금 예상액을 입력해 주세요."
                  : !current
                    ? "계산에 필요한 계획 조건을 확인해 주세요."
                    : `분석 기간: ${h.start} ~ ${h.endYear}-12`}
            </p>
          </section>
        )}
        {activeView === "result" && (
          <div className="yp-flow-toolbar">
            <button onClick={() => goTo(isExample ? "chat" : "manual")}>
              {isExample ? "내 정보 입력" : "입력 수정"}
            </button>
            {isExample && (
              <>
                <button
                  aria-expanded={exampleInfo}
                  aria-controls="yp-example-info"
                  onClick={() => setExampleInfo(!exampleInfo)}
                >
                  {exampleInfo ? "예시 소개 닫기" : "예시 소개 열기"}
                </button>
                <Link className="yp-result-link" href="/dashboard">
                  내 결과 보기
                </Link>
              </>
            )}
          </div>
        )}
        <dialog
          ref={resetDialog}
          className="yp-card yp-reset-dialog"
          aria-labelledby="yp-reset-title"
        >
          <h2 id="yp-reset-title">저장한 내용을 초기화할까요?</h2>
          <p>이 브라우저에 저장된 입력과 대화가 모두 지워져요.</p>
          <div className="yp-actions">
            <button
              type="button"
              autoFocus
              onClick={() => resetDialog.current?.close()}
            >
              취소
            </button>
            <button type="button" className="yp-danger" onClick={resetPlanner}>
              초기화 확인
            </button>
          </div>
        </dialog>
        {exampleInfo && (
          <section
            className="yp-example-info"
            id="yp-example-info"
            aria-labelledby="yp-example-title"
          >
            <div className="yp-section-heading">
              <div>
                <p className="yp-eyebrow">
                  가상의 고객 사례 · {example.start} 기준
                </p>
                <h2 id="yp-example-title">
                  정년과 연금 사이, 생활비를 어떻게 마련할까요?
                </h2>
              </div>
              <button
                aria-label="예시 소개 패널 닫기"
                onClick={() => setExampleInfo(false)}
              >
                ×
              </button>
            </div>
            <p>
              권 부장은 {example.birth.slice(0, 4)}년생으로{" "}
              {dateText(example.retire)} 은퇴를 앞두고 있어요. 배우자는{" "}
              {example.spouseBirth.slice(0, 4)}년생이며{" "}
              {dateText(example.spouseEnd)}까지 일할 예정이에요. 은퇴 후
              국민연금이 나오기 전까지 생활자금이 충분한지, 어떤 준비가 필요한지
              비교하는 사례예요.
            </p>
            <dl>
              {[
                ["부부 월소득", money(example.income + example.spouseIncome)],
                ["월 생활비", money(example.living)],
                ["예금·투자금", money(example.assets)],
                [
                  "집값 / 남은 주택대출",
                  money(example.house) + " / " + money(example.loan),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="yp-note">
              예시의 기본 은퇴 계획이 적용되어 있어요. 이 화면에서 계획을 바꿔도
              내 결과에는 반영되지 않아요.
            </p>
          </section>
        )}
        {notice && activeView !== "home" && (
          <div className="yp-notice">
            <span role="status">{notice}</span>
            <div className="yp-notice-actions">
              {undo && activeView === "result" && (
                <button className="yp-text-button" onClick={restoreInput}>
                  되돌리기
                </button>
              )}
              <button aria-label="알림 닫기" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          </div>
        )}
        <div className="yp-workspace">
          {settings && (
            <section
              id="yp-settings"
              className="yp-card yp-settings"
              aria-labelledby="yp-settings-title"
            >
              <div className="yp-panel-heading">
                <div>
                  <h2 id="yp-settings-title">가구 정보</h2>
                  <p className="yp-note">
                    250만 원은 250으로 입력하세요. 모르는 금액은 건너뛰면
                    0원으로 계산해요.
                  </p>
                </div>
              </div>
              <div className="yp-settings-body">
                {groups.map((g, i) => (
                  <details
                    className="yp-input-group"
                    key={g.title}
                    open={i < 2 ? true : undefined}
                  >
                    <DetailSummary>{g.title}</DetailSummary>
                    <p className="yp-note">{g.description}</p>
                    <div className="yp-field-grid">
                      {g.title === "나와 배우자" && (
                        <label className="yp-field">
                          <span>함께 계산할 배우자</span>
                          <select
                            value={
                              h.hasSpouse === undefined
                                ? h.spouseBirth
                                  ? "yes"
                                  : ""
                                : h.hasSpouse
                                  ? "yes"
                                  : "no"
                            }
                            onChange={(e) =>
                              update(
                                "hasSpouse",
                                e.target.value === ""
                                  ? undefined
                                  : e.target.value === "yes",
                              )
                            }
                          >
                            <option value="">선택해 주세요</option>
                            <option value="yes">있어요</option>
                            <option value="no">없어요</option>
                          </select>
                        </label>
                      )}
                      {g.fields.map(field)}
                    </div>
                  </details>
                ))}
                {(s.job ||
                  s.benefits ||
                  (s.catchup && h.hasSpouse !== false) ||
                  (s.home && !s.homeOverride)) && (
                  <details className="yp-input-group">
                    <DetailSummary>은퇴 계획의 금액·기간 (선택)</DetailSummary>
                    <p className="yp-note">
                      선택한 구직급여, 재취업, 추납, 주택연금의 계산에 쓰이는
                      정보예요. 비워두면 0원·0개월로 계산하고 결과는 볼 수
                      있어요.
                    </p>
                    <div className="yp-field-grid">
                      {(s.job
                        ? ([
                            ["jobIncome", "재취업 월급"],
                            ["jobDelay", "재취업 대기 기간", "개월"],
                          ] as FieldSpec[])
                        : []
                      ).map(field)}
                      {(s.benefits
                        ? ([
                            ["benefit", "구직급여 월액"],
                            ["benefitMonths", "구직급여 기간", "개월"],
                          ] as FieldSpec[])
                        : []
                      ).map(field)}
                      {(s.catchup && h.hasSpouse !== false
                        ? ([
                            ["catchupCost", "추납 비용"],
                            ["catchupPension", "추납 후 배우자 월 연금"],
                          ] as FieldSpec[])
                        : []
                      ).map(field)}
                      {s.home &&
                        !s.homeOverride &&
                        field(["house", "주택연금 계산에 사용할 집값"])}
                    </div>
                  </details>
                )}
                <details className="yp-input-group">
                  <DetailSummary>계산 가정과 추가 지출</DetailSummary>
                  <p className="yp-note">
                    금액은 한 자리까지 표시해요. 예시의 정밀 계산값은 직접
                    수정하기 전까지 유지돼요.
                  </p>
                  <div className="yp-field-grid">
                    {assumptionFields.map(field)}
                  </div>
                </details>
                <details className="yp-input-group">
                  <DetailSummary>저장·불러오기</DetailSummary>
                  <p className="yp-note">
                    자동 저장과 별도로 입력 조건을 내 기기에 파일로 저장할 수
                    있어요.
                  </p>
                  <div className="yp-actions">
                    <button
                      onClick={() =>
                        save(
                          "영플래너_조건.json",
                          JSON.stringify(
                            {
                              version,
                              inputFormat: 2,
                              household: cleanDraft(h),
                              solutions: s,
                            },
                            null,
                            2,
                          ),
                        )
                      }
                    >
                      입력 조건 저장
                    </button>
                    <label className="yp-upload">
                      저장한 조건 불러오기
                      <input
                        type="file"
                        accept=".json"
                        aria-label="저장한 조건 불러오기"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try {
                            if (f.size > 100000) throw Error();
                            const value = JSON.parse(
                              (await f.text()).replace(/^\ufeff/, ""),
                            );
                            const {
                              household: nextH,
                              solutions: nextS,
                              fields,
                            } = readScenarioFile(value);
                            setH(nextH);
                            setOrigins(
                              Object.fromEntries(
                                fields.map((k) => [k, "file"]),
                              ),
                            );
                            setS(nextS);
                            setFileError("");
                            setNotice("저장한 조건을 불러왔어요.");
                            setApplied("");
                            setUndo(null);
                          } catch {
                            setFileError(
                              "이 앱에서 저장한 조건 파일인지 확인해 주세요.",
                            );
                          }
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {fileError && (
                    <p className="yp-error" role="alert">
                      {fileError}
                    </p>
                  )}
                </details>
              </div>
              <div className="yp-panel-foot">
                {checkInput && !result && (
                  <p className="yp-error" role="alert">
                    {prepared.missing.length
                      ? `아직 필요한 정보가 있어요. ${prepared.missing.map((key) => inputLabels[key] || fieldNames[key] || key).join(", ")}을 확인해 주세요.`
                      : "입력한 정보의 형식과 계산 기간을 확인해 주세요."}
                  </p>
                )}
                <div className="yp-actions">
                  <button onClick={() => goTo("chat")}>대화로 입력하기</button>
                  <button
                    className="yp-primary"
                    onClick={() =>
                      result ? showResult() : setCheckInput(true)
                    }
                  >
                    내 결과 보기
                  </button>
                </div>
              </div>
            </section>
          )}
          {activeView === "result" && (
            <div id="yp-analysis" className="yp-analysis">
              {skippedAmounts.length > 0 && (
                <p className="yp-skipped-notice">
                  <strong>건너뛰어 0원으로 계산한 항목</strong>{" "}
                  {skippedAmounts.map((key) => inputLabels[key]).join(" · ")}.
                  실제 금액을 입력하면 결과가 달라질 수 있어요.
                </p>
              )}
              {current && result && (
                <section
                  className="yp-result-summary"
                  aria-label="주요 계산 결과"
                >
                  <dl>
                    <div
                      className={
                        current.firstNegative ? "yp-metric-warning" : ""
                      }
                    >
                      <dt>돈이 처음 부족한 때</dt>
                      <dd className="yp-shortage-change">
                        <span className="yp-shortage-before">
                          <small>계획 적용 전</small>
                          {dateText(result.before.firstNegative)}
                        </span>
                        <span aria-hidden="true">→</span>
                        <span className="yp-shortage-after">
                          <small>계획 적용 후</small>
                          {dateText(current.firstNegative)}
                        </span>
                      </dd>
                    </div>
                    <div
                      className={
                        current.minAssets < 0 ? "yp-metric-warning" : ""
                      }
                    >
                      <dt>가장 적게 남는 돈</dt>
                      <dd>{money(current.minAssets)}</dd>
                      <dd className="yp-metric-detail">
                        {dateText(current.minMonth)} · {h.start.slice(0, 4)}년
                        돈의 가치
                      </dd>
                    </div>
                    <div className={!current.passes ? "yp-metric-warning" : ""}>
                      <dt>비상시 쓸 돈</dt>
                      <dd>{current.passes ? "충족" : "미달"}</dd>
                      <dd className="yp-metric-detail">
                        목표 {money(current.reserve)}
                      </dd>
                    </div>
                    <div
                      className={
                        current.endAssets < 0 ? "yp-metric-warning" : ""
                      }
                    >
                      <dt>{h.endYear}년 말 예상 잔액</dt>
                      <dd>{money(current.endAssets)}</dd>
                      <dd className="yp-metric-detail">
                        물가 환산 전 · {h.endYear}년 금액
                      </dd>
                    </div>
                  </dl>
                </section>
              )}
              <div className="yp-analysis-controls">
                <nav
                  className="yp-section-nav"
                  aria-label="결과 페이지 바로가기"
                >
                  {result && <a href="#yp-result">결과 비교</a>}
                  <a href="#yp-plan">은퇴 계획</a>
                  {result && <a href="#yp-basis">계산 기준</a>}
                </nav>
                {result && current && (
                  <button
                    className="yp-explain-result"
                    disabled={busy || retrySeconds > 0}
                    onClick={() => {
                      openChat();
                      void ask(
                        "현재 은퇴 결과를 쉬운 말로 설명해 주세요. 계획 적용 전후에 돈이 부족해지는 시점, 가장 적게 남는 돈, 마지막 잔액이 어떻게 달라지는지 알려 주세요.",
                        false,
                        true,
                      );
                    }}
                  >
                    결과 설명 보기
                  </button>
                )}
              </div>
              {result && current && (
                <section
                  id="yp-result"
                  className="yp-stack yp-scroll-section"
                  aria-label="결과 비교"
                  tabIndex={-1}
                >
                  <Charts
                    before={result.before}
                    after={current}
                    year={h.start.slice(0, 4)}
                  />
                  <section className="yp-card yp-comparison">
                    <div className="yp-section-heading">
                      <div>
                        <h2>계획 전후 비교</h2>
                        <p>
                          현재 입력을 기준으로 은퇴 계획을 적용하기 전과 후를
                          비교해요.
                        </p>
                      </div>
                    </div>
                    <div className="yp-scroll yp-comparison-scroll">
                      <table className="yp-result-comparison">
                        <caption className="yp-sr">
                          은퇴 계획 적용 전후 비교
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">비교 항목</th>
                            <th scope="col">계획 적용 전</th>
                            <th scope="col">계획 적용 후</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <th scope="row">
                              돈이 처음 부족한 때
                              <small>잔액이 0원 아래로 내려가는 달</small>
                            </th>
                            <td data-label="계획 적용 전">
                              {dateText(result.before.firstNegative)}
                            </td>
                            <td
                              data-label="계획 적용 후"
                              data-changed={
                                current.firstNegative !==
                                result.before.firstNegative
                              }
                            >
                              {dateText(current.firstNegative)}
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">
                              가장 적게 남는 돈
                              <small>전체 기간 중 잔액이 가장 낮은 달</small>
                            </th>
                            <td data-label="계획 적용 전">
                              {money(result.before.minAssets)}
                            </td>
                            <td data-label="계획 적용 후">
                              {money(current.minAssets)}
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">
                              전체 기간의 수입·지출 차이
                              <small>
                                {h.start.slice(0, 4)}~{h.endYear}년 · 시작할 때
                                가진 돈 포함
                              </small>
                            </th>
                            <td data-label="계획 적용 전">
                              {money(result.before.lifeNet)}
                            </td>
                            <td data-label="계획 적용 후">
                              {money(current.lifeNet)}
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">
                              비상시 쓸 돈
                              <small>목표 금액을 끝까지 유지하는지</small>
                            </th>
                            <td data-label="계획 적용 전">
                              {result.before.passes ? "충족" : "미달"}
                            </td>
                            <td
                              data-label="계획 적용 후"
                              data-changed={
                                current.passes !== result.before.passes
                              }
                            >
                              {current.passes ? "충족" : "미달"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="yp-note">
                      금액은 {h.start.slice(0, 4)}년 돈의 가치로 환산했어요.
                      ‘전체 기간의 수입·지출 차이’는 시작할 때 가진 돈에 전체
                      수입을 더하고 지출을 뺀 금액이에요. 예금 이자·투자 수익은
                      제외하므로 마지막 통장 잔액과는 달라요. 음수는 그만큼
                      부족하다는 뜻이에요.
                    </p>
                    <p className="yp-note">
                      비상자금 목표 {money(current.reserve)} · 본인 정년부터
                      정상 연금까지 {current.gapMonths}개월 · 가구에 근로·연금
                      소득이 없는 기간 {current.householdGap}개월
                    </p>
                    <h3 id="yp-plan-status-title">준비 방법 적용 상태</h3>
                    <ul
                      className="yp-plan-status"
                      aria-labelledby="yp-plan-status-title"
                    >
                      {(
                        ["benefits", "job", "repay", "catchup", "home"] as const
                      ).map((key) => (
                        <li key={key} data-applied={s[key]}>
                          <span className="yp-status-check" aria-hidden="true">
                            {s[key] ? "✓" : "−"}
                          </span>
                          <span>{planLabels[key]}</span>
                          <strong>{s[key] ? "적용" : "미적용"}</strong>
                        </li>
                      ))}
                    </ul>
                    <p className="yp-note">
                      계획 적용 전에는 위 다섯 방법을 적용하지 않아요. 연
                      수익률도 계획 적용 전 {fmt(h.beforeReturn * 100)}% / 계획
                      적용 후 {fmt(h.planReturn * 100)}%로 달라 결과에 함께
                      반영돼요.
                    </p>
                    {prepared.optionalMissing.length > 0 && (
                      <p className="yp-note">
                        선택한 계획 중 입력하지 않은 금액과 기간은 0원·0개월로
                        계산했어요.
                      </p>
                    )}
                    <p className="yp-note">
                      화면의 금액은 원 단위로 반올림해요. 계산과 저장에는 원래
                      정밀도를 유지해요.
                    </p>
                    <div className="yp-comparison-actions">
                      <button
                        className="yp-primary"
                        onClick={() => jumpToSection("plan")}
                      >
                        은퇴 계획 설정하기
                      </button>
                    </div>
                  </section>
                </section>
              )}
              <section
                id="yp-plan"
                className="yp-card yp-scroll-section"
                aria-labelledby="yp-plan-title"
                tabIndex={-1}
              >
                <div className="yp-section-heading">
                  <div>
                    <h2 id="yp-plan-title">은퇴 계획</h2>
                    <p>
                      준비 방법을 켜면 결과에 바로 반영돼요. 금액과 기간은 각
                      항목에서 조절할 수 있어요.
                    </p>
                  </div>
                </div>
                <div className="yp-plan-list">
                  {(
                    [
                      [
                        "benefits",
                        "구직급여 받기",
                        "은퇴 후 일정 기간 생활비를 보태요.",
                        [
                          ["benefit", "예상 월 구직급여"],
                          ["benefitMonths", "수령 기간", "개월"],
                        ],
                      ],
                      [
                        "job",
                        "다시 일하기",
                        s.benefits
                          ? "구직급여 기간이 끝난 뒤부터 본인 정상 연금 전까지 일해요."
                          : "은퇴 다음 달부터 본인 정상 연금 전까지 일해요.",
                        [
                          ["jobIncome", "재취업 월급"],
                          [
                            "jobDelay",
                            s.benefits
                              ? "구직급여 종료 후 추가 대기"
                              : "은퇴 후 추가 대기",
                            "개월",
                          ],
                        ],
                      ],
                      [
                        "repay",
                        "퇴직 시 대출 갚기",
                        "목돈이 나가지만 이후 매달 대출 상환 부담이 줄어요.",
                        [],
                      ],
                      [
                        "catchup",
                        "배우자 국민연금 더 채우기",
                        "못 낸 기간의 보험료를 나중에 내는 ‘추납’이에요.",
                        [
                          ["catchupCost", "한 번에 낼 추납 비용"],
                          ["catchupPension", "추납 후 배우자 월 연금"],
                        ],
                      ],
                      [
                        "home",
                        "집으로 연금 받기",
                        "집에 살면서 매달 돈을 받는 주택연금을 비교해요.",
                        [["house", "현재 주택가격"]],
                      ],
                    ] as [
                      "benefits" | "job" | "repay" | "catchup" | "home",
                      string,
                      string,
                      FieldSpec[],
                    ][]
                  )
                    .filter(
                      ([key]) => key !== "catchup" || h.hasSpouse !== false,
                    )
                    .map(([key, label, description, fields]) => (
                      <div
                        className={`yp-plan-option ${s[key] ? "chosen" : ""}`}
                        key={key}
                      >
                        <label className="yp-check">
                          <span className="yp-check-copy">
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                          <span className="yp-check-control">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={label}
                              checked={s[key]}
                              onChange={(e) =>
                                setPlan({ [key]: e.target.checked })
                              }
                            />
                            <span className="yp-check-state" aria-hidden="true">
                              {s[key] ? "선택됨" : "선택 안 함"}
                            </span>
                          </span>
                        </label>
                        {s[key] && (
                          <details className="yp-plan-detail">
                            <DetailSummary>
                              {key === "repay" ? "상환 방식" : "금액·기간 조절"}
                            </DetailSummary>
                            {fields.map(field)}
                            {key === "repay" && (
                              <p>
                                은퇴 다음 달에 대출 잔액을 전액 상환해요. 현재
                                대출 잔액은 {money(h.loan)}이에요.
                              </p>
                            )}
                            {key === "home" && (
                              <>
                                <label className="yp-field">
                                  <span>
                                    주택연금 시작 연도{" "}
                                    <strong>{s.homeYear}년</strong>
                                  </span>
                                  <input
                                    type="range"
                                    aria-label="주택연금 시작 연도"
                                    min={Math.max(2026, +h.start.slice(0, 4))}
                                    max={Math.min(2120, h.endYear)}
                                    value={s.homeYear}
                                    onChange={(e) =>
                                      setPlan({ homeYear: +e.target.value })
                                    }
                                  />
                                </label>
                                <label className="yp-field">
                                  <span>주택연금 시작 월</span>
                                  <select
                                    aria-label="주택연금 시작 월"
                                    value={s.homeMonth}
                                    onChange={(e) =>
                                      setPlan({ homeMonth: +e.target.value })
                                    }
                                  >
                                    {Array.from({ length: 12 }, (_, i) => (
                                      <option key={i + 1} value={i + 1}>
                                        {i + 1}월
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <p className="yp-note">
                                  {housing.source === "unavailable"
                                    ? "주택가격과 시작 시점을 확인하거나 월 지급액을 직접 입력해 주세요."
                                    : `${s.homeYear}년 ${s.homeMonth}월 시작 조건에서 월 ${money(housing.amount)} · ${homePaymentSource[housing.source]}`}
                                </p>
                                <label className="yp-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={s.homeOverride > 0}
                                    onChange={(e) => {
                                      setHomeOverrideError("");
                                      setPlan({
                                        homeOverride: e.target.checked
                                          ? Math.min(
                                              500,
                                              Math.max(
                                                0.1,
                                                housing.amount ?? 0,
                                              ),
                                            )
                                          : 0,
                                      });
                                    }}
                                  />
                                  확인한 주택연금 월액 직접 입력
                                </label>
                                {s.homeOverride > 0 && (
                                  <NumberField
                                    label="확인한 주택연금 월액"
                                    value={s.homeOverride}
                                    precision={3}
                                    error={homeOverrideError}
                                    onBlur={() => setHomeOverrideError("")}
                                    onChange={(v) => {
                                      if (
                                        !Number.isFinite(v) ||
                                        v <= 0 ||
                                        v > 500
                                      ) {
                                        setHomeOverrideError(
                                          "0보다 크고 500만 원 이하인 금액을 입력해 주세요. 그전 금액으로 계산 중이에요.",
                                        );
                                        return;
                                      }
                                      setHomeOverrideError("");
                                      setPlan({ homeOverride: v });
                                    }}
                                  />
                                )}
                              </>
                            )}
                          </details>
                        )}
                      </div>
                    ))}
                </div>
                <label className="yp-field yp-pension">
                  <span>본인 국민연금은 언제 받을까요?</span>
                  <select
                    aria-label="본인 국민연금 수령 시기"
                    value={s.pensionOffset}
                    onChange={(e) =>
                      setPlan({ pensionOffset: +e.target.value })
                    }
                  >
                    {[-60, -48, -39, -36, -24, -12, 0, 12, 24, 36, 48, 60].map(
                      (n) => (
                        <option key={n} value={n}>
                          {n === 0
                            ? "정상 시기에 받기"
                            : `${Math.abs(n)}개월 ${n < 0 ? "일찍 받기" : "늦게 받기"}`}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <p className="yp-note">
                  일찍 받으면 월 0.5% 감액, 늦게 받으면 월 0.6% 가산하는 단순
                  비교예요. 가입기간·소득 등 실제 자격은 별도로 확인해야 해요.
                </p>
                {!result && (
                  <p className="yp-error" role="alert">
                    {prepared.missing.length
                      ? `계산에 필요한 정보가 있어요. ${prepared.missing.map((key) => inputLabels[key] || fieldNames[key] || key).join(", ")}을 확인해 주세요.`
                      : "계획에 입력한 날짜, 기간, 금액의 범위를 확인해 주세요."}
                  </p>
                )}
                {prepared.optionalMissing.length > 0 && (
                  <p className="yp-note">
                    입력하지 않은 금액과 기간은 0원·0개월로 계산해요.
                    금액·기간을 열거나 채팅에서 알려줄 수 있어요.
                  </p>
                )}
                {current?.warnings.map((w) => (
                  <p className="yp-warning" role="status" key={w}>
                    주의 · {w}
                  </p>
                ))}
                <details className="yp-plan-bulk">
                  <DetailSummary>예시 계획 적용 및 선택 해제</DetailSummary>
                  <p className="yp-note">
                    예시 기본 계획은 위 다섯 방법과 정상 연금 수령을 함께 쓰는
                    안이에요.{" "}
                    {changes.length
                      ? `현재 ${changes.length}개 계획 조건이 달라요.`
                      : "현재 같은 계획을 선택했어요."}
                  </p>
                  {changes.length > 0 && (
                    <div className="yp-plan-summary">
                      {changes.map((k) => (
                        <span key={k}>
                          {planLabels[k]}: {showValue(adopted[k], k)} →{" "}
                          {showValue(s[k], k)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="yp-plan-actions">
                    <button
                      onClick={() => {
                        setS({ ...none });
                        setApplied("");
                        setUndo(null);
                      }}
                    >
                      모두 선택 해제
                    </button>
                    <button
                      onClick={() => {
                        setS({ ...adopted });
                        setApplied("");
                        setUndo(null);
                        setNotice(
                          "가구 정보는 유지하고 예시 기본 계획만 적용했어요.",
                        );
                      }}
                    >
                      예시 기본 계획 적용
                    </button>
                  </div>
                </details>
                <div className="yp-actions">
                  <button
                    className="yp-primary"
                    disabled={!result}
                    onClick={() => jumpToSection("result")}
                  >
                    결과 비교하기
                  </button>
                  {!isExample && (
                    <button onClick={() => goTo("chat")}>
                      채팅으로 계획 조건 입력
                    </button>
                  )}
                  <button disabled={!result} onClick={() => openChat()}>
                    다른 계획 상담하기
                  </button>
                </div>
              </section>
              {current && (
                <section
                  id="yp-basis"
                  className="yp-stack yp-scroll-section"
                  tabIndex={-1}
                  aria-labelledby="yp-basis-title"
                >
                  <div className="yp-card yp-basis-values">
                    <h2 id="yp-basis-title">계산 기준</h2>
                    <p>분석 기간, 물가와 수익률을 확인할 수 있어요.</p>
                    <dl className="yp-assumptions">
                      <div>
                        <dt>분석 기간</dt>
                        <dd>
                          {h.start} ~ {h.endYear}-12 · 월별 계산
                        </dd>
                      </div>
                      <div>
                        <dt>물가 상승률</dt>
                        <dd>연 {fmt(h.inflation * 100)}%</dd>
                      </div>
                      <div>
                        <dt>수익률 · 적용 전</dt>
                        <dd>연 {fmt(h.beforeReturn * 100)}%</dd>
                      </div>
                      <div>
                        <dt>수익률 · 적용 후</dt>
                        <dd>연 {fmt(h.planReturn * 100)}%</dd>
                      </div>
                      <div>
                        <dt>수입 기준</dt>
                        <dd>세후 금액</dd>
                      </div>
                      <div>
                        <dt>지역건강보험료 중 재산분</dt>
                        <dd>
                          기준월 {money(h.propertyHealthPremium ?? 0)} ·
                          장기요양보험료 전
                        </dd>
                      </div>
                      {s.home && (
                        <div>
                          <dt>주택연금 반영</dt>
                          <dd>
                            {housingStart && housing.source !== "unavailable"
                              ? `${dateText(housingStart)}부터 월 ${money(housing.amount)} · ${homePaymentSource[housing.source]}`
                              : "분석 기간에 반영된 금액 없음"}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <button onClick={() => goTo(isExample ? "chat" : "manual")}>
                      {isExample ? "내 정보 입력하기" : "계산 가정 수정하기"}
                    </button>
                  </div>
                  <div className="yp-card yp-basis-guide">
                    <div>
                      <h3>금액을 읽는 방법</h3>
                      <p>
                        ‘구매력’은 물가 상승을 빼고 {h.start.slice(0, 4)}년 돈의
                        가치로 바꾼 금액이에요. ‘명목금액’은 해당 연도에 실제로
                        보이는 금액이에요. 주택연금은 대출이므로 마지막
                        금융자산을 순자산이나 상속재산으로 볼 수 없어요.
                      </p>
                    </div>
                    <div>
                      <h3>비상자금과 자금 부족은 달라요</h3>
                      <p>
                        비상자금은 월 생활비와 현재 대출 월 상환액의{" "}
                        {fmt(h.reserveMonths)}개월치예요. 자산이 0 이상이어도 이
                        목표에 못 미칠 수 있어요. 자산이 음수인 달부터는
                        충당하지 못한 부족액으로 표시해요.
                      </p>
                    </div>
                  </div>
                  <div className="yp-card yp-basis-data">
                    <h3>월별 내역과 파일</h3>
                    <details
                      onToggle={(event) =>
                        setShowMonthly(event.currentTarget.open)
                      }
                    >
                      <DetailSummary>월별 수입·지출 상세</DetailSummary>
                      <p className="yp-note">
                        금액은 원 단위로 반올림해요. 수입에는 예금 이자·투자
                        수익이 포함돼요.
                      </p>
                      {showMonthly && (
                        <div className="yp-scroll">
                          <table>
                            <thead>
                              <tr>
                                {[
                                  "월",
                                  "수입",
                                  "지출",
                                  "금융자산",
                                  "시작 연도 돈의 가치",
                                ].map((k) => (
                                  <th key={k}>{k}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {current.rows.map((r) => (
                                <tr key={r.date}>
                                  <th scope="row">{r.date}</th>
                                  {[
                                    r.income,
                                    r.expenses,
                                    r.assets,
                                    r.realAssets,
                                  ].map((v, i) => (
                                    <td key={i}>{money(v)}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </details>
                    <details>
                      <DetailSummary>계산 결과 저장</DetailSummary>
                      <div className="yp-actions">
                        <button onClick={csv}>월별 계산 CSV</button>
                        <button onClick={verification}>
                          예시 계산 대조표 CSV
                        </button>
                        <button onClick={() => window.print()}>
                          화면 인쇄·PDF
                        </button>
                      </div>
                      <p className="yp-note">
                        예시 계산 대조표는 예시 가구의 기준값과 계산 결과를
                        비교한 자료예요. CSV와 조건 파일에는 반올림 전 금액이
                        저장돼요.
                      </p>
                    </details>
                  </div>
                  <p className="yp-note">
                    주택연금은 실제 가입 시점의 주택가격과 지급표로 다시 확인해
                    주세요. 지역건강보험료는 연금소득과 입력한 재산분을 바탕으로
                    계산해요.
                  </p>
                </section>
              )}
            </div>
          )}
          {showConversation && (
            <section
              id="yp-agent"
              className={`yp-card yp-conversation ${inlineChat ? "" : "yp-agent"}`}
              aria-labelledby="yp-agent-title"
              data-open={chatting}
              inert={!chatting}
              onKeyDown={(event) => {
                if (!inlineChat && event.key === "Escape") closeChat();
              }}
            >
              <div className="yp-panel-heading">
                <h2 id="yp-agent-title">{inlineChat ? "대화" : "AI 상담"}</h2>
                {!inlineChat && (
                  <button
                    type="button"
                    ref={chatClose}
                    onClick={closeChat}
                    aria-label="챗봇 닫기"
                  >
                    ×
                  </button>
                )}
              </div>
              <div
                className="yp-thread"
                ref={thread}
                role="log"
                aria-live="polite"
                aria-busy={busy}
              >
                {(!collecting || conversation.length === 0) && (
                  <div className="yp-agent-message yp-greeting">
                    <p>
                      {collecting
                        ? intakeAnswer(
                            intake.household,
                            intake.solutions,
                            {},
                            [],
                            false,
                          )
                        : "생활비가 부족해지는 이유나 준비 방법을 바꾸면 달라지는 점을 물어보세요."}
                    </p>
                  </div>
                )}
                {collecting && !inlineChat && <InputSources />}
                {conversation.map((m, i) => (
                  <article className="yp-exchange" key={i}>
                    <p className="yp-user-message">
                      <strong>나</strong>
                      {m.question}
                    </p>
                    <div className="yp-agent-message">
                      {m.reply.intake &&
                        (m === pendingIntake ||
                          (m.snapshot !== snapshot &&
                            !conversation
                              .slice(i + 1)
                              .some(
                                (next) =>
                                  next.reply.intake &&
                                  next.snapshot === m.snapshot &&
                                  next.revision === m.revision,
                              ))) &&
                        Object.keys(m.reply.intake.patch).length > 0 && (
                          <div className="yp-candidate">
                            <h3>입력 정보 확인</h3>
                            <ul>
                              {Object.entries(m.reply.intake.patch).map(
                                ([k, v]) => (
                                  <li key={k}>
                                    {inputLabels[k as keyof Household] ||
                                      fieldNames[k] ||
                                      k}
                                    : {householdValue(v, k)}
                                    {m.reply.intake?.skipped?.some(
                                      (field) => field === k,
                                    ) && " (건너뜀)"}
                                  </li>
                                ),
                              )}
                            </ul>
                            <button
                              className="yp-primary"
                              disabled={
                                busy ||
                                m !== pendingIntake ||
                                m.revision !== revision.current ||
                                m.snapshot !== snapshot ||
                                !Object.keys(m.reply.intake.patch).length
                              }
                              onClick={() => applyIntake(intakeComplete)}
                            >
                              {m === pendingIntake
                                ? intakeComplete
                                  ? "정보 반영하기 및 결과 보기"
                                  : "정보 반영하기"
                                : Object.entries(m.reply.intake.patch).every(
                                      ([k, v]) =>
                                        h[k as keyof Household] === v &&
                                        origins[k as keyof Household] ===
                                          (m.reply.intake?.skipped?.some(
                                            (field) => field === k,
                                          )
                                            ? "skipped"
                                            : "chat"),
                                    )
                                  ? "반영된 정보"
                                  : "이전 입력 정보"}
                            </button>
                            {m.snapshot !== snapshot &&
                              !Object.entries(m.reply.intake.patch).every(
                                ([k, v]) => h[k as keyof Household] === v,
                              ) && (
                                <p className="yp-note">
                                  입력 조건이 변경됐어요. 필요한 내용은 현재
                                  값으로 다시 정리해 주세요.
                                </p>
                              )}
                          </div>
                        )}

                      <strong className="yp-sr">상담 답변</strong>
                      {!m.reply.intake &&
                        m.snapshot !== snapshot &&
                        !m.reply.candidates.some(
                          (c) =>
                            JSON.stringify({ h: c.household, s: c.plan }) ===
                            snapshot,
                        ) && (
                          <p className="yp-warning">
                            조건이 바뀌기 전의 분석이에요.
                          </p>
                        )}
                      <div className="yp-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node: _node, ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                          }}
                        >
                          {m.reply.answer}
                        </ReactMarkdown>
                      </div>
                      {m.reply.candidates.map((c, j) => {
                        const candidateApplied =
                          JSON.stringify({ h: c.household, s: c.plan }) ===
                          snapshot;
                        const prior = JSON.parse(m.snapshot);
                        const previousHousehold =
                          prepareScenario(prior.h, prior.s).household ||
                          prior.h;
                        const diff = [
                          ...Object.keys(c.household)
                            .filter(
                              (k) =>
                                c.household[k as keyof Household] !==
                                previousHousehold[k],
                            )
                            .map(
                              (k) =>
                                `${fieldNames[k] || k}: ${householdValue(previousHousehold[k], k)} → ${householdValue(c.household[k as keyof Household], k)}`,
                            ),
                          ...Object.keys(c.plan)
                            .filter(
                              (k) =>
                                c.plan[k as keyof Solutions] !==
                                JSON.parse(m.snapshot).s[k],
                            )
                            .map(
                              (k) =>
                                `${planLabels[k as keyof Solutions]}: ${showValue(JSON.parse(m.snapshot).s[k], k)} → ${showValue(c.plan[k as keyof Solutions], k)}`,
                            ),
                        ];
                        return (
                          <div className="yp-candidate" key={j}>
                            <h3>{c.name}</h3>
                            <dl>
                              <div>
                                <dt>최초 부족</dt>
                                <dd>{dateText(c.metrics.firstNegative)}</dd>
                              </div>
                              <div>
                                <dt>최저 잔고</dt>
                                <dd>{money(c.metrics.minAssets)}</dd>
                              </div>
                              <div>
                                <dt>마지막 자산</dt>
                                <dd>{money(c.metrics.endAssets)}</dd>
                              </div>
                            </dl>
                            <details>
                              <DetailSummary>
                                변경 조건 {diff.length}개
                              </DetailSummary>
                              <ul>
                                {diff.map((d) => (
                                  <li key={d}>{d}</li>
                                ))}
                              </ul>
                            </details>
                            {c.metrics.warnings.map((w) => (
                              <p className="yp-warning" key={w}>
                                {w}
                              </p>
                            ))}
                            <button
                              className="yp-primary"
                              disabled={m.snapshot !== snapshot || !diff.length}
                              onClick={() => applyCandidate(c, m.snapshot)}
                            >
                              {candidateApplied
                                ? "적용된 계획"
                                : "이 계획 적용"}
                            </button>
                          </div>
                        );
                      })}
                      {m.reply.searched > 0 && (
                        <p className="yp-note">
                          제한된 {m.reply.searched}개 조합을 비교했어요. 모든
                          가능한 계획의 최적값은 아니에요.
                        </p>
                      )}
                    </div>
                  </article>
                ))}
                {busy && (
                  <>
                    <p className="yp-user-message">
                      <strong>나</strong>
                      {submittedQuestion}
                    </p>
                    <p className="yp-thinking" role="status">
                      {waitingSeconds >= 6
                        ? "연결이 지연되고 있어요. 잠시만 기다려 주세요."
                        : !collecting
                          ? "조건을 확인하고 계산하고 있어요."
                          : "입력한 정보를 정리하고 있어요."}
                    </p>
                  </>
                )}
                {aiError && (
                  <div className="yp-agent-error" role="alert">
                    <p>{aiError}</p>
                    {needsToken && (
                      <label className="yp-field">
                        <span>AI 접근 토큰</span>
                        <input
                          type="password"
                          autoComplete="off"
                          value={accessToken}
                          onChange={(e) => setAccessToken(e.target.value)}
                        />
                      </label>
                    )}
                    <button
                      onClick={() =>
                        void ask(
                          submittedQuestion,
                          question.trim() === submittedQuestion,
                          submittedExplanation.current,
                        )
                      }
                      disabled={busy || !submittedQuestion || retrySeconds > 0}
                    >
                      {retrySeconds > 0
                        ? `${retrySeconds}초 뒤 다시 시도`
                        : "다시 시도"}
                    </button>
                  </div>
                )}
              </div>
              {undo && (
                <div className="yp-undo" role="status">
                  <span>
                    {applied ? `${applied} 적용 완료` : "입력 정보 반영 완료"}
                  </span>
                  <button onClick={restoreInput}>되돌리기</button>
                </div>
              )}
              <form
                className="yp-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <label htmlFor="yp-question">
                  {collecting ? "메시지 입력" : "궁금한 점을 물어보세요"}
                </label>
                <textarea
                  id="yp-question"
                  ref={agentInput}
                  rows={3}
                  maxLength={1500}
                  placeholder={
                    collecting
                      ? "질문에 대한 답을 입력해 주세요."
                      : "예: 계획 적용 전에는 왜 돈이 부족해지나요?"
                  }
                  value={question}
                  readOnly={busy}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                />
                <div className="yp-composer-actions">
                  <small
                    className={
                      retrySeconds > 0 ? undefined : "yp-keyboard-hint"
                    }
                  >
                    {retrySeconds > 0
                      ? `${retrySeconds}초 뒤에 다시 보낼 수 있어요.`
                      : "Enter 전송 · Shift+Enter 줄바꿈"}
                  </small>
                  {collecting && isSkippableMoneyField(nextAmount) && !busy && (
                    <button
                      type="button"
                      className="yp-skip-amount"
                      onClick={() => void ask("건너뛰기", false)}
                      aria-label={`${inputLabels[nextAmount]} 건너뛰기 (0원)`}
                    >
                      {inputLabels[nextAmount]} 건너뛰기
                    </button>
                  )}
                  {busy ? (
                    <button
                      type="button"
                      onClick={() => abort.current?.abort()}
                    >
                      분석 중단
                    </button>
                  ) : (
                    <button
                      className="yp-primary"
                      disabled={
                        !question.trim() ||
                        (retrySeconds > 0 &&
                          !(
                            collecting &&
                            resolveIntakeInputAction(
                              question,
                              intake.household,
                              intake.solutions,
                            )
                          ))
                      }
                    >
                      보내기
                    </button>
                  )}
                </div>
              </form>
              {inlineChat && (
                <aside
                  className="yp-panel-foot yp-chat-aside"
                  aria-labelledby="yp-chat-aside-title"
                >
                  <h3 id="yp-chat-aside-title">입력과 결과</h3>
                  {!intakeComplete && !checkInput && (
                    <p className="yp-note">
                      필요한 정보를 입력하면 결과를 볼 수 있어요.
                    </p>
                  )}
                  <div className="yp-actions">
                    <button onClick={() => goTo("manual")}>
                      직접 입력하기
                    </button>
                    <button
                      className={intakeComplete ? "yp-primary" : undefined}
                      onClick={() => applyIntake(true)}
                    >
                      내 결과 보기
                    </button>
                  </div>
                  {intakeComplete && (
                    <p className="yp-note">
                      {optionalPlanHint(intakePrepared.optionalMissing) ||
                        "구직급여나 재취업 월급 같은 은퇴 계획도 채팅으로 알려줄 수 있어요. 지금 바로 결과를 볼 수 있어요."}
                    </p>
                  )}
                  {checkInput && (busy || !intakeComplete) && (
                    <p className="yp-error" role="alert">
                      {busy
                        ? "답변을 정리하고 있어요. 정리가 끝나면 다시 눌러 주세요."
                        : intakePrepared.missing.length && nextAmount
                          ? `결과를 보려면 정보를 더 입력해 주세요. 지금은 ‘${inputLabels[nextAmount] || fieldNames[nextAmount] || nextAmount}’에 답해 주세요.`
                          : "결과를 보려면 입력한 날짜, 기간, 금액의 범위를 확인해 주세요."}
                    </p>
                  )}
                  <InputSources />
                </aside>
              )}
            </section>
          )}
        </div>
      </main>
      <footer className="yp-footer">
        <div className="yp-footer-inner">
          <div className="yp-footer-top">
            <Link className="yp-brand" href="/main">
              afterfolio
            </Link>
            <nav aria-label="하단 메뉴">
              <Link href="/guide">이용안내</Link>
              <Link href="/dashboard/example">권 부장 부부 예시</Link>
            </nav>
          </div>
          <div className="yp-footer-details">
            <div>
              {isExample ? (
                <p>예시에서 변경한 조건과 대화는 내 결과에 저장되지 않아요.</p>
              ) : storageError ? (
                <p role="status">{storageError}</p>
              ) : activeView !== "home" && activeView !== "guide" ? (
                <p>입력과 대화는 이 브라우저에 자동 저장돼요.</p>
              ) : null}
              <p>참고용 시뮬레이션이며 상품 권유가 아니에요.</p>
              <p>실제 수급 자격·지급액·세금은 관련 기관에서 확인해 주세요.</p>
            </div>
            {!isExample && activeView !== "home" && activeView !== "guide" && (
              <button
                className="yp-reset-button"
                onClick={() => resetDialog.current?.showModal()}
                disabled={!storageReady}
              >
                저장한 내용 초기화
              </button>
            )}
          </div>
        </div>
      </footer>
      {!inlineChat && (
        <button
          type="button"
          ref={chatLauncher}
          className="yp-chat-launcher"
          aria-expanded={chatOpen}
          aria-controls={showConversation ? "yp-agent" : undefined}
          aria-label={chatOpen ? "챗봇 닫기" : "챗봇 열기"}
          onClick={chatOpen ? closeChat : openChat}
        >
          {!chatOpen ? (
            <>
              {activeView === "home" && (
                <span className="yp-coast-chat-hint" aria-hidden="true">
                  궁금한 점이 있으신가요?
                </span>
              )}
              <svg
                className="yp-coast-chat-icon"
                viewBox="0 0 64 42"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 26c4-8 10-13 17-13 6 0 11 6 15 11l-8 8c-8 4-15 0-24-6Z" />
                <path d="M27 15c4-6 8-9 13-8 4 1 7 4 10 8 5 1 9 4 11 8-8-1-14 1-19 5l-10 3" />
                <circle cx="48" cy="16" r="1.3" fill="currentColor" />
                <path d="m20 33-2 5m9-5-1 6m35-16 2 1" stroke="#9d7e45" />
              </svg>
            </>
          ) : (
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
