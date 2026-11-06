"use client";
import { useEffect, useMemo, useRef, useState, useId } from "react";
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
  homePayment,
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
} from "../lib/input";
import type { Candidate } from "../lib/household-agent";
import {
  readPlannerSession,
  sessionKey,
  type Message,
  type Origin,
} from "../lib/planner-session";
import "./planner.css";

type FieldSpec = [keyof Household, string, string?];
const groups: { title: string; description: string; fields: FieldSpec[] }[] = [
  {
    title: "생활비와 자산",
    description: "지금 가진 돈과 매달 필요한 돈이에요.",
    fields: [
      ["living", "부부 월 생활비"],
      ["assets", "현재 금융자산"],
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
      "정상 수령 시 예상 월액이에요. 기준년 구매력으로 입력해 주세요.",
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
      ? `${fmt(v)}${key === "pensionOffset" || key === "homeMonth" ? "개월" : key === "homeYear" ? "년" : ""}`
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
    ? rate
      ? `${fmt(value * 100)}%`
      : `${fmt(value)}${["endYear", "shockYear"].includes(key) ? "년" : ["jobDelay", "benefitMonths", "loanMonths"].includes(key) ? "개월" : key === "reserveMonths" ? "개월치" : "만 원"}`
    : String(value);
}
function save(name: string, text: string, type = "application/json") {
  const u = URL.createObjectURL(new Blob(["\ufeff" + text], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
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
}: {
  label: string;
  value: number;
  unit?: string;
  precision?: number;
  onChange: (v: number) => void;
  error?: string;
  hint?: string;
  onBlur?: () => void;
}) {
  const errorId = useId();
  const display = Number.isFinite(value)
    ? String(Number(value.toFixed(precision)))
    : "";
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  return (
    <label className="yp-field">
      <span>{label}</span>
      <span className={`yp-input ${error ? "invalid" : ""}`}>
        <input
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
      {hint && <small className="yp-note">{hint}</small>}
      {error && (
        <small id={errorId} className="yp-error">
          {error}
        </small>
      )}
    </label>
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
      aria-label={`${which === "before" ? "계획 적용 전" : which === "after" ? "계획 적용 후" : "계획 적용 전후"} 금융자산 그래프. 최저 ${fmt((which === "before" ? before : after).minAssets)}만 원, 최초 부족 ${dateText((which === "before" ? before : after).firstNegative)}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 18, right: 12, bottom: 2, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="#e5e9e3" />
          <XAxis
            dataKey="year"
            minTickGap={35}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            width={64}
            domain={[lo - padding, hi + padding]}
            tickFormatter={(v) => fmt(Number(v))}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(v) => `${fmt(Number(v))}만 원`}
            labelFormatter={(v) => `${v}년 말`}
            contentStyle={{ borderRadius: 12, borderColor: "#d8e2db" }}
          />
          <ReferenceLine y={0} stroke="#a44d3e" />
          <ReferenceLine
            y={after.reserve}
            stroke="#967130"
            strokeDasharray="3 5"
          />
          {which !== "after" && (
            <Line
              dataKey="before"
              name="계획 적용 전"
              dot={false}
              stroke="#466176"
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
              stroke="#14513d"
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
          <h2>은퇴 후 금융자산 흐름</h2>
          <p>연말 금융자산 · {year}년 구매력 · 만 원</p>
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
        {fmt(after.reserve)}만 원이에요.
      </p>
    </section>
  );
}
type PlannerView = "home" | "chat" | "manual" | "result";

function PlanningGuide() {
  const steps = [
    [
      "내 상황 알려주기",
      "은퇴 시기, 생활비, 연금과 자산을 대화로 알려주거나 직접 입력해요.",
    ],
    [
      "생활비가 언제 부족한지 확인하기",
      "은퇴 후 자산이 줄어드는 시점과 비상자금이 충분한지 확인해요.",
    ],
    [
      "다른 준비 방법 비교하기",
      "재취업이나 연금 수령 시기를 바꾸면 결과가 어떻게 달라지는지 살펴봐요.",
    ],
  ] as const;

  return (
    <section
      className="yp-card yp-planning-guide"
      aria-labelledby="yp-guide-title"
    >
      <p className="yp-eyebrow">이용 순서</p>
      <h2 id="yp-guide-title">은퇴 계획, 이렇게 살펴봐요</h2>
      <ol>
        {steps.map(([title, description], index) => (
          <li key={title}>
            <span aria-hidden="true">0{index + 1}</span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Planner() {
  const pathname = usePathname();
  const isExample = pathname === "/dashboard/example";
  const [chatOpen, setChatOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  return (
    <PlannerWorkspace
      key={isExample ? "example" : "personal"}
      pathname={pathname}
      isExample={isExample}
      chatOpen={chatOpen}
      setChatOpen={setChatOpen}
      accessToken={accessToken}
      setAccessToken={setAccessToken}
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
}: {
  pathname: string;
  isExample: boolean;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  accessToken: string;
  setAccessToken: (token: string) => void;
}) {
  const [h, setHousehold] = useState<Household>(() =>
      isExample ? { ...example } : blankHousehold(),
    ),
    [s, setS] = useState<Solutions>(() =>
      isExample ? { ...adopted } : { ...none, homeYear: new Date().getFullYear() },
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
  const router = useRouter();
  const [view, setView] = useState<"manual" | "result">("result");
  const chatLauncher = useRef<HTMLButtonElement | null>(null);
  const main = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<"result" | "plan" | "basis">("result");
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
        setTab(restored.tab);
      }
    } catch {
      setStorageError("이 브라우저에 저장된 내용을 불러오지 못했어요.");
    } finally {
      setStorageReady(true);
    }
  }, [isExample]);
  useEffect(() => {
    if (
      isExample || !storageReady ||
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
          tab,
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
    tab,
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
  const prepared = prepareScenario(h, s);
  const pendingIntake = messages.findLast(
    (m) =>
      m.reply.intake &&
      m.snapshot === snapshot &&
      m.revision === revision.current,
  );
  const pendingPatch = pendingIntake?.reply.intake?.patch ?? {};
  const intake = mergeIntake(h, s, pendingPatch);
  const intakePrepared = prepareScenario(intake.household, intake.solutions);
  const intakeComplete =
    Boolean(intakePrepared.household) &&
    solutionSchema.safeParse(intake.solutions).success;
  const activeView =
    pathname === "/main"
      ? "home"
      : pathname === "/chat"
        ? "chat"
        : isExample
          ? "result"
          : view === "result" && !result && tab !== "plan"
            ? "manual"
            : view;
  const inlineChat = activeView === "chat";
  const collecting = inlineChat || !result;
  const chatting = inlineChat || chatOpen;
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
    setChatOpen(true);
    requestAnimationFrame(() =>
      agentInput.current?.focus({ preventScroll: true }),
    );
  }

  function closeChat() {
    setChatOpen(false);
    requestAnimationFrame(() =>
      chatLauncher.current?.focus({ preventScroll: true }),
    );
  }

  function showResult() {
    setTab("result");
    goTo("result");
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
          Object.keys(pendingPatch).map((key) => [key, "chat"]),
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
  ) => {
    if (key === "hasSpouse" && value === false)
      setS((v) => ({ ...v, catchup: false }));
    setH((v) => ({ ...v, [key]: value }));
    setOrigins((v) => ({ ...v, [key]: "manual" }));
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
      scale = unit === "%" ? 100 : 1;
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
        value={unit === "%" ? value * 100 : value}
        unit={unit}
        precision={unit === "%" ? 4 : 1}
        onChange={(v) => update(key, unit === "%" ? v / 100 : v)}
        error={error}
        hint={origins[key] === "example" ? "예시에서 채운 값" : undefined}
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
    setTab("result");
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
  async function ask(prompt = question, clearDraft = true) {
    const q = prompt.trim();
    if (!q || sending.current || retryUntil > Date.now()) return;
    sending.current = true;
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
          operation: collecting ? "collect" : "analyze",
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
        const patch = { ...pendingPatch, ...body.intake.patch };
        if ((patch.hasSpouse ?? h.hasSpouse) === false) {
          delete patch.spouseBirth;
          delete patch.spouseIncome;
          delete patch.spousePension;
          delete patch.spouseEnd;
        }
        body.intake.patch = patch;
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
    setTab("result");
    setNotice(`${c.name}을 적용했어요.`);
  }
  const changes = (Object.keys(s) as (keyof Solutions)[]).filter(
    (k) => s[k] !== adopted[k],
  );
  function csv() {
    if (!result) return;
    const lines = [
      "모델,계획,월,수입,지출,운용수익,금융자산,기준년구매력자산,대출잔액",
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
          ].join(","),
        );
    save("영플래너_월별계산.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }
  function verification() {
    const before = calculate(example, none, false),
      after = calculate(example, adopted);
    save(
      "영플래너_검증대조.csv",
      "지표,엑셀값,앱값,차이\n" +
        [
          ["최초 부족월", "2031-02", before.firstNegative, "일치"],
          [
            "계획 적용 전 생애 순수지",
            -29398.8546046442,
            before.lifeNet,
            before.lifeNet + 29398.8546046442,
          ],
          [
            "계획 적용 후 최저 자산",
            3616.55185834155,
            after.minAssets,
            after.minAssets - 3616.55185834155,
          ],
          [
            "계획 적용 후 기말 자산",
            14133.8896773549,
            after.endAssets,
            after.endAssets - 14133.8896773549,
          ],
        ]
          .map((r) => r.join(","))
          .join("\n"),
      "text/csv;charset=utf-8",
    );
  }
  const current = result?.after;
  const estimatedHomePayment = homePayment(h, s.homeYear, s.homeMonth) || 0;
  const status = current?.firstNegative
    ? "자금 부족 예상"
    : current?.passes
      ? "비상자금까지 유지"
      : "비상자금 보완 필요";
  return (
    <div className={`yp-app yp-flow yp-view-${activeView}`}>
      <a className="yp-skip" href="#yp-main">
        본문으로 건너뛰기
      </a>
      <header className="yp-header">
        <Link className="yp-brand" href="/main">
          Afterfolio
        </Link>
        {activeView !== "home" && (
          <button type="button" onClick={() => goTo("home")}>
            처음으로
          </button>
        )}
      </header>
      <main className="yp-main" id="yp-main" tabIndex={-1} ref={main}>
        {activeView === "home" ? (
          <section className="yp-landing">
            <div className="yp-landing-copy">
              <p className="yp-eyebrow">은퇴 후 자산관리</p>
              <h1>
                은퇴 후 생활비,
                <br />
                얼마나 오래 이어질까요?
              </h1>
              <p>
                생활비와 연금, 보유 자산을 입력하고 은퇴 후 자금이 부족해지는
                시점과 계획별 차이를 확인해 보세요.
              </p>
              <div className="yp-landing-actions">
                <button className="yp-primary" onClick={() => goTo("chat")}>
                  내 은퇴 계획 시작하기
                </button>
                <button onClick={() => router.push("/dashboard/example")}>
                  권 부장 부부 예시 보기
                </button>
              </div>
              {storageReady && (result || Object.keys(origins).length > 0) && (
                <button
                  className="yp-text-button"
                  onClick={() => (result ? showResult() : goTo("manual"))}
                >
                  저장한 {result ? "결과" : "입력"} 이어보기
                </button>
              )}
            </div>
            <PlanningGuide />
          </section>
        ) : (
          <section className="yp-intro">
            {isExample && <p className="yp-eyebrow">권 부장 부부 예시</p>}
            <h1>
              {
                {
                  chat: "AI와 은퇴 준비 시작하기",
                  manual: "은퇴 계획 직접 입력",
                  result: "은퇴 후 자산 전망",
                }[activeView]
              }
            </h1>
            <p>
              {activeView === "chat"
                ? "은퇴 시기와 생활비를 편하게 알려주세요. AI가 한 가지씩 물어볼게요."
                : activeView === "manual"
                  ? "예상 금액을 만 원 단위로 적어 주세요."
                  : !current
                    ? "계산에 필요한 계획 조건을 확인해 주세요."
                    : current.firstNegative
                      ? `${dateText(current.firstNegative)}부터 자금이 부족해져요.`
                      : `계획을 적용하면 ${h.endYear}년까지 자금이 소진되지 않아요.`}
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
            <button type="button" className="yp-primary" onClick={resetPlanner}>
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
                  가상의 보고서 사례 · {dateText(example.start)} 기준
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
                [
                  "부부 월소득",
                  fmt(example.income + example.spouseIncome) + "만 원",
                ],
                ["월 생활비", fmt(example.living) + "만 원"],
                ["금융자산", fmt(example.assets) + "만 원"],
                [
                  "주택가격 / 주담대",
                  fmt(example.house) + " / " + fmt(example.loan) + "만 원",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="yp-note">
              보고서의 기본 은퇴 계획이 적용되어 있어요. 이 화면에서 계획을
              바꿔도 내 결과에는 반영되지 않아요.
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
                <h2 id="yp-settings-title">은퇴 정보 입력</h2>
              </div>
              <div className="yp-settings-body">
                <p className="yp-note">
                  금액은 모두 만 원이에요. 바꾸면 결과에 바로 반영돼요.
                </p>
                {groups.map((g, i) => (
                  <details
                    className="yp-input-group"
                    key={g.title}
                    open={i < 2 ? true : undefined}
                  >
                    <summary>
                      {g.title}
                      <span>⌄</span>
                    </summary>
                    <p className="yp-note">{g.description}</p>
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
                  </details>
                ))}
                {(s.job || s.benefits || s.catchup) && (
                  <details className="yp-input-group" open>
                    <summary>선택한 준비 방법의 정보</summary>
                    {(s.job
                      ? ([["jobIncome", "재취업 월급"]] as FieldSpec[])
                      : []
                    ).map(field)}
                    {(s.benefits
                      ? ([
                          ["benefit", "구직급여 월액"],
                          ["benefitMonths", "구직급여 기간", "개월"],
                        ] as FieldSpec[])
                      : []
                    ).map(field)}
                    {(s.catchup
                      ? ([
                          ["catchupCost", "추납 비용"],
                          ["catchupPension", "추납 후 배우자 월 연금"],
                        ] as FieldSpec[])
                      : []
                    ).map(field)}
                  </details>
                )}
                <details className="yp-input-group">
                  <summary>
                    계산 가정과 추가 지출<span>⌄</span>
                  </summary>
                  <p className="yp-note">
                    금액은 한 자리까지 표시해요. 예시의 정밀 계산값은 직접
                    수정하기 전까지 유지돼요.
                  </p>
                  {assumptionFields.map(field)}
                </details>
                <details className="yp-input-group">
                  <summary>
                    저장·불러오기<span>⌄</span>
                  </summary>
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
              <nav className="yp-tabs" aria-label="분석 내용 선택">
                {(
                  [
                    ["result", "결과 비교"],
                    ["plan", "은퇴 계획"],
                    ["basis", "가정과 근거"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={tab === key}
                    aria-controls={`yp-${key}`}
                    disabled={key !== "plan" && !result}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              {tab === "result" && result && current && (
                <div id="yp-result" className="yp-stack">
                  <div className="yp-forecast-grid">
                    <Charts
                      before={result.before}
                      after={current}
                      year={h.start.slice(0, 4)}
                    />
                    <section
                      className="yp-card yp-forecast-summary"
                      aria-labelledby="yp-ending-balance"
                    >
                      <h2 id="yp-ending-balance">{h.endYear}년 말 예상 잔액</h2>
                      <strong>
                        {fmt(current.endAssets)}
                        <small>만 원</small>
                      </strong>
                      <p className="yp-note">{h.endYear}년 명목금액</p>
                      <hr />
                      <h3>가장 적게 남는 때</h3>
                      <p>
                        {dateText(current.minMonth)} · {fmt(current.minAssets)}
                        만 원
                      </p>
                      <p className="yp-note">
                        {h.start.slice(0, 4)}년 구매력 · {status}
                      </p>
                      <button
                        className="yp-primary"
                        disabled={busy || retrySeconds > 0}
                        onClick={() => {
                          openChat();
                          void ask(
                            "현재 은퇴 결과를 쉬운 말로 설명해 주세요. 계획 적용 전후에 돈이 부족해지는 시점, 가장 적게 남는 돈, 마지막 잔액이 어떻게 달라지는지 알려 주세요.",
                            false,
                          );
                        }}
                      >
                        AI로 결과 살펴보기
                      </button>
                    </section>
                  </div>
                  <section className="yp-card">
                    <div className="yp-section-heading">
                      <div>
                        <h2>계획 전후 비교</h2>
                        <p>
                          같은 가구 정보를 기준으로 계획 적용 전후를 비교해요.
                        </p>
                      </div>
                      <button onClick={() => setTab("plan")}>
                        계획 바꾸기 →
                      </button>
                    </div>
                    <div className="yp-scroll">
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
                            <th scope="row">돈이 처음 부족한 때</th>
                            <td>{dateText(result.before.firstNegative)}</td>
                            <td>{dateText(current.firstNegative)}</td>
                          </tr>
                          <tr>
                            <th scope="row">최저 금융자산</th>
                            <td>{fmt(result.before.minAssets)}만 원</td>
                            <td>{fmt(current.minAssets)}만 원</td>
                          </tr>
                          <tr>
                            <th scope="row">평생 수지 합계</th>
                            <td>{fmt(result.before.lifeNet)}만 원</td>
                            <td>{fmt(current.lifeNet)}만 원</td>
                          </tr>
                          <tr>
                            <th scope="row">비상자금 유지</th>
                            <td>{result.before.passes ? "충족" : "미달"}</td>
                            <td>{current.passes ? "충족" : "미달"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="yp-note">
                      최저 자산과 평생 수지는 {h.start.slice(0, 4)}년
                      구매력이에요. 평생 수지는 시작 자산을 포함하고 운용수익은
                      제외한 수입·지출 합계예요.
                    </p>
                    <p className="yp-note">
                      비상자금 목표 {fmt(current.reserve)}만 원 · 본인 정년부터
                      정상 연금까지 {current.gapMonths}개월 · 가구에 근로·연금
                      소득이 없는 기간 {current.householdGap}개월
                    </p>
                    <div className="yp-plan-summary">
                      {(
                        ["benefits", "job", "repay", "catchup", "home"] as const
                      ).map((k) => (
                        <span key={k} className={s[k] ? "selected" : ""}>
                          {s[k] ? "✓" : "−"} {planLabels[k]}
                        </span>
                      ))}
                    </div>
                    <p className="yp-note">
                      계획 적용 전에는 위 다섯 방법을 적용하지 않아요. 연 수익률도
                      계획 적용 전 {fmt(h.beforeReturn * 100)}% / 계획 적용 후{" "}
                      {fmt(h.planReturn * 100)}%로 달라 결과에 함께 반영돼요.
                    </p>
                  </section>
                </div>
              )}
              {tab === "plan" && (
                <section id="yp-plan" className="yp-card">
                  <div className="yp-section-heading">
                    <div>
                      <h2>우리에게 맞는 준비 방법을 골라요</h2>
                      <p>
                        체크하면 바로 계산돼요. 자세한 금액은 항목을 펼쳐 바꿀
                        수 있어요.
                      </p>
                    </div>
                  </div>
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
                          "가구 정보는 유지하고 보고서 기본 계획만 적용했어요.",
                        );
                      }}
                    >
                      보고서 기본 계획 적용
                    </button>
                  </div>
                  <p className="yp-note">
                    보고서 기본 계획(S4)은 아래 다섯 방법과 정상 연금 수령을
                    함께 쓰는 안이에요.{" "}
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
                              s.benefits ? "구직급여 종료 후 추가 대기" : "은퇴 후 추가 대기",
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
                            <input
                              type="checkbox"
                              checked={s[key]}
                              onChange={(e) =>
                                setPlan({ [key]: e.target.checked })
                              }
                            />
                            <span>
                              <strong>{label}</strong>
                              <small>{description}</small>
                            </span>
                            <span className="yp-check-state">
                              {s[key] ? "선택됨" : "선택 안 함"}
                            </span>
                          </label>
                          {s[key] && (
                            <details className="yp-plan-detail">
                              <summary>
                                {key === "repay"
                                  ? "얼마를 갚나요?"
                                  : "금액·기간 조절"}
                              </summary>
                              {fields.map(field)}
                              {key === "repay" && (
                                <p>
                                  은퇴 다음 달에 대출 잔액을 전액 상환해요. 현재
                                  대출 잔액은 {fmt(h.loan)}만 원이에요.
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
                                    {s.homeYear}년 {s.homeMonth}월부터 월{" "}
                                    {fmt(s.homeOverride || estimatedHomePayment)}만 원 추정 · 실제
                                    지급액은 한국주택금융공사에서 확인해 주세요.
                                  </p>
                                  <label className="yp-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={s.homeOverride > 0}
                                      onChange={(e) => {
                                        setHomeOverrideError("");
                                        setPlan({
                                          homeOverride: e.target.checked
                                            ? Math.min(500, Math.max(0.1, estimatedHomePayment))
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
                                        if (!Number.isFinite(v) || v <= 0 || v > 500) {
                                          setHomeOverrideError("0보다 크고 500만 원 이하인 금액을 입력해 주세요. 그전 금액으로 계산 중이에요.");
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
                      {[
                        -60, -48, -39, -36, -24, -12, 0, 12, 24, 36, 48, 60,
                      ].map((n) => (
                        <option key={n} value={n}>
                          {n === 0
                            ? "정상 시기에 받기"
                            : `${Math.abs(n)}개월 ${n < 0 ? "일찍 받기" : "늦게 받기"}`}
                        </option>
                      ))}
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
                  {current?.warnings.map((w) => (
                    <p className="yp-warning" role="status" key={w}>
                      △ {w}
                    </p>
                  ))}
                  <div className="yp-actions">
                    <button
                      className="yp-primary"
                      disabled={!result}
                      onClick={() => setTab("result")}
                    >
                      결과 비교하기 →
                    </button>
                    <button disabled={!result} onClick={() => openChat()}>
                      AI와 다른 계획 비교하기
                    </button>
                  </div>
                </section>
              )}
              {tab === "basis" && current && (
                <section id="yp-basis" className="yp-card yp-stack">
                  <div>
                    <h2>계산은 이렇게 했어요</h2>
                    <p>
                      분석 기간 {h.start} ~ {h.endYear}-12 · 매월 계산해요.
                    </p>
                    <p>
                      물가 연 {fmt(h.inflation * 100)}% · 수익률 계획 적용 전{" "}
                      {fmt(h.beforeReturn * 100)}% / 계획 적용 후{" "}
                      {fmt(h.planReturn * 100)}% · 세후 금액 기준이에요.
                    </p>
                    <button onClick={() => goTo(isExample ? "chat" : "manual")}>
                      {isExample ? "내 정보 입력하기 →" : "계산 가정 수정하기 →"}
                    </button>
                  </div>
                  <div>
                    <h3>금액을 읽는 방법</h3>
                    <p>
                      ‘구매력’은 물가 상승을 빼고 {h.start.slice(0, 4)}년 돈의
                      가치로 바꾼 금액이에요. ‘명목금액’은 해당 연도에 실제로
                      보이는 금액이에요. 주택연금은 대출이므로 마지막 금융자산을
                      순자산이나 상속재산으로 볼 수 없어요.
                    </p>
                  </div>
                  <div>
                    <h3>비상자금과 자금 부족은 달라요</h3>
                    <p>
                      비상자금은 월 생활비와 현재 대출 월 상환액의{" "}
                      {fmt(h.reserveMonths)}개월치예요. 자산이 0 이상이어도 이
                      목표에 못 미칠 수 있어요. 자산이 음수인 달부터는 충당하지
                      못한 부족액으로 표시해요.
                    </p>
                  </div>
                  <details>
                    <summary>월별 수입·지출 상세</summary>
                    <p className="yp-note">
                      모든 금액은 만 원 · 수입에는 운용수익이 포함돼요.
                    </p>
                    <div className="yp-scroll">
                      <table>
                        <thead>
                          <tr>
                            {[
                              "월",
                              "수입",
                              "지출",
                              "금융자산",
                              "기준년 구매력",
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
                                <td key={i}>{fmt(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                  <details>
                    <summary>내 결과와 보고서 자료 저장</summary>
                    <div className="yp-actions">
                      <button onClick={csv}>월별 계산 CSV</button>
                      <button onClick={verification}>
                        보고서 예시 대조표 CSV
                      </button>
                      <button onClick={() => window.print()}>
                        화면 인쇄·PDF
                      </button>
                    </div>
                    <p className="yp-note">
                      대조표는 내 입력과 무관하게 보고서 예시를 검증해요. 계산
                      정밀도 확인을 위해 내려받는 CSV와 조건 파일은 원래 숫자
                      정밀도를 유지해요.
                    </p>
                  </details>
                  <p className="yp-note">
                    기준 자료: 작업 엑셀 v1.1 · 본문 v11. 주택연금 표
                    보간·건강보험·추납 산식은 보고서 가정이며 실제 제도와 다를
                    수 있어요.
                  </p>
                </section>
              )}
            </div>
          )}
          {chatting && (
            <section
              id="yp-agent"
              className={`yp-card yp-conversation ${inlineChat ? "" : "yp-agent"}`}
              aria-labelledby="yp-agent-title"
              onKeyDown={(event) => {
                if (!inlineChat && event.key === "Escape") closeChat();
              }}
            >
              <div className="yp-panel-heading">
                <h2 id="yp-agent-title">AI 은퇴 상담</h2>
                {!inlineChat && (
                  <button
                    type="button"
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
                <div className="yp-agent-message yp-greeting">
                  <strong>AI 은퇴 상담</strong>
                  <p>
                    {collecting
                      ? "안녕하세요. 몇 년 몇 월에 은퇴할 예정이세요?"
                      : "은퇴 전망을 함께 살펴볼까요? 자금이 부족해지는 시점이나 계획을 바꿨을 때 달라지는 점을 물어보세요."}
                  </p>
                </div>
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
                                        origins[k as keyof Household] === "chat",
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

                      <strong>AI 은퇴 상담</strong>
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
                                <dd>{fmt(c.metrics.minAssets)}만 원</dd>
                              </div>
                              <div>
                                <dt>마지막 자산</dt>
                                <dd>{fmt(c.metrics.endAssets)}만 원</dd>
                              </div>
                            </dl>
                            <details>
                              <summary>변경 조건 {diff.length}개</summary>
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
                        ? "✦ AI 연결이 지연되고 있어요. 잠시만 기다려 주세요…"
                        : !collecting
                          ? "✦ 조건을 확인하고 필요한 계산을 진행하고 있어요…"
                          : "✦ 알려주신 정보를 정리하고 있어요…"}
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
                        )
                      }
                      disabled={busy || !submittedQuestion || retrySeconds > 0}
                    >
                      {retrySeconds > 0 ? `${retrySeconds}초 뒤 다시 시도` : "다시 시도"}
                    </button>
                  </div>
                )}
              </div>
              {undo && (
                <div className="yp-undo" role="status">
                  <span>
                    ✓ {applied ? `${applied} 적용 완료` : "입력 정보 반영 완료"}
                  </span>
                  <button onClick={restoreInput}>
                    되돌리기
                  </button>
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
                      ? "예: 2029년 12월에 은퇴할 예정이에요."
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
                  <small>
                    {retrySeconds > 0
                      ? `${retrySeconds}초 뒤에 다시 보낼 수 있어요.`
                      : "Enter 전송 · Shift+Enter 줄바꿈"}
                  </small>
                  {busy ? (
                    <button
                      type="button"
                      onClick={() => abort.current?.abort()}
                    >
                      분석 중단
                    </button>
                  ) : (
                    <button className="yp-primary" disabled={!question.trim() || retrySeconds > 0}>
                      보내기 ↑
                    </button>
                  )}
                </div>
              </form>
              {inlineChat && (
                <div className="yp-panel-foot">
                  <div className="yp-actions">
                    <button onClick={() => goTo("manual")}>
                      직접 입력하기
                    </button>
                    <button className="yp-primary" onClick={() => applyIntake(true)}>
                      내 결과 보기
                    </button>
                  </div>
                  {checkInput && (busy || !intakeComplete) && (
                    <p className="yp-error" role="alert">
                      {busy
                        ? "답변을 정리하고 있어요. 정리가 끝나면 다시 눌러 주세요."
                        : intakePrepared.missing.length
                          ? `결과를 보려면 정보를 더 입력해 주세요. 필요한 항목: ${intakePrepared.missing.map((key) => inputLabels[key] || fieldNames[key] || key).join(", ")}.`
                          : "결과를 보려면 입력한 날짜, 기간, 금액의 범위를 확인해 주세요."}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
        <footer className="yp-footer">
          {isExample ? (
            <p>예시에서 변경한 조건과 대화는 내 결과에 저장되지 않아요.</p>
          ) : storageError ? (
            <p role="status">{storageError}</p>
          ) : (
            <p>
              입력과 대화는 이 브라우저에 자동 저장돼요. 지우려면 ‘초기화’를
              누르세요.
            </p>
          )}
          참고용 시뮬레이션이며 상품 권유가 아니에요.
          <br />
          실제 수급 자격·지급액·세금은 관련 기관에서 확인해 주세요.
          {!isExample && activeView !== "home" && (
            <div>
              <button
                className="yp-text-button"
                onClick={() => resetDialog.current?.showModal()}
                disabled={!storageReady}
              >
                초기화
              </button>
            </div>
          )}
        </footer>
      </main>
      {!inlineChat && (
        <button
          type="button"
          ref={chatLauncher}
          className="yp-chat-launcher"
          aria-expanded={chatOpen}
          aria-controls={chatOpen ? "yp-agent" : undefined}
          aria-label={chatOpen ? "챗봇 닫기" : "챗봇 열기"}
          onClick={chatOpen ? closeChat : openChat}
        >
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
            <rect x="4" y="7" width="16" height="13" rx="4" />
            <path d="M12 7V4m-2.5 12h5M2 12v3m20-3v3" />
            <path d="M9 12h.01m6 0h.01" strokeWidth="2.8" />
          </svg>
        </button>
      )}
    </div>
  );
}
