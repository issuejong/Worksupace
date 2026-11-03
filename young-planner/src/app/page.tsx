"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import {
  Config,
  defaults,
  preset,
  presets,
  simulate,
  configSchema,
  modelVersion,
} from "../lib/finance";
const fmt = (v: number) => Math.round(v).toLocaleString("ko-KR");
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
type Chat = { role: string; text: string; record?: unknown };
export default function Page() {
  const [tab, setTab] = useState("결과"),
    [chatOpen, setChatOpen] = useState(true),
    [undoConfig, setUndoConfig] = useState<Config | null>(null),
    [config, setConfig] = useState<Config>({ ...defaults }),
    [selected, setSelected] = useState("S4"),
    [error, setError] = useState(""),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [chats, setChats] = useState<Chat[]>([]),
    [token, setToken] = useState(""),
    [loaded, setLoaded] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [chats, busy]);
  useEffect(() => {
    try {
      const v = localStorage.getItem("young-planner");
      if (v) {
        const data = JSON.parse(v);
        const p = configSchema.safeParse(data.config);
        if (p.success) setConfig(p.data);
        if (presets.some(([id]) => id === data.selected))
          setSelected(data.selected);
        if (Array.isArray(data.chats))
          setChats(
            data.chats
              .filter((c: Chat) => typeof c.text === "string")
              .slice(-30),
          );
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(
          "young-planner",
          JSON.stringify({ config, chats, selected }),
        );
      } catch {
        setError("브라우저 저장 공간이 부족합니다. JSON으로 내려받아 주세요.");
      }
  }, [config, chats, selected, loaded]);
  const result = useMemo(() => simulate(config), [config]),
    baseline = useMemo(() => simulate(preset("S0")), []),
    plan = useMemo(() => simulate(preset("S4")), []);
  const labels: Record<keyof Config, string> = {
    initialAssets: "시작 금융자산",
    living: "월 생활비",
    inflation: "물가 상승률",
    returns: "운용수익률",
    benefits: "구직급여",
    job: "재취업",
    jobDelay: "재취업 지연",
    jobIncome: "재취업 월급",
    repay: "주담대 상환",
    catchup: "국민연금 추납",
    home: "주택연금",
    homeYear: "가입 연도",
    homePayment: "주택연금 월액",
    shock: "일시 지출",
    shockYear: "지출 연도",
  };
  const displayValue = (key: keyof Config, value: number | boolean) => {
    if (typeof value === "boolean") return value ? "적용" : "미적용";
    if (key === "inflation" || key === "returns")
      return `${+(value * 100).toFixed(3)}%`;
    if (key === "homeYear" || key === "shockYear") return `${value}년`;
    if (key === "jobDelay") return `${value}개월`;
    return `${+value.toFixed(2)}만 원`;
  };
  const differences = (Object.keys(defaults) as (keyof Config)[]).filter(
    (key) => config[key] !== defaults[key],
  );
  const matchesSelected = (Object.keys(config) as (keyof Config)[]).every(
    (key) => config[key] === preset(selected)[key],
  );
  const chart = result.rows
    .filter((r) => r.date.endsWith("12"))
    .map((r) => {
      const i = result.rows.indexOf(r);
      return {
        year: r.year,
        "설계 전": Math.round(baseline.rows[i].realAssets),
        "기획 기준안 S4": Math.round(plan.rows[i].realAssets),
        "현재 시나리오": Math.round(r.realAssets),
      };
    });
  const annual = Object.values(
    result.rows.reduce<
      Record<number, { year: number; 수입: number; 지출: number }>
    >((a, r) => {
      a[r.year] ??= { year: r.year, 수입: 0, 지출: 0 };
      a[r.year].수입 += r.income;
      a[r.year].지출 += r.expenses;
      return a;
    }, {}),
  );
  const change = (key: keyof Config, value: number | boolean) => {
    const p = configSchema.safeParse({ ...config, [key]: value });
    if (p.success) {
      setUndoConfig(null);
      setConfig(p.data);
      setError("");
    } else setError("입력 범위를 확인해 주세요.");
  };
  const numeric = (key: keyof Config, label: string, step = 1, factor = 1) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        type="number"
        step={step}
        value={Number(config[key]) * factor}
        onChange={(e) => change(key, Number(e.target.value) / factor)}
      />
    </div>
  );
  const toggle = (key: keyof Config, label: string) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        type="checkbox"
        checked={Boolean(config[key])}
        onChange={(e) => change(key, e.target.checked)}
      />
    </div>
  );
  const exportJson = () =>
    download(
      "young-planner.json",
      JSON.stringify({ version: modelVersion, config, chats }, null, 2),
    );
  const csv = () => {
    const header =
      "월,수입(만원),지출(만원),금융자산_명목(만원),금융자산_2026가치(만원),주담대잔액(만원)";
    download(
      "월별현금흐름.csv",
      "\ufeff" +
        header +
        "\n" +
        result.rows
          .map((r) =>
            [r.date, r.income, r.expenses, r.assets, r.realAssets, r.loan].join(
              ",",
            ),
          )
          .join("\n"),
      "text/csv;charset=utf-8",
    );
  };
  const png = async () => {
    const svg = document.querySelector("#asset-chart svg");
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      }),
      url = URL.createObjectURL(blob),
      img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.download = "금융자산추이.png";
      a.href = canvas.toDataURL();
      a.click();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("이미지 저장에 실패했습니다.");
    };
    img.src = url;
  };
  async function ask(text = question) {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    setChatOpen(true);
    setBusy(true);
    setError("");
    setQuestion("");
    setChats((c) => [...c, { role: "user", text }]);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: text,
          config,
          history: chats.slice(-10).map((c) => ({
            role: c.role === "user" ? "user" : "assistant",
            content: c.text.slice(0, 6000),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const p = configSchema.safeParse(data.config);
      if (p.success) {
        if (JSON.stringify(p.data) !== JSON.stringify(config))
          setUndoConfig(config);
        setConfig(p.data);
      }
      setChats((c) => [
        ...c,
        { role: "assistant", text: data.answer, record: data },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 요청 오류");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <header>
        <strong>
          young<span>planner</span>{" "}
          <span style={{ fontSize: 12, marginLeft: 12 }}>영 플래너</span>
        </strong>
        <small>AFPK CHALLENGE 2026 · 가상 고객 B안</small>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">PLAN YOUR NEXT CHAPTER</div>
            <h1>은퇴의 다음 장을, 숫자로 그리다.</h1>
            <p>
              권성우 부부의 은퇴 계획을 비교하고 더 오래 지속되는 선택을
              살펴보세요.
            </p>
          </div>
          <span className="badge">2026.11 — 2060.12</span>
        </div>
        <div className="workspace-toolbar">
          <span>조건을 바꾸면 현재 시나리오에 바로 반영됩니다.</span>
          <button
            className="secondary"
            aria-expanded={chatOpen}
            aria-controls="agent-panel"
            onClick={() => setChatOpen((v) => !v)}
          >
            {chatOpen ? "AI 패널 접기" : "AI 플래너 열기"}
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className={`workspace ${chatOpen ? "with-agent" : ""}`}>
          <div className="grid">
            <aside className="card side">
              <fieldset disabled={busy} className="condition-fields">
                <legend>시나리오 조건</legend>
                <div className="profile">
                  <div className="eyebrow">OUR HOUSEHOLD</div>
                  <p>
                    <strong>권성우 부부</strong>
                  </p>
                  <p>
                    59세·56세 / 중소기업 근로자 가구
                    <br />
                    주택 3.5억 · 주담대 5,000만 원
                  </p>
                </div>
                <label htmlFor="preset">시작할 기본안</label>
                <p className="muted">
                  선택하면 현재 조건을 해당 기본안으로 바꿉니다.
                </p>
                <select
                  id="preset"
                  value={selected}
                  onChange={(e) => {
                    setUndoConfig(null);
                    setSelected(e.target.value);
                    setConfig(preset(e.target.value));
                  }}
                >
                  {presets.map(([id, name]) => (
                    <option key={id} value={id}>
                      {id} · {name}
                    </option>
                  ))}
                </select>
                {numeric("initialAssets", "시작 금융자산 (만원)", 100)}
                {numeric("living", "월 생활비 (만원)", 10)}
                {numeric("inflation", "물가 상승률 (%)", 0.1, 100)}
                {numeric("returns", "운용수익률 (%)", 0.1, 100)}
                <hr style={{ border: 0, borderTop: "1px solid #dfe6df" }} />
                {toggle("benefits", "구직급여 수령")}
                {toggle("job", "남편 재취업")}
                {config.job && (
                  <>
                    {numeric("jobDelay", "재취업 지연 (개월)")}
                    {numeric("jobIncome", "재취업 세후 월급 (만원)", 10)}
                  </>
                )}
                {toggle("repay", "주담대 전액 상환")}
                {toggle("catchup", "아내 국민연금 추납")}
                {toggle("home", "주택연금 가입")}
                {config.home && (
                  <>
                    {numeric("homeYear", "가입 연도 (2월 시작)")}
                    {numeric("homePayment", "확인할 월지급금 (만원)", 0.1)}
                  </>
                )}
                <details>
                  <summary>일시 지출 설정</summary>
                  {numeric("shock", "의료비 등 일시 지출 (만원)", 100)}
                  {numeric("shockYear", "지출 연도 (1월)")}
                </details>
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setUndoConfig(null);
                      setConfig({ ...defaults });
                      setSelected("S4");
                    }}
                  >
                    초기화
                  </button>
                  <button className="secondary" onClick={exportJson}>
                    JSON 저장
                  </button>
                  <label className="secondary file">
                    불러오기
                    <input
                      aria-label="시나리오 JSON 불러오기"
                      type="file"
                      accept=".json"
                      onChange={async (e) => {
                        try {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (f.size > 2000000) throw Error();
                          const data = JSON.parse(await f.text());
                          const c = configSchema.parse(data.config);
                          setUndoConfig(null);
                          setConfig(c);
                          setError("");
                        } catch {
                          setError(
                            "올바른 시나리오 JSON 파일을 선택해 주세요.",
                          );
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </fieldset>
            </aside>
            <div className="analysis-panel">
              <div className="metrics">
                {[
                  [
                    "처음 부족해지는 달",
                    result.firstNegative ?? "소진 없음",
                    "410개월 분석 기준",
                  ],
                  [
                    "최저 금융자산",
                    `${fmt(result.minAssets)}만 원`,
                    "2026년 구매력 기준",
                  ],
                  [
                    "비상자금 기준",
                    result.passes ? "충족" : "미달",
                    `기준 ${fmt(result.reserve)}만 원`,
                  ],
                  [
                    "2060년 말 자산",
                    `${fmt(result.endAssets)}만 원`,
                    "명목금액 기준",
                  ],
                ].map(([label, value, sub]) => (
                  <div className="card metric" key={label}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                    <em>{sub}</em>
                  </div>
                ))}
              </div>
              <nav className="tabs local-tabs" aria-label="분석 보기">
                {["결과", "시나리오 비교", "가정과 근거"].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </nav>
              <section className="scenario-context" aria-label="시나리오 설명">
                <strong>
                  현재 시나리오 {matchesSelected ? `· ${selected}` : "· 수정됨"}
                </strong>
                <p>
                  기획 기준안 S4는 재취업·주담대 상환·추납·2031년 주택연금
                  가입을 적용한 고정 비교 기준입니다. 현재 시나리오는 직접
                  입력하거나 AI로 바꾼 조건입니다.
                </p>
                {differences.length === 0 ? (
                  <span className="same-plan">
                    현재 조건은 기획 기준안 S4와 같습니다. 그래프의 두 선이 겹쳐
                    보입니다.
                  </span>
                ) : (
                  <div className="difference-list">
                    {differences.map((key) => (
                      <span key={key}>
                        {labels[key]}: {displayValue(key, defaults[key])} →{" "}
                        {displayValue(key, config[key])}
                      </span>
                    ))}
                  </div>
                )}
              </section>
              {tab === "가정과 근거" ? (
                <section className="card notes">
                  <h2>결과를 읽기 전에</h2>
                  <div className="notice warning">
                    부분 검증 모델 · {modelVersion}
                    <br />
                    국민연금 두 산식은 부분 수정했습니다. 실제
                    지급액·세금·보험·주택연금 월액의 최종 확인이 필요합니다.
                  </div>
                  <ul>
                    <li>
                      가상 부부: 남편 1967년 1월생, 아내 1970년 1월생. 남편 은퇴
                      2027년 1월, 아내 근로 종료 2029년 12월.
                    </li>
                    <li>
                      남편 국민연금 월 133.83만 원, 아내 추납 전 58.33만 원·추납
                      후 81.54만 원은 기존 가정을 유지한 부분 수정값입니다.
                    </li>
                    <li>
                      추납은 119개월·1,356.6만 원·2026년 11월 일시납 가정입니다.
                      가입 이력과 기준소득의 공단 확인이 필요합니다.
                    </li>
                    <li>
                      주택연금 월액은 원본의 보간값입니다. 가입 연도 변경 시
                      월지급금을 별도로 확인해 입력하세요. 미래 가입 당시
                      지급액을 보장하지 않습니다.
                    </li>
                    <li>
                      운용수익률은 모든 비교안에 공통 적용합니다. 금융자산의
                      음수는 누적 부족액이며 실제 대출 잔액이 아닙니다.
                    </li>
                    <li>
                      부부 모두 분석 종료까지 생존, 재산보험료 0, 구직급여
                      9개월을 가정합니다. 연금소득세·유족연금·주택연금
                      채무·기초연금은 별도 반영하지 않았습니다.
                    </li>
                    <li>
                      최저 금융자산은 2026년 구매력, 기말 금융자산은
                      명목금액입니다. 비상자금 기준은 2026년 가치 1,513만
                      원입니다.
                    </li>
                  </ul>
                  <h3>공식 근거</h3>
                  <p>
                    <a
                      href="https://www.nabo.go.kr/board/file/down.do?fid=33318043"
                      target="_blank"
                      rel="noreferrer"
                    >
                      국회예산정책처 · 과거 가입분 연금 산식
                    </a>
                  </p>
                  <p>
                    <a
                      href="https://www.nps.or.kr/pbcpgdnc/mainbiz/getOHAG0058M0.do"
                      target="_blank"
                      rel="noreferrer"
                    >
                      국민연금공단 · 연금 제도
                    </a>
                  </p>
                  <p>
                    <a
                      href="https://hf.go.kr/ko/sub03/sub03_01_01_02.do"
                      target="_blank"
                      rel="noreferrer"
                    >
                      한국주택금융공사 · 월지급금
                    </a>
                  </p>
                </section>
              ) : tab === "결과" ? (
                <>
                  <section className="card">
                    <div className="charttop">
                      <div>
                        <h2>시간에 따라 달라지는 금융자산</h2>
                        <p className="muted">
                          연말 잔액 · 2026년 구매력 기준 · 만원
                        </p>
                      </div>
                      <div className="legend">
                        <span>설계 전</span>
                        <span>기획 기준안 S4</span>
                        <span>현재 시나리오</span>
                      </div>
                    </div>
                    <div id="asset-chart" className="chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chart}
                          margin={{ left: 5, right: 10, top: 15, bottom: 5 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 4"
                            vertical={false}
                            stroke="#e8ece5"
                          />
                          <XAxis
                            dataKey="year"
                            tick={{ fontSize: 10 }}
                            minTickGap={35}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            width={55}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            formatter={(v) => `${fmt(Number(v))}만 원`}
                          />
                          <ReferenceLine y={0} stroke="#b6bdb3" />
                          <ReferenceLine
                            y={result.reserve}
                            stroke="#c5b77c"
                            strokeDasharray="4 4"
                          />
                          <Line
                            dataKey="설계 전"
                            stroke="#aeb7ad"
                            dot={false}
                            strokeWidth={2}
                          />
                          <Line
                            dataKey="기획 기준안 S4"
                            stroke="#216653"
                            dot={false}
                            strokeWidth={2}
                          />
                          <Line
                            dataKey="현재 시나리오"
                            stroke="#b48c42"
                            dot={false}
                            strokeWidth={2.5}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="actions">
                      <button className="secondary" onClick={png}>
                        그래프 PNG
                      </button>
                      <button className="secondary" onClick={csv}>
                        월별 CSV
                      </button>
                    </div>
                  </section>
                  <div className="notice">
                    {result.passes
                      ? "현재 가정에서는 비상자금 기준을 유지합니다."
                      : "현재 조건에서는 비상자금 기준에 못 미치는 구간이 있습니다."}{" "}
                    재취업 지연·생활비 증가 조건도 함께 확인해 보세요.
                  </div>
                  <section className="card">
                    <h2>연도별 수입과 지출</h2>
                    <p className="muted">
                      명목금액 · 만원 · 2026년은 11~12월만 포함
                    </p>
                    <div className="chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={annual}>
                          <CartesianGrid
                            strokeDasharray="3 4"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="year"
                            tick={{ fontSize: 10 }}
                            minTickGap={35}
                          />
                          <YAxis tick={{ fontSize: 10 }} width={55} />
                          <Tooltip
                            formatter={(v) => `${fmt(Number(v))}만 원`}
                          />
                          <Legend />
                          <Bar
                            dataKey="수입"
                            fill="#326f5b"
                            radius={[3, 3, 0, 0]}
                          />
                          <Bar
                            dataKey="지출"
                            fill="#c9d5bd"
                            radius={[3, 3, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                </>
              ) : (
                <section className="card">
                  <h2>같은 가구, 다른 선택</h2>
                  <div className="actions">
                    {[
                      ["재취업 1년 지연", { jobDelay: 12 }],
                      ["재취업 실패", { job: false }],
                      ["생활비 +30만 원", { living: 280 }],
                      ["의료비 2,000만 원", { shock: 2000 }],
                    ].map(([label, patch]) => (
                      <button
                        className="secondary"
                        key={String(label)}
                        disabled={busy}
                        onClick={() => {
                          setUndoConfig(null);
                          setConfig((c) => ({
                            ...c,
                            ...(patch as Partial<Config>),
                          }));
                        }}
                      >
                        {String(label)}
                      </button>
                    ))}
                  </div>
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>시나리오</th>
                          <th>최초 부족월</th>
                          <th>최저 자산¹</th>
                          <th>기말 자산²</th>
                          <th>비상자금</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...presets.map(([id, name]) => ({
                            name: `${id} ${name}`,
                            r: simulate(preset(id)),
                          })),
                          { name: "현재 시나리오", r: result },
                        ].map(({ name, r }) => (
                          <tr key={name}>
                            <td>{name}</td>
                            <td>{r.firstNegative ?? "없음"}</td>
                            <td>{fmt(r.minAssets)}</td>
                            <td>{fmt(r.endAssets)}</td>
                            <td>{r.passes ? "충족" : "미달"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted">
                    만원 · ¹2026년 구매력 ²명목금액. 모든 기본안의 운용수익률은
                    동일합니다.
                  </p>
                  <h3>현재 시나리오 월별 명세</h3>
                  <button className="secondary" onClick={csv}>
                    CSV 저장
                  </button>
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>월</th>
                          <th>수입</th>
                          <th>지출</th>
                          <th>금융자산²</th>
                          <th>주담대</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((r) => (
                          <tr key={r.date}>
                            <td>{r.date}</td>
                            <td>{fmt(r.income)}</td>
                            <td>{fmt(r.expenses)}</td>
                            <td>{fmt(r.assets)}</td>
                            <td>{fmt(r.loan)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              <div className="notice warning">
                부분 검증 모델입니다. 주택연금 월액·건강보험·세금 등의 추가 확인
                사항은 ‘가정과 근거’에서 확인하세요.
              </div>
            </div>
          </div>
          {chatOpen && (
            <aside
              id="agent-panel"
              className="card agent-panel"
              aria-label="AI 플래너 채팅"
            >
              <div className="agent-heading">
                <div>
                  <div className="eyebrow">YOUR PLANNING AGENT</div>
                  <h2>AI 플래너</h2>
                </div>
                <span className="agent-status">
                  {busy ? "계산 중" : "대화 가능"}
                </span>
              </div>
              <div
                className="agent-thread"
                role="log"
                aria-label="AI 대화"
                aria-live="polite"
              >
                <p className="muted">
                  현재 조건과 최근 대화를 바탕으로 함께 분석합니다. 변경을
                  요청하면 현재 시나리오에 반영합니다.
                </p>
                <div className="actions">
                  {[
                    "재취업이 1년 늦어지면?",
                    "생활비를 월 280만 원으로 바꿔줘",
                    "현재 안의 취약한 가정을 설명해줘",
                    "현재 결과를 공모전 발표용으로 짧게 요약해줘. 계산의 한계도 포함해줘.",
                  ].map((q) => (
                    <button
                      className="secondary"
                      key={q}
                      onClick={() => ask(q)}
                      disabled={busy}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                {chats.map((c, i) => (
                  <div
                    key={i}
                    className={`bubble ${c.role === "user" ? "user" : ""}`}
                  >
                    <strong>{c.role === "user" ? "나" : "AI 플래너"}</strong>
                    {c.role === "user" ? (
                      <div>{c.text}</div>
                    ) : (
                      <div className="markdown">
                        <Markdown remarkPlugins={[remarkGfm]}>
                          {c.text}
                        </Markdown>
                      </div>
                    )}
                    {c.record !== undefined && (
                      <small className="muted">
                        도구·계산 버전 기록 저장됨
                      </small>
                    )}
                  </div>
                ))}
                {busy && (
                  <p className="thinking" role="status">
                    조건과 계산 결과를 살펴보고 있어요…
                  </p>
                )}
                <div ref={chatEnd} />
              </div>
              {undoConfig && (
                <button
                  className="secondary undo"
                  disabled={busy}
                  onClick={() => {
                    setConfig(undoConfig);
                    setUndoConfig(null);
                  }}
                >
                  마지막 AI 변경 되돌리기
                </button>
              )}
              <form
                className="agent-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask();
                }}
              >
                <label htmlFor="question">궁금한 조건이나 결과</label>
                <textarea
                  id="question"
                  rows={3}
                  disabled={busy}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={1500}
                  placeholder="예: 2030년에 의료비 2,000만 원이 필요하면?"
                />
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || !question.trim()}
                  >
                    {busy ? "분석 중…" : "질문하기"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      download(
                        "AI검증기록.json",
                        JSON.stringify(chats, null, 2),
                      )
                    }
                  >
                    대화 저장
                  </button>
                </div>
              </form>
              <details>
                <summary>AI 접근 설정</summary>
                <p className="muted">
                  서버가 공용 접근 토큰을 요구하는 경우에만 입력하세요. API 키는
                  이 화면에 입력하지 않습니다.
                </p>
                <input
                  aria-label="AI 접근 토큰"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </details>
            </aside>
          )}
        </div>
      </main>
      <footer>
        Young Planner · 가상 고객의 조건부 시뮬레이션 · {modelVersion}
      </footer>
    </>
  );
}
