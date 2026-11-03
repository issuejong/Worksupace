import OpenAI from "openai";
import { z } from "zod";
import { Config, configSchema, modelVersion } from "../finance";
import { runTool, toolSchemas, agentVersion, Analysis } from "./tools";
const descriptions: Record<string, string> = {
  get_current_scenario: "현재 조건과 계산 결과 조회. 기본안은 변경하지 않는다.",
  simulate_scenario:
    "변경한 가상 조건과 현재 조건을 비교. 분석만 수행하며 적용하지 않는다.",
  compare_scenarios: "이름 붙인 여러 변경안을 같은 현재 조건에서 비교한다.",
  search_scenarios:
    "제한된 후보 전체를 계산해 금융자산 최대안을 찾는다. 목표 endAssets=2060년 말 명목금융자산, minAssets=기간 중 최저 2026년 구매력. benefits와 재취업은 현재 가정 고정. 재취업 비교가 요청된 경우에만 includeJobChoices=true. 사용자 고정 조건은 locks에 지정. 생활비·수익률은 탐색하지 않는다. 순자산 최적화 불가.",
  find_spending_limit:
    "자산이 부족하지 않거나 비상자금을 유지하는 생활비 한도 탐색. 다른 조건은 고정.",
  stress_test:
    "현재 조건, 재취업 지연·실패, 생활비 증가, 의료비 추가를 비교한다.",
  apply_scenario_changes:
    "사용자가 지금 조건을 바꿔 달라고 명시적으로 요청한 경우에만 조건을 변경한다. 비교·탐색만 요청한 경우에는 금지.",
};
const schemas = {
  ...toolSchemas,
  apply_scenario_changes: toolSchemas.simulate_scenario,
};
export async function runAgent(
  client: OpenAI,
  model: string,
  question: string,
  config: Config,
  history: { role: "user" | "assistant"; content: string }[],
  signal: AbortSignal,
  previousCandidates: { name: string; config: Config }[] = [],
) {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = Object.entries(
    schemas,
  ).map(([name, schema]) => {
    const { $schema, ...parameters } = z.toJSONSchema(schema, { io: "input" });
    void $schema;
    return {
      type: "function",
      function: { name, description: descriptions[name], parameters },
    };
  });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `한국어 은퇴 시뮬레이션 에이전트. 현재 조건 ${JSON.stringify(config)}. 이전 분석 후보 조건 ${JSON.stringify(previousCandidates)}. 이전 후보를 지칭하는 후속 질문이면 그 조건을 사용하되 숫자는 다시 계산한다. 모든 금액은 만원, 비율은 소수, 기간은 2026-11~2060-12. 현재 조건이 대화보다 우선한다. benefits는 구직급여이며 국민연금이 아니다. 계산 숫자는 반드시 도구로 확인한다. 최댓값·최적 질문은 search_scenarios, 생활비 한도는 find_spending_limit을 반드시 실행한다. 최대 자산의 기본 목표는 endAssets라고 밝힌다. 최저 잔고 목표는 minAssets를 쓴다. 제약조건과 자금 부족 허용 여부를 지킨다. 수급 여부는 고정 가정이며 실제 자격을 판단하지 않는다. 구직급여 수급 가능/불가가 불명확하고 변경이 필요한 질문이면 확인 질문한다. 미래 수익률을 유리하게 조정하지 않는다. 요청 범위가 불명확하면 묻는다. 모든 도구는 독립적인 현재 조건을 기준으로 실행되므로 연속 비교에 필요한 변경을 모두 전달한다. 분석·비교·탐색은 현재 설정을 변경하지 않는다. 명시적으로 바꿔달라는 요청만 apply_scenario_changes를 쓴다. 검색 결과는 제한된 후보 중 최상위일 뿐 전역 최적·순자산 최대가 아니다. 주택연금은 대출이고 채무·상속은 미계산. 구직급여·재취업·추납·주택연금 실제 자격, 월액·세금·건보 산식은 추가 확인이 필요한 부분 검증 모델이다. 제도 질문은 확인된 정보가 없으면 필요한 정보와 공식 확인 필요성을 설명한다. 실시간 조회를 했다고 주장하지 않는다. 과거 답변을 검증된 계산으로 쓰지 않는다. passes는 비상자금 기준 충족 여부이며 파산·자산 소진 여부가 아니다. firstNegative가 null이면 자산 부족·파산·고갈이 발생했다고 말하지 않는다. minAssets가 0 이상이고 reserve 미만인 경우 비상자금 기준 미달이라고만 표현한다. 짧은 결론, 가정, 주요 지표 순으로 설명한다. 도구 오류는 수정하거나 사용자에게 필요한 정보를 질문한다. 최대 3회 도구 요청 라운드 후 최종 답변한다.`,
    },
    ...history,
    { role: "user", content: question },
  ];
  const analyses: (Analysis & { id: string })[] = [];
  const trace: {
    tool: string;
    args: unknown;
    status: string;
    error?: string;
  }[] = [];
  let next = config;
  let calls = 0;
  for (let round = 0; round < 4; round++) {
    let response;
    try {
      response = await client.chat.completions.create(
        {
          model,
          messages: [...messages],
          tools,
          tool_choice: round === 3 || calls >= 6 ? "none" : "auto",
          max_tokens: 2400,
        },
        { signal },
      );
    } catch (error) {
      if (!analyses.length) throw error;
      return {
        answer:
          "추가 AI 설명을 완료하지 못했습니다. 아래는 실행을 마친 계산 결과입니다. 전체 분석 완료나 전역 최적을 의미하지 않습니다. 현재 설정은 유지했습니다.",
        config,
        analyses,
        trace,
        model,
        modelVersion,
        agentVersion,
        incomplete: true,
        date: new Date().toISOString(),
      };
    }
    const msg = response.choices[0]?.message;
    if (!msg) throw new Error("AI 응답 없음");
    messages.push(msg);
    if (!msg.tool_calls?.length) {
      let answer =
        msg.content?.trim() || "질문을 조금 더 구체적으로 입력해 주세요.";
      if (
        /(최대|최적|가장.{0,12}(많|높|좋))/.test(question) &&
        !analyses.some((a) => a.kind === "search" || a.kind === "spending")
      )
        answer =
          "최적안을 확인하는 탐색이 완료되지 않았습니다. 기말 금융자산 최대인지, 기간 중 최저 자산 최대인지와 고정할 조건을 알려주세요.";
      const computed = analyses.flatMap((a) => a.candidates);
      if (
        computed.length &&
        computed.every((c) => c.metrics.firstNegative === null) &&
        /(파산|고갈|자금 부족.{0,15}발생)/.test(answer)
      ) {
        answer =
          "계산한 모든 안에서 금융자산이 음수가 되는 달은 없습니다. 비상자금 기준 미달은 자산 소진과 다릅니다.\n\n" +
          computed
            .map(
              (c) =>
                `${c.name}: 기말 ${Math.round(c.metrics.endAssets).toLocaleString("ko-KR")}만 원, 최저 ${Math.round(c.metrics.minAssets).toLocaleString("ko-KR")}만 원, 비상자금 ${c.metrics.passes ? "충족" : "미달"}`,
            )
            .join("\n");
      }
      return {
        answer,
        config: next,
        analyses,
        trace,
        model,
        modelVersion,
        agentVersion,
        date: new Date().toISOString(),
      };
    }
    for (const call of msg.tool_calls) {
      let output: unknown;
      let args: unknown;
      try {
        if (++calls > 6) throw new Error("도구 호출 한도에 도달했습니다.");
        if (call.type !== "function")
          throw new Error("허용되지 않은 도구 유형");
        args = JSON.parse(call.function.arguments);
        const applying = call.function.name === "apply_scenario_changes";
        if (
          applying &&
          !/(바꿔|변경해|적용|설정해|낮춰|높여|올려|줄여)/.test(question)
        )
          throw new Error(
            "분석 요청은 자동 적용할 수 없습니다. 변경안만 제시하세요.",
          );
        const analysis = runTool(
          applying ? "simulate_scenario" : call.function.name,
          args,
          config,
        );
        const entry = { ...analysis, id: `analysis-${analyses.length + 1}` };
        analyses.push(entry);
        output = entry;
        if (applying)
          next = configSchema.parse(analysis.candidates.at(-1)!.config);
        trace.push({ tool: call.function.name, args, status: "success" });
      } catch (e) {
        const error =
          e instanceof z.ZodError
            ? "도구 인자가 허용 범위를 벗어났습니다. 스키마와 사용자 조건을 확인하세요."
            : e instanceof Error
              ? e.message
              : "도구 오류";
        output = { error };
        trace.push({
          tool: call.type === "function" ? call.function.name : "unknown",
          args,
          status: "error",
          error,
        });
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }
  throw new Error("분석 완료 한도 초과");
}
