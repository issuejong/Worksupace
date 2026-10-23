import { describe, expect, it } from "vitest";
import { normalizeTyping, rankTyping, typingResult, type TypingProgress } from "../lib/typing";

describe("typing rules", () => {
  it("normalizes Korean Unicode and edge spaces without accepting different punctuation or internal spaces", () => {
    expect(normalizeTyping("  동국대! ".normalize("NFD"))).toBe("동국대!");
    expect(normalizeTyping("동 국대!")).not.toBe(normalizeTyping("동국대!"));
    expect(normalizeTyping("UMC")).not.toBe(normalizeTyping("umc"));
  });
  it("adds one second per wrong submission, using hundredths consistently", () => {
    expect(typingResult(42300, 3)).toBe(45300);
    expect(typingResult(43200, 0)).toBe(43200);
    expect(typingResult(1234, 2)).toBe(3230);
  });
  it("ranks adjusted records with shared ties and unfinished teams last", () => {
    const team = (teamId: string, resultMs: number | null): TypingProgress => ({ teamId, resultMs, ready: true, completed: resultMs !== null, turn: 1, mistakes: 0, version: 1, completedAt: resultMs === null ? null : new Date().toISOString(), elapsedMs: resultMs });
    expect(rankTyping([team("A",45300),team("B",43200),team("C",43200),team("D",null)]).map(value => [value.teamId,value.rank])).toEqual([["B",1],["C",1],["A",3],["D",null]]);
  });
});
