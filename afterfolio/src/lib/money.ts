/** Engine amounts are in ten-thousand won. Round only at the display boundary. */
export function money(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const won = Math.round(amount * 10_000);
  return `${Object.is(won, -0) ? "0" : won.toLocaleString("ko-KR")}원`;
}

/** Compact chart labels; tooltips retain whole-won detail. */
export function moneyAxis(amount: number): string {
  const won = amount * 10_000;
  if (Math.abs(won) >= 100_000_000)
    return `${Number((won / 100_000_000).toFixed(1))}억`;
  return `${Math.round(amount).toLocaleString("ko-KR")}만`;
}
