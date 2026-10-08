import { expect, it } from "vitest";
import { EvolutionClock, TIMELINE } from "./evolution-fx";

const run = (clock: EvolutionClock, seconds: number, settled: boolean) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) clock.advance(1 / 60, settled);
};

it("holds on the helix while the transaction is pending, but keeps spinning", () => {
  const clock = new EvolutionClock();
  run(clock, TIMELINE.hold + 0.5, false);
  expect(clock.time).toBeCloseTo(TIMELINE.hold, 5);
  expect(clock.waiting).toBe(true);
  const spin = clock.spin;
  run(clock, 1, false);
  expect(clock.time).toBeCloseTo(TIMELINE.hold, 5);
  expect(clock.spin).toBeGreaterThan(spin);
});

it("plays the flash once the transaction settles", () => {
  const clock = new EvolutionClock();
  run(clock, TIMELINE.hold + 0.2, false);
  run(clock, 1, true);
  expect(clock.flashed).toBe(true);
  expect(clock.time).toBeGreaterThan(TIMELINE.flash);
  expect(clock.waiting).toBe(false);
});

it("does not stall when the transaction settles before the helix", () => {
  const clock = new EvolutionClock();
  run(clock, TIMELINE.settle + 0.5, true);
  expect(clock.time).toBeGreaterThan(TIMELINE.settle);
});

it("waits at the limit while the scene is still being built, then carries on", () => {
  const clock = new EvolutionClock();
  const limit = TIMELINE.dissolve - 0.01;
  for (let i = 0; i < 180; i++) clock.advance(1 / 60, true, limit);
  expect(clock.time).toBeCloseTo(limit, 5);
  run(clock, 0.5, true);
  expect(clock.time).toBeGreaterThan(TIMELINE.dissolve);
});
