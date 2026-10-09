import { describe, expect, it } from "vitest";
import { gameDay, questFor, questsFor, secondsToReset } from "./quests";

describe("daily quests (mirror of the program)", () => {
  it("numbers days from 1 in UTC", () => {
    expect(gameDay(0)).toBe(1);
    expect(gameDay(86_399)).toBe(1);
    expect(gameDay(86_400)).toBe(2);
    expect(gameDay(-5)).toBe(1);
  });

  it("matches the program for known days", () => {
    const row = (day: number) => questsFor(day).map((q) => [q.kind, q.target, q.reward]);
    expect(row(1)).toEqual([[1, 3, 10], [0, 5, 15], [3, 1, 5]]);
    expect(row(100)).toEqual([[0, 5, 15], [4, 3, 20], [1, 3, 10]]);
  });

  it("always offers three different quests", () => {
    for (let day = 1; day < 500; day++) {
      const keys = questsFor(day).map((q) => `${q.kind}-${q.target}`);
      expect(new Set(keys).size).toBe(3);
    }
    expect(questFor(5, 1).slot).toBe(1);
  });

  it("counts down to the next UTC day", () => {
    expect(secondsToReset(86_400 * 3)).toBe(86_400);
    expect(secondsToReset(86_400 * 3 + 86_399)).toBe(1);
  });
});
