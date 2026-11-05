"use client";
import { useEffect, useMemo, useRef, useState, useId } from "react";
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
  Household,
  Solutions,
  Simulation,
  fmt,
  version,
} from "../lib/household";
import {
  draftSchema,
  blankHousehold,
  cleanDraft,
  prepareScenario,
  inputLabels,
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
  ["beforeReturn", "준비 전 연 수익률", "%"],
  ["planReturn", "선택 계획 연 수익률", "%"],
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
      ? `${fmt(v)}${key === "pensionOffset" ? "개월" : key === "homeYear" ? "년" : ""}`
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
  onChange,
  error,
  hint,
}: {
  label: string;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
  error?: string;
  hint?: string;
}) {
  const errorId = useId();
  const display = Number.isFinite(value)
    ? String(Number(value.toFixed(1)))
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
            if (!/^-?\d*(\.\d?)?$/.test(v)) return;
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
          onBlur={() => setDraft(display)}
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
function useModalPanel(open: boolean, id: string, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const panel = document.getElementById(id);
    if (!panel) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,summary,[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const els = focusable(),
          first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, [open, id]);
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
      aria-label={`${which === "before" ? "준비 전" : which === "after" ? "선택한 계획" : "준비 전과 선택한 계획"} 금융자산 그래프. 선택 계획 최저 ${fmt(after.minAssets)}만 원, 최초 부족 ${dateText(after.firstNegative)}.`}
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
              name="준비 전"
              dot={false}
              stroke="#83948c"
              strokeDasharray="6 4"
              strokeWidth={2}
              isAnimationActive={false}
            />
          )}
          {which !== "before" && (
            <Line
              dataKey="after"
              name="선택한 계획"
              dot={false}
              stroke="#17654c"
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
          <h2>은퇴자금이 얼마나 이어질까요?</h2>
          <p>연말 금융자산 · {year}년 구매력 · 만 원</p>
        </div>
        <button aria-pressed={separate} onClick={() => setSeparate(!separate)}>
          {separate ? "겹쳐 보기" : "나란히 보기"}
        </button>
      </div>
      <div className="yp-legend">
        <span>┅ 준비 전</span>
        <span>━ 선택한 계획</span>
        <span>┈ 비상자금 기준</span>
        <span>─ 자산 0</span>
      </div>
      {separate ? (
        <div className="yp-two-charts">
          <div>
            <h3>준비 전</h3>
            {plot("before")}
          </div>
          <div>
            <h3>선택한 계획</h3>
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
function RobotIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16 7V4" />
      <circle cx="16" cy="3" r="1.3" fill="currentColor" stroke="none" />
      <rect x="5" y="8" width="22" height="18" rx="6" />
      <path d="M5 15H2v5h3m22-5h3v5h-3" />
      <circle cx="11.5" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 21c2.5 1.7 5.5 1.7 8 0" />
    </svg>
  );
}
export default function Planner() {
  const [h, setHousehold] = useState<Household>(blankHousehold),
    [s, setS] = useState<Solutions>({
      ...none,
      homeYear: new Date().getFullYear(),
    });
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
  const [settings, setSettings] = useState(false),
    [ai, setAI] = useState(false),
    [compact, setCompact] = useState(false),
    [tab, setTab] = useState<"result" | "plan" | "basis">("result");
  const [notice, setNotice] = useState(""),
    [fileError, setFileError] = useState(""),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [waitingSeconds, setWaitingSeconds] = useState(0),
    [aiError, setAIError] = useState(""),
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
    chatLauncher = useRef<HTMLButtonElement | null>(null),
    resetDialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    setCompact(mq.matches);
    if (mq.matches) setSettings(false);
    const resize = () => {
      setCompact(mq.matches);
    };
    mq.addEventListener("change", resize);
    return () => {
      mq.removeEventListener("change", resize);
      abort.current?.abort();
    };
  }, []);
  useModalPanel(settings && compact, "yp-settings", () => setSettings(false));
  useEffect(() => {
    if (!ai) return;
    agentInput.current?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        setAI(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      chatLauncher.current?.focus({ preventScroll: true });
    };
  }, [ai]);
  useEffect(() => {
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages, busy, aiError, ai]);
  useEffect(() => {
    setWaitingSeconds(0);
    if (!busy) return;
    const timer = window.setInterval(
      () => setWaitingSeconds((v) => v + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);
  const [accessToken, setAccessToken] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  useEffect(() => {
    if (compact && ai) setSettings(false);
  }, [compact, ai]);
  const snapshot = JSON.stringify({ h, s }),
    snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
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
        setAI(restored.ai);
      }
    } catch {
      setStorageError("이 브라우저에 저장된 내용을 불러오지 못했어요.");
    } finally {
      setStorageReady(true);
    }
  }, []);
  useEffect(() => {
    if (
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
          tab,
          ai,
          revision: revision.current,
          snapshot,
        }),
      );
      setStorageError("");
    } catch {
      setStorageError("이 브라우저에 자동 저장하지 못했어요.");
    }
  }, [storageReady, h, s, origins, messages, question, tab, ai, snapshot]);
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
  const chatStart = !result && !settings;
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
    const activeRequest = abort.current;
    abort.current = null;
    activeRequest?.abort();
    sending.current = false;
    setBusy(false);
    setUndo(null);
    setH(blankHousehold());
    setS({ ...none, homeYear: new Date().getFullYear() });
    setOrigins({});
    setMessages([]);
    setQuestion("");
    setSettings(false);
    setAI(false);
    setExampleInfo(false);
    setTab("result");
    setApplied("");
    setFileError("");
    setAIError("");
    setNotice("입력과 대화를 초기화했어요.");
  }
  function resetExample() {
    setAI(false);
    setSettings(false);
    abort.current?.abort();
    setUndo({ h, s, origins });
    setH({ ...example });
    setOrigins(
      Object.fromEntries(Object.keys(example).map((k) => [k, "example"])),
    );
    setS({ ...adopted });
    setNotice("권 부장 부부의 정보와 보고서 기본 계획을 불러왔어요.");
    setFileError("");
    setApplied("");
  }
  function restoreInput() {
    if (!undo) return;
    setH(undo.h);
    setS(undo.s);
    setOrigins(undo.origins || {});
    setUndo(null);
    setApplied("");
    setNotice("이전 입력으로 되돌렸어요.");
  }
  function showSettings() {
    setAI(false);
    setSettings(true);
  }
  function showAI() {
    if (compact || !result) setSettings(false);
    setAI(true);
  }
  async function ask() {
    const q = question.trim();
    if (!q || sending.current) return;
    sending.current = true;
    setAI(true);
    setBusy(true);
    setAIError("");
    const request = new AbortController();
    abort.current = request;
    const signal = request.signal,
      snap = snapshot;
    const requestRevision = revision.current;
    const pendingPatch = !result
      ? pendingIntake?.reply.intake?.patch
      : undefined;
    const history = messages.slice(-5).flatMap((m) => [
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
          operation: result ? "analyze" : "collect",
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
      setQuestion("");
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
      ["준비 전", result.before],
      ["선택한 계획", result.after],
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
            "준비 전 생애 순수지",
            -29398.8546046442,
            before.lifeNet,
            before.lifeNet + 29398.8546046442,
          ],
          [
            "선택 계획 최저 자산",
            3616.55185834155,
            after.minAssets,
            after.minAssets - 3616.55185834155,
          ],
          [
            "선택 계획 기말 자산",
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
  const status = current?.firstNegative
    ? "자금 부족 예상"
    : current?.passes
      ? "비상자금까지 유지"
      : "비상자금 보완 필요";
  return (
    <div className={`yp-app ${chatStart ? "yp-chat-start" : ""}`}>
      <a className="yp-skip" href={chatStart ? "#yp-question" : "#yp-analysis"}>
        {chatStart ? "대화 입력으로 건너뛰기" : "분석 결과로 건너뛰기"}
      </a>
      <header className="yp-header">
        <a className="yp-brand" href="/">
          young<span>planner</span>
          <small>은퇴의 다음 장</small>
        </a>
      </header>
      <main className="yp-main">
        <section className="yp-intro">
          <div>
            <p className="yp-eyebrow">은퇴 준비, 한눈에</p>
            <h1>
              월급이 끝난 뒤에도
              <br className="yp-mobile-break" /> 생활을 이어갈 수 있을까요?
            </h1>
            <p>정보를 확인하고, 준비 방법을 골라 결과를 비교해 보세요.</p>
          </div>
        </section>
        <div className="yp-start">
          <div className="yp-example-actions">
            <button
              className="yp-text-button"
              onClick={() => resetDialog.current?.showModal()}
              aria-haspopup="dialog"
              disabled={!storageReady}
            >
              초기화
            </button>
            <button className="yp-example-button" onClick={resetExample}>
              권 부장 부부 예시 넣기
            </button>
            <button
              className="yp-text-button"
              aria-expanded={exampleInfo}
              aria-controls="yp-example-info"
              onClick={() => setExampleInfo((v) => !v)}
            >
              예시 소개 {exampleInfo ? "⌃" : "⌄"}
            </button>
          </div>
          <button
            className="yp-text-button"
            onClick={() => (settings ? setSettings(false) : showSettings())}
            aria-expanded={settings}
            aria-controls="yp-settings"
          >
            {settings
              ? result
                ? "입력 접기 ↑"
                : "대화로 돌아가기 →"
              : "직접 정보 입력·수정 →"}
          </button>
        </div>
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
                aria-label="예시 소개 닫기"
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
              ‘예시 넣기’를 누르면 위 가구 정보와 보고서 기본 은퇴 계획을 함께
              불러와요. 이후 내 상황에 맞게 자유롭게 바꿀 수 있어요.
            </p>
          </section>
        )}
        {notice && (
          <div className="yp-notice" role="status">
            <span>{notice}</span>
            {undo && (
              <button onClick={restoreInput}>이전 입력으로 되돌리기</button>
            )}
            <button aria-label="알림 닫기" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        <div
          className={`yp-workspace ${settings && !compact ? "with-settings" : ""}`}
        >
          {settings && (
            <>
              {compact && (
                <button
                  className="yp-backdrop"
                  aria-label="내 정보 창 닫기"
                  onClick={() => setSettings(false)}
                />
              )}
              <aside
                id="yp-settings"
                className={`yp-card yp-settings ${compact ? "yp-drawer" : ""}`}
                role={compact ? "dialog" : undefined}
                aria-modal={compact ? true : undefined}
                aria-labelledby="yp-settings-title"
              >
                <div className="yp-panel-heading">
                  <div>
                    <p className="yp-eyebrow">01 / 내 정보</p>
                    <h2 id="yp-settings-title">우리 부부의 현재 상황</h2>
                  </div>
                  <button
                    aria-label="내 정보 닫기"
                    onClick={() => setSettings(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="yp-settings-body">
                  <p className="yp-note">
                    금액은 모두 만 원이에요. 바꾸면 결과에 바로 반영돼요.
                  </p>
                  {groups.map((g, i) => (
                    <details
                      className="yp-input-group"
                      key={g.title}
                      open={i === 0 ? true : undefined}
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
                              const nextH = householdSchema.parse(
                                  value.household,
                                ),
                                nextS = solutionSchema.parse(value.solutions);
                              setH(nextH);
                              setOrigins(
                                Object.fromEntries(
                                  Object.keys(nextH).map((k) => [k, "file"]),
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
                  <button
                    className="yp-primary"
                    onClick={() => {
                      setSettings(false);
                      setTab("plan");
                    }}
                  >
                    입력 확인 · 은퇴 계획 고르기 →
                  </button>
                </div>
              </aside>
            </>
          )}
          <div id="yp-analysis" className="yp-analysis" tabIndex={-1}>
            {!result && prepared.missing.length === 0 && (
              <div className="yp-card yp-error" role="alert">
                <h2>입력 정보를 확인해 주세요</h2>
                <p>
                  {(!validation.success
                    ? validation.error.issues
                    : !planValidation.success
                      ? planValidation.error.issues
                      : []
                  )
                    .map(
                      (i) =>
                        `${fieldNames[String(i.path[0])] || planLabels[i.path[0] as keyof Solutions] || "계산 기간"}: ${i.code === "custom" ? i.message : "허용 범위를 벗어났어요."}`,
                    )
                    .join(" / ")}
                </p>
                <button onClick={showSettings}>입력 수정하기</button>
              </div>
            )}
            {result && current && (
              <>
                <section
                  className={`yp-overview ${current.firstNegative ? "danger" : current.passes ? "safe" : "caution"}`}
                  aria-label="선택한 계획의 핵심 결과"
                >
                  <div className="yp-section-heading">
                    <div>
                      <p className="yp-eyebrow">지금 선택한 은퇴 계획</p>
                      <h2>
                        {current.firstNegative
                          ? `${dateText(current.firstNegative)}부터 자금이 부족해져요.`
                          : `${h.endYear}년까지 생활자금이 이어져요.`}
                      </h2>
                    </div>
                    <span className="yp-status">
                      {current.firstNegative ? "!" : current.passes ? "✓" : "△"}{" "}
                      {status}
                    </span>
                  </div>
                  <div className="yp-metrics">
                    <div>
                      <span>돈이 처음 부족한 때</span>
                      <strong>{dateText(current.firstNegative)}</strong>
                      <small>
                        준비 전 {dateText(result.before.firstNegative)}
                      </small>
                    </div>
                    <div>
                      <span>가장 적게 남는 돈</span>
                      <strong>
                        {fmt(current.minAssets)}
                        <em>만 원</em>
                      </strong>
                      <small>
                        {dateText(current.minMonth)} · {h.start.slice(0, 4)}년
                        구매력
                      </small>
                    </div>
                    <div>
                      <span>마지막에 남는 돈</span>
                      <strong>
                        {fmt(current.endAssets)}
                        <em>만 원</em>
                      </strong>
                      <small>{h.endYear}년 말 · 그해 명목금액</small>
                    </div>
                  </div>
                  <p className="yp-overview-note">
                    비상자금 목표 {fmt(current.reserve)}만 원{" "}
                    {current.passes ? "충족" : "미달"} · 본인 정상 연금 전 공백{" "}
                    {current.gapMonths}개월
                  </p>
                </section>
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
                      onClick={() => setTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {tab === "result" && (
                  <div id="yp-result" className="yp-stack">
                    <Charts
                      before={result.before}
                      after={current}
                      year={h.start.slice(0, 4)}
                    />
                    <section className="yp-card">
                      <div className="yp-section-heading">
                        <div>
                          <h2>무엇이 달라졌나요?</h2>
                          <p>
                            같은 가구 정보로 준비 전과 선택한 계획을 비교해요.
                          </p>
                        </div>
                        <button onClick={() => setTab("plan")}>
                          계획 바꾸기 →
                        </button>
                      </div>
                      <div className="yp-scroll">
                        <table>
                          <caption className="yp-sr">
                            준비 전과 선택한 계획 비교
                          </caption>
                          <thead>
                            <tr>
                              <th>비교 항목</th>
                              <th>준비 전</th>
                              <th>선택한 계획</th>
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
                        구매력이에요. 평생 수지는 시작 자산을 포함하고
                        운용수익은 제외한 수입·지출 합계예요.
                      </p>
                      <div className="yp-plan-summary">
                        {(
                          [
                            "benefits",
                            "job",
                            "repay",
                            "catchup",
                            "home",
                          ] as const
                        ).map((k) => (
                          <span key={k} className={s[k] ? "selected" : ""}>
                            {s[k] ? "✓" : "−"} {planLabels[k]}
                          </span>
                        ))}
                      </div>
                      <p className="yp-note">
                        준비 전에는 위 다섯 방법을 적용하지 않아요. 연 수익률도
                        준비 전 {fmt(h.beforeReturn * 100)}% / 선택 계획{" "}
                        {fmt(h.planReturn * 100)}%로 달라 결과에 함께 반영돼요.
                      </p>
                    </section>
                  </div>
                )}
                {tab === "plan" && (
                  <section id="yp-plan" className="yp-card">
                    <div className="yp-section-heading">
                      <div>
                        <p className="yp-eyebrow">02 / 은퇴 계획</p>
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
                            "구직급여 기간이 끝난 뒤부터 본인 정상 연금 전까지 일해요.",
                            [
                              ["jobIncome", "재취업 월급"],
                              [
                                "jobDelay",
                                "구직급여 종료 후 추가 대기",
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
                            [],
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
                                    은퇴 다음 달에 대출 잔액을 전액 상환해요.
                                    현재 대출 잔액은 {fmt(h.loan)}만 원이에요.
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
                                        min={Math.max(
                                          2026,
                                          +h.start.slice(0, 4),
                                        )}
                                        max={Math.min(2120, h.endYear)}
                                        value={s.homeYear}
                                        onChange={(e) =>
                                          setPlan({ homeYear: +e.target.value })
                                        }
                                      />
                                    </label>
                                    <p className="yp-note">
                                      {s.homeYear}년 2월부터 월{" "}
                                      {fmt(current.homeMonthly)}만 원 추정 ·
                                      실제 지급액은 한국주택금융공사에서 확인해
                                      주세요.
                                    </p>
                                    <label className="yp-checkbox">
                                      <input
                                        type="checkbox"
                                        checked={s.homeOverride > 0}
                                        onChange={(e) =>
                                          setPlan({
                                            homeOverride: e.target.checked
                                              ? Math.max(
                                                  0.1,
                                                  Math.round(
                                                    current.homeMonthly * 10,
                                                  ) / 10,
                                                )
                                              : 0,
                                          })
                                        }
                                      />
                                      확인한 주택연금 월액 직접 입력
                                    </label>
                                    {s.homeOverride > 0 && (
                                      <NumberField
                                        label="확인한 주택연금 월액"
                                        value={s.homeOverride}
                                        onChange={(v) =>
                                          setPlan({ homeOverride: v })
                                        }
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
                      일찍 받으면 월 0.5% 감액, 늦게 받으면 월 0.6% 가산하는
                      단순 비교예요. 가입기간·소득 등 실제 자격은 별도로
                      확인해야 해요.
                    </p>
                    {current.warnings.map((w) => (
                      <p className="yp-warning" role="status" key={w}>
                        △ {w}
                      </p>
                    ))}
                    <div className="yp-actions">
                      <button
                        className="yp-primary"
                        onClick={() => setTab("result")}
                      >
                        03 · 결과 비교하기 →
                      </button>
                      <button onClick={showAI}>AI와 다른 계획 비교하기</button>
                    </div>
                  </section>
                )}
                {tab === "basis" && (
                  <section id="yp-basis" className="yp-card yp-stack">
                    <div>
                      <h2>계산은 이렇게 했어요</h2>
                      <p>
                        분석 기간 {h.start} ~ {h.endYear}-12 · 매월 계산해요.
                      </p>
                      <p>
                        물가 연 {fmt(h.inflation * 100)}% · 수익률 준비 전{" "}
                        {fmt(h.beforeReturn * 100)}% / 선택 계획{" "}
                        {fmt(h.planReturn * 100)}% · 세후 금액 기준이에요.
                      </p>
                      <button onClick={showSettings}>
                        계산 가정 수정하기 →
                      </button>
                    </div>
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
              </>
            )}
          </div>
          {(ai || chatStart) && (
            <>
              <aside
                id="yp-agent"
                className={`yp-card yp-agent ${chatStart ? "yp-agent-inline" : ""}`}
                role={chatStart ? "region" : "dialog"}
                aria-modal={chatStart ? undefined : false}
                aria-labelledby="yp-agent-title"
              >
                <div className="yp-panel-heading">
                  <div>
                    <p className="yp-eyebrow">함께 살펴보는 은퇴 계획</p>
                    <h2 id="yp-agent-title" className="yp-chat-title">
                      <RobotIcon size={23} />
                      은퇴 챗봇
                    </h2>
                  </div>
                  {!chatStart && (
                    <button aria-label="챗봇 닫기" onClick={() => setAI(false)}>
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
                  {messages.length === 0 && (
                    <div className="yp-empty">
                      <span>
                        <RobotIcon size={28} />
                      </span>
                      {chatStart && <h1>은퇴 준비, 어디서부터 시작할까요?</h1>}
                      <h3 hidden={chatStart}>
                        {result
                          ? "조건을 바꿔 비교해 볼까요?"
                          : "은퇴 준비 정보를 함께 정리해요"}
                      </h3>
                      <p>
                        {result
                          ? "궁금한 점을 물어보거나, 다른 계획을 비교해 보세요."
                          : "아는 정보부터 편하게 알려주세요. 필요한 내용은 하나씩 함께 정리할게요."}
                      </p>
                      <div className="yp-suggestions">
                        {[
                          ...(result
                            ? [
                                "지금보다 마지막에 돈이 더 많이 남는 계획을 찾아줘",
                                "준비 전에는 왜 돈이 부족해져?",
                              ]
                            : [
                                "내 정보 입력을 도와줘. 필요한 것부터 하나씩 물어봐 줘.",
                                "예금과 대출부터 알려줄게. 무엇이 필요해?",
                              ]),
                        ].map((q) => (
                          <button
                            key={q}
                            onClick={() => {
                              setQuestion(q);
                              agentInput.current?.focus();
                            }}
                          >
                            {q} ↗
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <article className="yp-exchange" key={i}>
                      <p className="yp-user-message">{m.question}</p>
                      <div className="yp-agent-message">
                        {m.reply.intake &&
                          (m === pendingIntake ||
                            (m.snapshot !== snapshot &&
                              !messages
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
                                onClick={() => {
                                  if (
                                    snapshotRef.current !== m.snapshot ||
                                    m.revision !== revision.current
                                  )
                                    return;
                                  setUndo({ h, s, origins });
                                  if (m.reply.intake?.patch.hasSpouse === false)
                                    setS((v) => ({ ...v, catchup: false }));
                                  setH((v) => ({
                                    ...v,
                                    ...m.reply.intake!.patch,
                                  }));
                                  setOrigins((v) => ({
                                    ...v,
                                    ...Object.fromEntries(
                                      Object.keys(m.reply.intake!.patch).map(
                                        (k) => [k, "chat"],
                                      ),
                                    ),
                                  }));
                                  setNotice(
                                    "대화에서 확인한 정보를 반영했어요. 직접 입력에서도 수정할 수 있어요.",
                                  );
                                }}
                              >
                                {Object.entries(m.reply.intake.patch).every(
                                  ([k, v]) =>
                                    h[k as keyof Household] === v &&
                                    origins[k as keyof Household] === "chat",
                                )
                                  ? "반영된 정보"
                                  : "정리한 정보 반영"}
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

                        <strong>✦ 챗봇</strong>
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
                                disabled={
                                  m.snapshot !== snapshot || !diff.length
                                }
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
                    <p className="yp-thinking" role="status">
                      {waitingSeconds >= 6
                        ? "✦ AI 연결이 지연되고 있어요. 잠시만 기다려 주세요…"
                        : result
                          ? "✦ 조건을 확인하고 필요한 계산을 진행하고 있어요…"
                          : "✦ 알려주신 정보를 정리하고 있어요…"}
                    </p>
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
                        onClick={() => void ask()}
                        disabled={busy || !question.trim()}
                      >
                        다시 시도
                      </button>
                    </div>
                  )}
                </div>
                {undo && (
                  <div className="yp-undo" role="status">
                    <span>✓ {applied || "AI 계획"} 적용 완료</span>
                    <button
                      onClick={() => {
                        setH(undo.h);
                        setOrigins(undo.origins || {});
                        setS(undo.s);
                        setUndo(null);
                        setApplied("");
                        setNotice("AI 계획 적용 전으로 되돌렸어요.");
                      }}
                    >
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
                    {result
                      ? "궁금한 점을 물어보세요"
                      : "현재 상황을 편하게 알려주세요"}
                  </label>
                  <textarea
                    id="yp-question"
                    ref={agentInput}
                    rows={3}
                    maxLength={1500}
                    placeholder={
                      result
                        ? "예: 재취업을 하지 않으면 얼마나 달라져?"
                        : "예: 저는 58살이고 2년 뒤 은퇴해요. 예금은 6천만 원, 생활비는 월 250만 원 정도예요."
                    }
                    value={question}
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
                    <small>Enter 전송 · Shift+Enter 줄바꿈</small>
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
                        disabled={!question.trim()}
                      >
                        보내기 ↑
                      </button>
                    )}
                  </div>
                  <p className="yp-privacy">
                    전송하면 질문과 현재 가구 조건이 연결된 AI 제공자에게
                    전달돼요. 이름·연락처는 입력하지 마세요.
                  </p>
                </form>
              </aside>
            </>
          )}
        </div>
        <footer className="yp-footer">
          {storageError ? (
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
        </footer>
      </main>
      {!chatStart && (
        <button
          ref={chatLauncher}
          className="yp-chat-launcher"
          onClick={() => (ai ? setAI(false) : showAI())}
          aria-label={ai ? "챗봇 닫기" : "챗봇 열기"}
          aria-expanded={ai}
          aria-controls="yp-agent"
          title={ai ? "챗봇 닫기" : "은퇴 챗봇에게 물어보기"}
        >
          <RobotIcon size={32} />
          <span className="yp-sr">은퇴 챗봇</span>
        </button>
      )}
    </div>
  );
}
