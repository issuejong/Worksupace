import OpenAI from "openai";
import { z } from "zod";
import { configSchema, simulate, modelVersion } from "../../../lib/finance";
export const runtime = "nodejs";
export const maxDuration = 60;
const requests = new Map<string, { time: number; count: number }>();
const inputSchema = z.object({
  question: z.string().min(1).max(1500),
  config: configSchema,
});
export async function POST(request: Request) {
  const gemini = Boolean(process.env.GEMINI_API_KEY);
  const model = gemini ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL;
  if (
    !model ||
    !(gemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)
  )
    return Response.json(
      {
        error:
          "서버에 GEMINI_API_KEY와 GEMINI_MODEL 또는 OpenAI 환경변수를 설정해 주세요.",
      },
      { status: 503 },
    );
  if (
    process.env.AI_ACCESS_TOKEN &&
    request.headers.get("authorization") !==
      `Bearer ${process.env.AI_ACCESS_TOKEN}`
  )
    return Response.json(
      { error: "AI 접근 토큰을 확인해 주세요." },
      { status: 401 },
    );
  const key = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now();
  const entry = requests.get(key);
  if (requests.size > 1000) requests.clear();
  if (entry && now - entry.time < 60000 && entry.count >= 8)
    return Response.json(
      { error: "잠시 후 다시 질문해 주세요." },
      { status: 429 },
    );
  requests.set(
    key,
    entry && now - entry.time < 60000
      ? { time: entry.time, count: entry.count + 1 }
      : { time: now, count: 1 },
  );
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "질문 또는 조건이 올바르지 않습니다." },
        { status: 400 },
      );
    const { question, config } = parsed.data;
    const current = simulate(config);
    const currentSummary = JSON.stringify({
      firstNegative: current.firstNegative,
      minAssets: current.minAssets,
      endAssets: current.endAssets,
      reserve: current.reserve,
    });
    const client = new OpenAI({
      apiKey: gemini ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY,
      ...(gemini
        ? {
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
          }
        : {}),
      timeout: 45000,
      maxRetries: 0,
    });
    const properties = {
      job: { type: ["boolean", "null"] },
      jobDelay: { type: ["integer", "null"] },
      living: { type: ["number", "null"] },
      inflation: { type: ["number", "null"] },
      returns: { type: ["number", "null"] },
      repay: { type: ["boolean", "null"] },
      catchup: { type: ["boolean", "null"] },
      home: { type: ["boolean", "null"] },
      homeYear: { type: ["integer", "null"] },
      homePayment: { type: ["number", "null"] },
      shock: { type: ["number", "null"] },
      shockYear: { type: ["integer", "null"] },
    };
    const instructions = `한국어 은퇴자금 시뮬레이터 보조자. 모든 금액 단위는 만원, 비율은 소수, 재취업 지연은 개월이다. 현재 조건 ${JSON.stringify(config)}. 조건 변경 질문은 simulate_scenario를 호출한다. 시점이나 금액이 불명확하면 되묻는다. 도구 결과 밖의 숫자나 법규를 만들어내지 않는다. 기본 설정과 기간을 명시하고 미래 결과를 보장하지 않는다. 국민연금은 과거 B값 비중과 추납 계수만 부분 수정했고 세금·건보·주택연금 보간 등 추가 확인이 필요하다. 주택연금은 대출이므로 금융자산 증가를 순자산 증가나 상속액으로 설명하지 않는다. 근거는 https://www.nps.or.kr/pbcpgdnc/mainbiz/getOHAG0058M0.do 및 https://hf.go.kr/ko/sub03/sub03_01_01_02.do 에 한한다. 실제 지급액을 보장하지 않는다.`;
    const tools: OpenAI.Responses.Tool[] = [
      {
        type: "function",
        name: "simulate_scenario",
        description:
          "허용된 조건을 변경해 기존 안과 비교한다. 바꾸지 않을 값은 null.",
        strict: true,
        parameters: {
          type: "object",
          properties,
          required: Object.keys(properties),
          additionalProperties: false,
        },
      },
    ];
    const context = instructions + ` 현재 계산 결과(만원): ${currentSummary}`;
    if (gemini) {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: context },
        { role: "user", content: question },
      ];
      const first = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 3000,
        tools: [
          {
            type: "function",
            function: {
              name: "simulate_scenario",
              description:
                "변경할 조건만 지정해 계산한다. 변경하지 않는 조건은 생략한다.",
              parameters: {
                type: "object",
                properties: Object.fromEntries(
                  Object.entries(properties).map(([key, value]) => [
                    key,
                    { type: value.type[0] },
                  ]),
                ),
                additionalProperties: false,
              },
            },
          },
        ],
      });
      const message = first.choices[0]?.message;
      if (!message) throw new Error("Empty AI response");
      let next = config;
      let comparison = null;
      let answer = message.content;
      if (message.tool_calls?.length) {
        if (message.tool_calls.length !== 1)
          throw new Error("Unexpected tool count");
        const call = message.tool_calls[0];
        if (
          call.type !== "function" ||
          call.function.name !== "simulate_scenario"
        )
          throw new Error("Unknown tool");
        const raw = JSON.parse(call.function.arguments);
        const allowed = z
          .object({
            job: z.boolean().optional(),
            jobDelay: z.number().int().optional(),
            living: z.number().optional(),
            inflation: z.number().optional(),
            returns: z.number().optional(),
            repay: z.boolean().optional(),
            catchup: z.boolean().optional(),
            home: z.boolean().optional(),
            homeYear: z.number().int().optional(),
            homePayment: z.number().optional(),
            shock: z.number().optional(),
            shockYear: z.number().int().optional(),
          })
          .strict();
        const changes = allowed.parse(raw);
        next = configSchema.parse({ ...config, ...changes });
        const summary = (c: typeof config) => {
          const r = simulate(c);
          return {
            firstNegative: r.firstNegative,
            minAssets: r.minAssets,
            endAssets: r.endAssets,
            reserve: r.reserve,
            passes: r.passes,
          };
        };
        comparison = { before: summary(config), after: summary(next), changes };
        const second = await client.chat.completions.create({
          model,
          max_tokens: 3000,
          messages: [
            ...messages,
            message,
            {
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(comparison),
            },
          ],
        });
        answer = second.choices[0]?.message.content ?? null;
      }
      if (!answer?.trim()) throw new Error("Empty AI answer");
      return Response.json({
        answer,
        config: next,
        comparison,
        model,
        modelVersion,
        date: new Date().toISOString(),
      });
    }
    const first = await client.responses.create({
      model,
      instructions: context,
      input: question,
      tools,
      parallel_tool_calls: false,
      max_output_tokens: 1200,
      store: false,
    });
    const call = first.output.find((x) => x.type === "function_call");
    let next = config,
      comparison = null,
      answer = first.output_text;
    if (call && call.type === "function_call") {
      const raw = JSON.parse(call.arguments);
      const changes = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== null),
      );
      next = configSchema.parse({ ...config, ...changes });
      const summary = (c: typeof config) => {
        const r = simulate(c);
        return {
          firstNegative: r.firstNegative,
          minAssets: r.minAssets,
          endAssets: r.endAssets,
          reserve: r.reserve,
          passes: r.passes,
        };
      };
      comparison = { before: summary(config), after: summary(next), changes };
      const second = await client.responses.create({
        model,
        instructions: context,
        input: [
          { role: "user", content: question },
          ...first.output.filter(
            (x) => x.type === "function_call" || x.type === "reasoning",
          ),
          {
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(comparison),
          },
        ],
        max_output_tokens: 1600,
        store: false,
      });
      answer = second.output_text;
    }
    return Response.json({
      answer,
      config: next,
      comparison,
      model,
      modelVersion,
      date: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 429)
      return Response.json(
        {
          error:
            "AI 무료 사용량 또는 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 429 },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error:
            "AI가 제안한 변경값이 허용 범위를 벗어났습니다. 조건을 구체적으로 입력해 주세요.",
        },
        { status: 422 },
      );
    return Response.json(
      {
        error:
          "AI 요청을 완료하지 못했습니다. 설정과 연결을 확인하고 다시 시도해 주세요.",
      },
      { status: 502 },
    );
  }
}
