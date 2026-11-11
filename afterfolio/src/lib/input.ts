import { z } from "zod";
import {
  Household,
  Solutions,
  householdSchema,
  solutionSchema,
} from "./household";
export const draftSchema = z.object(householdSchema.shape).partial().strict();
export const inputLabels: Partial<Record<keyof Household, string>> = {
  hasSpouse: "배우자 여부",
  birth: "본인 출생연월",
  spouseBirth: "배우자 출생연월",
  retire: "본인 은퇴 예정월",
  spouseEnd: "배우자 근로 종료월",
  income: "본인 세후 월급",
  spouseIncome: "배우자 세후 월급",
  assets: "금융자산",
  loan: "대출 잔액",
  living: "월 생활비",
  severance: "예상 세후 퇴직금",
  pension: "본인 예상 월 연금",
  spousePension: "배우자 예상 월 연금",
  loanRate: "대출 연금리",
  loanMonths: "대출 잔여 개월",
  house: "주택가격",
  jobIncome: "재취업 월급",
  benefit: "구직급여 월액",
  benefitMonths: "구직급여 기간",
  catchupCost: "추납 비용",
  catchupPension: "추납 후 월 연금",
  propertyHealthPremium: "지역건강보험료 중 월 재산보험료",
};
export function blankHousehold(): Household {
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Seoul",
  });
  const year = Number(today.slice(0, 4)),
    start = today.slice(0, 7);
  return {
    birth: "",
    spouseBirth: "",
    retire: "",
    spouseEnd: "",
    start: start,
    endYear: year + 34,
    income: NaN,
    spouseIncome: NaN,
    assets: NaN,
    house: NaN,
    loan: NaN,
    loanRate: NaN,
    loanMonths: NaN,
    living: NaN,
    severance: NaN,
    tenure: 0,
    pension: NaN,
    spousePension: NaN,
    catchupPension: NaN,
    catchupCost: NaN,
    child: 0,
    childEnd: start,
    inflation: 0.02,
    wageGrowth: 0.03,
    propertyHealthPremium: 0,
    beforeReturn: 0.02538,
    planReturn: 0.027918,
    jobIncome: NaN,
    jobDelay: 0,
    benefit: NaN,
    benefitMonths: NaN,
    reserveMonths: 5,
    shock: 0,
    shockYear: year,
  };
}
export function cleanDraft(h: Partial<Household>): Partial<Household> {
  return Object.fromEntries(
    Object.entries(h).filter(([, v]) =>
      typeof v === "number" ? Number.isFinite(v) : v === false || Boolean(v),
    ),
  );
}
export function readScenarioFile(value: unknown) {
  const saved = z
    .object({
      household: draftSchema,
      solutions: solutionSchema,
    })
    .parse(value);
  return {
    ...saved,
    household: { ...blankHousehold(), ...saved.household },
    fields: Object.keys(saved.household),
  };
}

export function mergeIntake(
  h: Household,
  s: Solutions,
  patch: Partial<Household>,
) {
  const household = { ...h, ...patch };
  return {
    household,
    solutions: household.hasSpouse === false ? { ...s, catchup: false } : s,
  };
}

export function prepareScenario(h: Household, s: Solutions) {
  const single = h.hasSpouse === false;
  const required: (keyof Household)[] = ["birth", "retire"];
  if (h.hasSpouse === undefined && !h.spouseBirth) required.push("hasSpouse");
  required.push("income", "assets", "loan", "living", "severance", "pension");
  if (!single && (h.hasSpouse === true || h.spouseBirth)) {
    required.push("spouseBirth", "spouseIncome", "spousePension");
    if (h.spouseIncome > 0) required.push("spouseEnd");
  }
  if (h.loan > 0) required.push("loanRate", "loanMonths");
  const optional: (keyof Household)[] = [];
  if (s.home && !s.homeOverride) optional.push("house");
  if (s.job) optional.push("jobIncome");
  if (s.benefits) optional.push("benefit", "benefitMonths");
  if (s.catchup && !single) optional.push("catchupCost", "catchupPension");
  const optionalMissing = optional.filter((key) => !Number.isFinite(h[key]));
  const missing = required.filter((k) =>
    typeof h[k] === "number"
      ? !Number.isFinite(h[k])
      : h[k] === undefined || h[k] === "",
  );
  if (missing.length) return { missing, optionalMissing, household: null };
  const normalized = {
    ...h,
    house: Number.isFinite(h.house) ? h.house : 0,
    propertyHealthPremium: Number.isNaN(h.propertyHealthPremium)
      ? 0
      : h.propertyHealthPremium,
    spouseBirth: single ? h.birth : h.spouseBirth,
    spouseIncome: single ? 0 : h.spouseIncome,
    spousePension: single ? 0 : h.spousePension,
    spouseEnd: single || h.spouseIncome === 0 ? h.start : h.spouseEnd,
    loanRate: h.loan === 0 ? 0 : h.loanRate,
    loanMonths: h.loan === 0 ? 1 : h.loanMonths,
    jobIncome: Number.isFinite(h.jobIncome) ? h.jobIncome : 0,
    benefit: Number.isFinite(h.benefit) ? h.benefit : 0,
    benefitMonths: Number.isFinite(h.benefitMonths) ? h.benefitMonths : 0,
    catchupCost: Number.isFinite(h.catchupCost) ? h.catchupCost : 0,
    catchupPension:
      Number.isFinite(h.catchupCost) && Number.isFinite(h.catchupPension)
        ? h.catchupPension
        : 0,
  };
  const parsed = householdSchema.safeParse(normalized);
  return {
    missing,
    optionalMissing,
    household: parsed.success ? parsed.data : null,
  };
}

export const skippableMoneyFields = [
  "income",
  "spouseIncome",
  "assets",
  "house",
  "loan",
  "living",
  "severance",
  "pension",
  "spousePension",
  "jobIncome",
  "benefit",
  "catchupCost",
  "catchupPension",
] as const satisfies readonly (keyof Household)[];
export type SkippableMoneyField = (typeof skippableMoneyFields)[number];

export function isSkippableMoneyField(
  key: keyof Household | undefined,
): key is SkippableMoneyField {
  return skippableMoneyFields.some((field) => field === key);
}

function firstIntakeQuestionField(missing: (keyof Household)[]) {
  return missing.includes("retire") ? "retire" : missing[0];
}

export function nextIntakeField(h: Household, s: Solutions) {
  const { missing, optionalMissing } = prepareScenario(h, s);
  return (
    firstIntakeQuestionField(missing) ??
    optionalMissing.find(isSkippableMoneyField)
  );
}

type InputLookup = {
  description: string;
  link?: { label: string; href: string };
};
const pensionLookup: InputLookup = {
  description:
    "국민연금공단에서 본인 인증 후 정상 수령 시의 월 예상액을 확인해 주세요. ‘현재가치’ 기준 금액을 사용해요.",
  link: {
    label: "국민연금공단 예상연금액 조회",
    href: "https://www.nps.or.kr/comm/quick/getOHAH0011M0.do",
  },
};
const loanLookup: InputLookup = {
  description:
    "대출받은 금융사 앱이나 대출 상환 명세에서 남은 원금, 금리와 상환 기간을 확인할 수 있어요.",
};
const catchupLookup: InputLookup = {
  description:
    "국민연금공단(1355)에 추납 비용과 추납 후 예상 연금액을 문의해 주세요.",
  link: {
    label: "국민연금공단 추후납부 안내",
    href: "https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0047M0.do?menuId=MN24001116",
  },
};
export const inputLookups: Partial<Record<keyof Household, InputLookup>> = {
  birth: { description: "신분증에 적힌 생년월일의 연도와 월을 확인해 주세요." },
  spouseBirth: { description: "배우자에게 태어난 연도와 월을 확인해 주세요." },
  retire: {
    description:
      "회사 인사팀에 확인하거나, 예상하는 은퇴 연도와 월을 알려주세요.",
  },
  spouseEnd: {
    description:
      "배우자에게 일을 그만둘 것으로 예상하는 연도와 월을 확인해 주세요.",
  },
  hasSpouse: {
    description: "이 계산에 배우자의 소득과 지출을 함께 넣을지 알려주세요.",
  },
  pension: pensionLookup,
  spousePension: pensionLookup,
  assets: {
    description:
      "집값과 아직 받지 않은 퇴직금을 빼고, 금융사 앱에서 예금·적금·투자 잔액을 확인해 합산해 주세요.",
    link: {
      label: "금융결제원 어카운트인포",
      href: "https://www.payinfo.or.kr/",
    },
  },
  house: {
    description:
      "비슷한 면적과 조건의 최근 거래를 참고해 예상 집값을 입력해 주세요.",
    link: {
      label: "국토교통부 실거래가 조회",
      href: "https://rt.molit.go.kr/pt/qut/qut.do",
    },
  },
  income: {
    description:
      "최근 급여명세서의 실수령액이나 급여가 입금된 통장 내역을 확인해 주세요.",
  },
  spouseIncome: {
    description:
      "배우자의 급여명세서나 급여 입금 내역에서 세후 월급을 확인해 주세요.",
  },
  living: {
    description:
      "최근 카드 명세서와 계좌 지출 내역을 보고 평소 한 달 생활비를 합산해 주세요.",
  },
  loan: loanLookup,
  loanRate: loanLookup,
  loanMonths: loanLookup,
  severance: {
    description:
      "회사 인사팀에 예상 세후 퇴직금을 확인해 주세요. 고용노동부 계산기는 예상 퇴직금의 참고값을 구할 때 쓸 수 있어요.",
    link: {
      label: "고용노동부 퇴직금 계산기",
      href: "https://1350.moel.go.kr/home/hp/retirementpaycal/retirementpaycal.jsp",
    },
  },
  jobIncome: {
    description:
      "재취업할 곳의 채용 공고나 근로계약서에서 예상 월급을 확인해 주세요. 이 앱에는 세후 월급을 입력해요.",
  },
  benefit: {
    description:
      "고용24에서 근로자 유형을 선택해 예상 구직급여를 확인할 수 있어요.",
    link: {
      label: "고용24 실업급여 모의계산",
      href: "https://www.work24.go.kr/cm/c/f/1100/selecSimulate.do?systClId=SC00000254&systCnntId=CI00002358&systId=SI00000411&upprSystClId=SC00000253",
    },
  },
  catchupCost: catchupLookup,
  catchupPension: catchupLookup,
};

const unknownAmount =
  /^(?:(?:아직|잘|정확히|정확하게|금액을|얼마인지)*모(?:름|르겠(?:어|어요|습니다|는데요)|르겠음|릅니다)|(?:아직|잘|정확히|금액을|얼마인지)*몰라(?:요|서요)?|(?:아직)?알수없(?:어요|습니다)|(?:아직)?확인(?:을)?못했(?:어요|습니다)|기억(?:이)?안(?:나요|납니다))$/;
const lookupRequest =
  /^(?:어디서확인(?:하나요|해요|할수있나요)|확인(?:하는)?(?:방법|사이트)(?:를)?알려(?:줘|주세요))$/;
const skipRequest =
  /^(?:건너뛰(?:기|어(?:요|줘|주세요)?|겠습니다|게요)|건너뛸게요?|패스(?:할게요)?)$/;
const isInputAction = (reply: string) =>
  unknownAmount.test(reply) ||
  lookupRequest.test(reply) ||
  skipRequest.test(reply);

const amountNames: [SkippableMoneyField, RegExp][] = [
  [
    "spousePension",
    /^(?:배우자|아내|남편)(?:의)?(?:예상)?(?:월)?(?:국민)?연금(?:액)?/,
  ],
  ["spouseIncome", /^(?:배우자|아내|남편)(?:의)?(?:세후)?(?:월급|월소득|급여)/],
  ["catchupCost", /^(?:배우자)?(?:연금)?추납비용/],
  ["catchupPension", /^(?:배우자)?추납후(?:월)?연금/],
  ["jobIncome", /^재취업(?:후)?(?:월급|소득)/],
  ["benefit", /^(?:월)?(?:구직급여|실업급여)(?:액)?/],
  ["pension", /^(?:본인|내)?(?:예상)?(?:월)?(?:국민)?연금(?:액|예상액)?/],
  ["income", /^(?:본인|내)?(?:세후)?(?:월급|월소득|급여)/],
  ["assets", /^(?:현재)?(?:금융자산|예금|투자금|모아둔돈)/],
  ["house", /^(?:현재)?(?:주택가격|집값)/],
  ["loan", /^(?:주택담보)?대출(?:잔액)?/],
  ["living", /^(?:한달|월)?생활비/],
  ["severance", /^(?:예상)?(?:세후)?퇴직금/],
];

export function resolveIntakeInputAction(
  question: string,
  h: Household,
  s: Solutions,
) {
  const text = question
    .trim()
    .replace(/[.!?。]+$/, "")
    .replace(/\s+/g, "");
  let reply = text;
  let target: keyof Household | undefined;
  const next = nextIntakeField(h, s);
  if (isInputAction(text)) {
    target = next;
  } else {
    for (const [field, name] of amountNames) {
      const match = name.exec(text);
      if (!match) continue;
      reply = text.slice(match[0].length).replace(/^(?:은|는|을|를|이|가)/, "");
      if (isInputAction(reply)) {
        target = field;
        break;
      }
    }
    if (!target) return null;
    if (!/^(?:본인|내)/.test(text)) {
      if (target === "pension" && next === "spousePension") target = next;
      if (target === "income" && next === "spouseIncome") target = next;
    }
  }
  const patch: Partial<Household> = {};
  const unknown = unknownAmount.test(reply);
  const lookup = target ? inputLookups[target] : undefined;
  const guidance = lookup
    ? lookup.description +
      (lookup.link ? `\n\n[${lookup.link.label}](${lookup.link.href})` : "")
    : "";
  if (
    !lookupRequest.test(reply) &&
    isSkippableMoneyField(target) &&
    !(
      h.hasSpouse === false &&
      (target.startsWith("spouse") || target.startsWith("catchup"))
    ) &&
    !Number.isFinite(h[target])
  ) {
    patch[target] = 0;
    return {
      patch,
      skipped: [target],
      notice: [
        `‘${inputLabels[target]}’은 일단 0원으로 두고 넘어갈게요. 나중에 실제 금액을 입력할 수 있어요.`,
        unknown ? guidance : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  if (guidance && (unknown || lookupRequest.test(reply)))
    return { patch, skipped: [], notice: guidance };
  return {
    patch,
    skipped: [],
    notice:
      target && !isSkippableMoneyField(target)
        ? "날짜, 배우자 여부, 대출 조건은 계산에 필요해요. 아래 질문에 답해 주세요."
        : "건너뛸 미입력 금액이 없어요. 이미 입력한 금액은 직접 입력 화면에서 바꿀 수 있어요.",
  };
}

export function optionalPlanHint(fields: (keyof Household)[]) {
  if (!fields.length) return "";
  const labels = fields.map((key) => inputLabels[key] || key).join(", ");
  return `선택 입력: ${labels}. 채팅에 알려주시면 반영할 수 있어요. 비워두면 0원·0개월 기준으로 바로 결과를 볼 수 있어요.`;
}
export const proposalSchema = z
  .object({ answer: z.string().min(1).max(2500), patch: draftSchema })
  .strict();

export class IntakeResponseError extends Error {
  readonly code = "invalid_ai_response";
  readonly name = "IntakeResponseError";
}

// Use a list so the strict schema only requires keys on entries the model emits.
export const intakeResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "household_intake_fields",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "patch"],
      properties: {
        answer: { type: "string" },
        patch: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["field", "value"],
            properties: {
              field: { type: "string", enum: Object.keys(draftSchema.shape) },
              value: {
                anyOf: [
                  { type: "number" },
                  { type: "string" },
                  { type: "boolean" },
                ],
              },
            },
          },
        },
      },
    },
  },
};

export function parseIntakeResponse(content: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new IntakeResponseError("AI 응답 형식이 올바르지 않습니다.");
  }
  const envelope = z
    .object({
      answer: z.string().trim().min(1).max(2500),
      patch: z
        .union([
          z.record(z.string(), z.unknown()),
          z
            .array(
              z.object({
                field: z.string(),
                value: z.union([z.number(), z.string(), z.boolean()]),
              }),
            )
            .max(Object.keys(draftSchema.shape).length),
        ])
        .nullish(),
    })
    .safeParse(raw);
  if (!envelope.success)
    throw new IntakeResponseError("AI 응답을 읽을 수 없습니다.");
  const patch: Partial<Household> = {};
  const invalid: string[] = [];
  const updates = envelope.data.patch;
  const entries = Array.isArray(updates)
    ? updates.map(({ field, value }) => [field, value] as const)
    : Object.entries(updates || {});
  const counts = new Map<string, number>();
  for (const [key] of entries) counts.set(key, (counts.get(key) || 0) + 1);
  for (const [key, value] of entries) {
    if (!Object.hasOwn(draftSchema.shape, key)) continue;
    // Unknown values are absent, never zero or an invented month.
    if (
      value === null ||
      value === undefined ||
      (typeof value === "string" && !value.trim())
    )
      continue;
    const field = key as keyof Household;
    const checked = draftSchema.shape[field].safeParse(value);
    if (checked.success && counts.get(key) === 1)
      Object.assign(patch, { [field]: checked.data });
    else invalid.push(inputLabels[field] || key);
  }
  const answer = invalid.length
    ? `${envelope.data.answer.slice(0, 2000)}\n\n다음 정보는 형식이나 범위를 확인해야 해서 반영하지 않았어요: ${[...new Set(invalid)].join(" · ")}. 날짜는 연도와 월(YYYY-MM), 금액은 만 원 단위로 알려주세요.`
    : envelope.data.answer;
  return {
    ...proposalSchema.parse({ answer, patch }),
    invalidFields: [...new Set(invalid)],
  };
}

const intakeQuestions: Partial<Record<keyof Household, string>> = {
  birth: "본인 출생연월은 언제인가요? (예: 1970-02)",
  retire: "은퇴 예정월은 언제인가요? (예: 2028-12)",
  hasSpouse: "함께 계산할 배우자가 있나요? (있어요 / 없어요)",
  income: "현재 세후 월급은 얼마인가요? (만 원)",
  assets: "예금과 투자금을 합친 금융자산은 얼마인가요? (만 원)",
  loan: "주택담보대출 잔액은 얼마인가요? 대출이 없으면 ‘대출 없음’이라고 답해 주세요.",
  living: "한 달 생활비는 얼마인가요? (만 원)",
  severance: "예상 세후 퇴직금은 얼마인가요? 없으면 0원이라고 답해 주세요.",
  pension: "정상 수령 시 예상 월 국민연금은 얼마인가요? (만 원)",
  spouseBirth: "배우자의 출생연월은 언제인가요? (예: 1972-03)",
  spouseIncome:
    "배우자의 세후 월급은 얼마인가요? 근로소득이 없으면 0원이라고 답해 주세요.",
  spouseEnd: "배우자의 근로 종료 예정월은 언제인가요? (예: 2029-12)",
  spousePension: "배우자의 예상 월 국민연금은 얼마인가요? (만 원)",
  loanRate: "대출 연금리는 몇 퍼센트인가요? (예: 3.5%)",
  loanMonths: "대출 상환 기간이 몇 개월 남았나요?",
};

export function intakeQuestion(field: keyof Household) {
  return (
    intakeQuestions[field] ??
    `다음으로 ${inputLabels[field] || field}을 알려주세요.`
  );
}

const intakeDateFields = [
  "retire",
  "birth",
  "spouseBirth",
  "spouseEnd",
] as const;

export function resolveIntakeDate(
  question: string,
  h: Household,
  s: Solutions,
  previousReply?: string,
) {
  const text = question.trim().replace(/[.!?。]+$/, "");
  const date = /^(\d{2}|\d{4})(?:\s*년\s*|[-./]|\s+)(\d{1,2})\s*월?$/.exec(
    text,
  );
  if (!date) return null;

  const { missing } = prepareScenario(h, s);
  const previousQuestion = intakeDateFields.find(
    (key) =>
      missing.includes(key) &&
      previousReply?.split("\n").includes(intakeQuestion(key)),
  );
  const field = previousQuestion ?? firstIntakeQuestionField(missing);
  if (
    field !== "retire" &&
    field !== "birth" &&
    field !== "spouseBirth" &&
    field !== "spouseEnd"
  )
    return null;

  const [, yearText, monthText] = date;
  const isBirth = field === "birth" || field === "spouseBirth";
  const startYear = Number(h.start.slice(0, 4));
  let year = Number(yearText);
  if (yearText.length === 2) {
    const reference = isBirth ? startYear : startYear + 49;
    year += Math.floor((reference - year) / 100) * 100;
  }
  const value = `${year}-${monthText.padStart(2, "0")}`;
  const valid =
    householdSchema.shape[field].safeParse(value).success &&
    (!isBirth || value < h.start);
  return { field, value: valid ? value : null };
}

export function intakeAnswer(
  h: Household,
  s: Solutions,
  patch: Partial<Household>,
  invalid: string[],
  hasPending: boolean,
) {
  const merged = mergeIntake(h, s, patch);
  const next = prepareScenario(merged.household, merged.solutions);
  const first = firstIntakeQuestionField(next.missing);
  const followUp = first
    ? intakeQuestion(first)
    : next.household
      ? hasPending
        ? "계산에 필요한 정보가 모였어요. ‘정보 반영하기 및 결과 보기’를 누르면 바로 결과를 볼 수 있어요."
        : "계산에 필요한 정보가 모였어요."
      : "입력한 날짜와 계산 기간을 확인해 주세요. 직접 입력 화면에서 수정할 수 있어요.";
  return [
    Object.keys(patch).length ? "알려주신 내용을 확인 카드에 정리했어요." : "",
    invalid.length
      ? `형식이나 범위를 확인할 항목은 제외했어요. ${invalid.join(" · ")}`
      : "",
    followUp,
    next.household ? optionalPlanHint(next.optionalMissing) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
