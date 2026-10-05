import { describe, expect, it } from "vitest";
import { nightBlend } from "./twilight";
import { periodAt } from "../../hooks/useWorldClock";
const utc = (hour: number, minute = 0) => Date.UTC(2026, 9, 5, hour, minute);
describe("UTC visual twilight", () => {
  it("keeps gameplay Evening at 22:12 while approaching the night palette", () => {
    const now = utc(22, 12);
    expect(periodAt(now)).toBe("Evening");
    expect(nightBlend("Evening", now)).toBeGreaterThan(0.85);
    expect(nightBlend("Evening", now)).toBeLessThan(1);
  });
  it("darkens continuously and reaches night before midnight without changing rules", () => {
    const samples = [19, 20, 21, 22, 23].map((h) =>
      nightBlend("Evening", utc(h)),
    );
    expect(samples[0]).toBe(0);
    expect(samples[4]).toBe(1);
    for (let i = 1; i < samples.length; i++)
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    expect(nightBlend("Night", utc(0))).toBe(1);
    expect(nightBlend("Day", utc(14))).toBe(0);
    expect(nightBlend("Morning", utc(7))).toBe(0);
  });
});
