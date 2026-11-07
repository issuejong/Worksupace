import { expect, it } from "vitest";
import { blankHousehold } from "../src/lib/input";
import { none } from "../src/lib/household";
import { readPlannerSession } from "../src/lib/planner-session";

it("restores an unfinished chat with its pending card and preserves zero and false", () => {
  // The order can differ when the household is loaded from another source.
  const h = { hasSpouse: false, ...blankHousehold(), loan: 0 };
  const snapshot = JSON.stringify({ h, s: none });
  const restored = readPlannerSession(
    JSON.stringify({
      household: h,
      solutions: none,
      origins: { loan: "manual" },
      question: "아직 전송하지 않은 답",
      tab: "result",
      ai: true,
      revision: 3,
      snapshot,
      messages: [
        {
          question: "가상 출생월",
          snapshot,
          revision: 3,
          reply: {
            answer: "은퇴 예정월은 언제인가요?",
            candidates: [],
            tools: ["collect"],
            searched: 0,
            intake: { patch: { birth: "1971-05" } },
          },
        },
      ],
    }),
  );
  expect(restored.household).toMatchObject({
    hasSpouse: false,
    loan: 0,
    living: NaN,
  });
  expect(restored.question).toBe("아직 전송하지 않은 답");
  expect(restored.messages[0]).toMatchObject({
    snapshot: JSON.stringify({ h: restored.household, s: restored.solutions }),
    revision: 3,
    reply: { intake: { patch: { birth: "1971-05" } } },
  });
});

it("loads saved plans from before the housing-pension month field", () => {
  const solutions = { ...none } as Record<string, unknown>;
  delete solutions.homeMonth;
  const household = blankHousehold();
  const restored = readPlannerSession(
    JSON.stringify({
      household,
      solutions,
      origins: {},
      messages: [],
      question: "",
      tab: "result",
      ai: false,
      revision: 0,
      snapshot: JSON.stringify({ h: household, s: solutions }),
    }),
  );
  expect(restored.solutions.homeMonth).toBe(2);
});
