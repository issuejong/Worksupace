const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

Module._extensions[".ts"] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  );

const { engine } = require("../src/lib/finance.ts");
const references = require("../tests/report-v17.json");
const metrics = [
  "월말 금융자산",
  "기준년 구매력 자산",
  "건강보험료",
  "실질 순현금흐름",
];
const lines = [
  [
    "시나리오",
    "월",
    ...metrics.flatMap((metric) => [
      `${metric} 엑셀(만원)`,
      `${metric} 앱(만원)`,
      `${metric} 차이(원)`,
    ]),
    "판정",
  ].join(","),
];

let max = 0;
let failed = 0;
for (const { name, params, rows: expectedRows } of references) {
  const { rows } = engine(params);
  if (rows.length !== expectedRows.length)
    throw new Error(`${name}: 앱과 엑셀의 분석 기간이 다릅니다.`);
  rows.forEach((row, i) => {
    const [date, ...expected] = expectedRows[i];
    if (date !== row.date)
      throw new Error(
        `${name}: 엑셀 ${date}와 앱 ${row.date}의 날짜가 다릅니다.`,
      );
    const deflator = (1 + params[5]) ** (row.year - params[4]);
    const actual = [
      row.assets,
      row.realAssets,
      row.components.건강보험,
      (row.net - row.interest) / deflator,
    ];
    const deltas = actual.map((value, j) => (value - expected[j]) * 10000);
    const matches = deltas.every((delta) => Math.abs(delta) < 1);
    max = Math.max(max, ...deltas.map(Math.abs));
    if (!matches) failed++;
    lines.push(
      [
        name,
        date,
        ...expected.flatMap((value, j) => [value, actual[j], deltas[j]]),
        matches ? "일치" : "차이",
      ].join(","),
    );
  });
}

const out = path.resolve(process.argv[2] || "docs/report-verification.csv");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, "\ufeff" + lines.join("\n") + "\n");
console.log(
  `${references.length}개 시나리오 / ${lines.length - 1}개월 대조 / 월별 ${metrics.length}개 지표 / 최대오차 ${max.toFixed(6)}원 / 실패 ${failed}\n${out}`,
);
if (failed) process.exitCode = 1;
