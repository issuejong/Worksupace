import type { Household } from "./household";
import { inputLookups } from "./input";

const topics = [
  {
    subject: /비상(?:자금|금|시\s*쓸\s*돈)/,
    answer:
      "비상자금은 예상치 못한 지출에 대비해 남겨두는 돈이에요. Afterfolio는 월 생활비와 대출 월 상환액을 기준으로 목표를 계산해요. 잔액이 0원보다 높아도 이 목표에는 미달할 수 있어요.",
  },
  {
    subject: /금융자산|금융\s*자산/,
    answer:
      "예금·적금·투자금처럼 생활비로 쓸 수 있는 금융자산이에요. 집값과 아직 받지 않은 퇴직금은 현재 금융자산에 넣지 않아요.",
  },
  {
    subject: /구매력|현재\s*가치|명목\s*(?:금액|잔액)/,
    answer:
      "현재가치는 미래의 금액을 분석 시작 연도의 돈으로 환산한 값이에요. 명목금액은 물가를 환산하기 전, 해당 연도에 표시되는 금액이에요.",
  },
  {
    subject: /추납|추후\s*납부/,
    answer:
      "추납은 국민연금 보험료를 내지 못한 기간 중 추납이 가능한 기간에 대해 나중에 납부하는 제도예요. 본인의 가능 여부와 금액은 국민연금공단에서 확인해 주세요.",
  },
] as const;

const lookupTopics: [RegExp, keyof Household][] = [
  [/추납|추후\s*납부/, "catchupCost"],
  [/구직급여|실업급여/, "benefit"],
  [/국민연금|연금\s*(?:예상|수령액)|예상\s*연금/, "pension"],
  [/금융\s*자산|예금|적금|투자금/, "assets"],
  [/퇴직금/, "severance"],
  [/주택가격|집값|실거래가/, "house"],
  [/주택담보대출|대출\s*(?:잔액|금리|기간)/, "loan"],
];

export function retirementHelp(question: string): string | undefined {
  const text = question.trim();
  if (
    /(?:바꾸면|없으면|안\s*하면|했을\s*때|최적|가장\s*많|왜.*부족|계산\s*해\s*(?:줘|주세요))/.test(
      text,
    )
  )
    return;

  if (
    /그래프|차트|비교표/.test(text) &&
    /읽|해석|보는\s*법|어떻게\s*봐|무슨\s*뜻|점선|실선/.test(text)
  ) {
    return "결과 그래프의 점선은 계획 적용 전, 실선은 적용 후예요. 같은 연도의 높이를 비교하면 준비 방법이 잔액에 미치는 영향을 볼 수 있어요. 0원 아래는 충당하지 못한 생활자금이고, 비상자금 기준선은 따로 표시돼요.";
  }

  if (
    /직접\s*입력|건너뛰기|저장한\s*(?:결과|입력)|이용\s*안내|사용법/.test(
      text,
    ) &&
    /어디|어떻게|뭐|방법|사용법|이용\s*안내/.test(text)
  ) {
    return "상담 화면에서 ‘직접 입력하기’를 누르면 가구 정보 입력 화면으로 이동해요. 모르는 금액은 건너뛰면 0원으로 계산하고, 나중에 실제 금액으로 바꿀 수 있어요. 같은 브라우저에서 저장한 입력이나 결과는 메인에서 이어 볼 수 있어요.\n\n[Afterfolio 이용안내](/guide)";
  }

  if (
    /어디|조회|확인\s*(?:방법|하는\s*법)|자격|신청\s*(?:조건|대상)|받을\s*수\s*있|실제.*얼마/.test(
      text,
    )
  ) {
    const field = lookupTopics.find(([subject]) => subject.test(text))?.[1];
    const lookup = field ? inputLookups[field] : undefined;
    if (lookup) {
      const qualification = /자격|신청\s*(?:조건|대상)|받을\s*수\s*있/.test(
        text,
      );
      return [
        qualification ? "개인별 수급 여부는 관할 기관에서 확인해 주세요." : "",
        lookup.description,
        lookup.link ? `[${lookup.link.label}](${lookup.link.href})` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  if (
    /뭐(?:야|예요|에요|지|임|냐)?|무엇|무슨\s*뜻|의미|정의|설명\s*해/.test(text)
  ) {
    return topics.find(({ subject }) => subject.test(text))?.answer;
  }
}
