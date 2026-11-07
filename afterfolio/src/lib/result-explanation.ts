import { money } from "./money";
import { calculate, none, type Household, type Solutions } from "./household";

const monthText = (month: string | null) => {
  if (!month) return "부족 없음";
  const [year, number] = month.split("-");
  return `${year}년 ${Number(number)}월`;
};

const balanceText = (amount: number) =>
  amount < 0 ? `${money(-amount)} 부족` : money(amount);

export function retirementExplanation(
  household: Household,
  solutions: Solutions,
) {
  const before = calculate(household, none, false);
  const after = calculate(household, solutions);
  const year = household.start.slice(0, 4);
  const facts = [
    "| 비교 항목 | 계획 적용 전 | 계획 적용 후 |",
    "| --- | --- | --- |",
    `| 돈이 처음 부족한 때 | ${monthText(before.firstNegative)} | ${monthText(after.firstNegative)} |`,
    `| 가장 적게 남는 돈 (${year}년 돈의 가치) | ${balanceText(before.minAssets)} | ${balanceText(after.minAssets)} |`,
    `| ${household.endYear}년 말 예상 잔액 (해당 연도 통장에 표시될 금액) | ${balanceText(before.endAssets)} | ${balanceText(after.endAssets)} |`,
  ].join("\n");
  const takeaways = {
    shortfall: after.firstNegative
      ? `현재 계획에서도 ${monthText(after.firstNegative)}부터 생활자금이 부족해져요.`
      : `현재 계획에서는 ${household.endYear}년까지 생활자금이 부족해지는 달이 없어요.`,
    reserve: after.passes
      ? "현재 계획에서 가장 적게 남는 달에도 비상자금 목표를 충족해요."
      : "현재 계획에서 가장 적게 남는 달에는 비상자금 목표에 미치지 못해요.",
    balance:
      after.endAssets > before.endAssets
        ? "계획을 적용하면 분석 마지막 해의 예상 잔액이 늘어요."
        : after.endAssets < before.endAssets
          ? "계획을 적용하면 분석 마지막 해의 예상 잔액이 줄어요."
          : "계획을 적용해도 분석 마지막 해의 예상 잔액은 같아요.",
  };
  return { facts, takeaways };
}
