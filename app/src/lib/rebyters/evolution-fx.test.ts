import { expect, it } from "vitest";
import {
  EvolutionClock,
  mulberry,
  pairByHeight,
  parseHex,
  TIMELINE,
  type Sample,
} from "./evolution-fx";

const FRAME = 1 / 60;
const sample = (y: number): Sample => ({ x: 0, y, r: 0, g: 0, b: 0 });

it("reads hex colours from the UI tokens", () => {
  expect(parseHex("#8fe6ff")).toEqual([143, 230, 255]);
  expect(parseHex(" #fff ")).toEqual([255, 255, 255]);
  expect(parseHex("rgba(0,0,0,.5)")).toBeNull();
  expect(parseHex("")).toBeNull();
});

it("pairs bytes top to top and bottom to bottom even when the forms differ in size", () => {
  const from = [0, 10, 20].map(sample);
  const to = [100, 110, 120, 130].map(sample);
  const pairs = pairByHeight(from, to, mulberry(1), 0);
  expect(pairs).toHaveLength(4);
  expect(pairs[0][0].y).toBe(0);
  expect(pairs[0][1].y).toBe(100);
  expect(pairs.at(-1)?.[0].y).toBe(20);
  expect(pairs.at(-1)?.[1].y).toBe(130);
  const toY = pairs.map(([, b]) => b.y);
  expect(toY).toEqual([...toY].sort((a, b) => a - b));
  expect(pairByHeight([], to, mulberry(1), 0)).toEqual([]);
});

it("holds the helix while the transaction is pending and keeps it spinning", () => {
  const clock = new EvolutionClock();
  for (let i = 0; i < 600; i++) clock.advance(FRAME, false);
  expect(clock.time).toBe(TIMELINE.hold);
  expect(clock.waiting).toBe(true);
  const spin = clock.helixSpin;
  for (let i = 0; i < 60; i++) clock.advance(FRAME, false);
  expect(clock.time).toBe(TIMELINE.hold);
  expect(clock.helixSpin).toBeGreaterThan(spin);
});

it("plays the finale once the transaction settles, with a hit-stop on the flash", () => {
  const clock = new EvolutionClock();
  for (let i = 0; i < 300; i++) clock.advance(FRAME, false);
  let onFlash = 0;
  for (let i = 0; i < 600 && clock.time < TIMELINE.reveal + 0.5; i++) {
    clock.advance(FRAME, true);
    expect(clock.waiting).toBe(false);
    if (clock.time === TIMELINE.flash) onFlash++;
  }
  expect(clock.time).toBeGreaterThan(TIMELINE.reveal);
  expect(onFlash * FRAME).toBeGreaterThanOrEqual(TIMELINE.hit - FRAME);
});

it("does not run ahead of a slow transaction, but does not wait for a fast one", () => {
  const fast = new EvolutionClock();
  for (let i = 0; i < 20; i++) fast.advance(FRAME, true);
  expect(fast.time).toBeCloseTo(20 * FRAME, 5);
  expect(fast.waiting).toBe(false);
});

it("skips to the finished form only after the transaction has settled", () => {
  const clock = new EvolutionClock();
  clock.advance(0.5, false);
  clock.skip(false);
  expect(clock.time).toBeCloseTo(0.5, 5);
  clock.skip(true);
  expect(clock.time).toBe(TIMELINE.skipTo);
});

it("reduced motion waits for the chain and then only cross-fades", () => {
  const clock = new EvolutionClock(true);
  for (let i = 0; i < 120; i++) clock.advance(FRAME, false);
  expect(clock.time).toBe(0);
  expect(clock.waiting).toBe(true);
  clock.advance(1, true);
  expect(clock.time).toBe(1);
  expect(clock.waiting).toBe(false);
});
