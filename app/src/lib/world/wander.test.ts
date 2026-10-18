import { describe, expect, it } from "vitest";
import { createWalker, fits, stepWalker, tileTaken, walkerPosition } from "./wander";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("wander", () => {
  const inside = (i: number, j: number) => i >= 0 && i < 5 && j >= 0 && j < 5 && !(i === 2 && j === 2);

  it("stays on tiles it can stand on and never shares a tile", () => {
    const rand = seeded(7);
    const walkers = [createWalker("a", 0, 0, rand), createWalker("b", 4, 4, rand), createWalker("c", 0, 4, rand)];
    for (let n = 0; n < 6000; n++) {
      for (const w of walkers) stepWalker(w, walkers, 0.05, { canStand: inside, rand });
      for (const w of walkers) {
        expect(inside(w.i, w.j)).toBe(true);
        expect(inside(w.ti, w.tj)).toBe(true);
      }
      const spots = walkers.map((w) => `${w.ti},${w.tj}`);
      expect(new Set(spots).size).toBe(walkers.length);
    }
  });

  it("actually moves around", () => {
    const rand = seeded(3);
    const w = createWalker("a", 0, 0, rand);
    const seen = new Set<string>();
    for (let n = 0; n < 4000; n++) {
      stepWalker(w, [w], 0.05, { canStand: inside, rand });
      seen.add(`${w.i},${w.j}`);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("interpolates between tiles", () => {
    const w = createWalker("a", 1, 1);
    Object.assign(w, { ti: 2, tj: 1, t: 0.5, walking: true });
    const p = walkerPosition(w);
    expect(p.x).toBeCloseTo(1.5);
    expect(p.z).toBeCloseTo(1);
  });

  it("reserves the tile it is walking to", () => {
    const w = createWalker("a", 1, 1);
    Object.assign(w, { ti: 2, tj: 1, walking: true });
    expect(tileTaken([w], 2, 1)).toBe(true);
    expect(tileTaken([w], 2, 1, "a")).toBe(false);
  });

  it("waits in place when boxed in", () => {
    const rand = seeded(1);
    const w = createWalker("a", 0, 0, rand);
    for (let n = 0; n < 200; n++) stepWalker(w, [w], 0.1, { canStand: () => false, rand });
    expect([w.i, w.j]).toEqual([0, 0]);
  });

  it("a 2×2 rebyter covers four tiles and never overlaps anyone", () => {
    const rand = seeded(11);
    const open = (i: number, j: number) => i >= 0 && i < 6 && j >= 0 && j < 6;
    const big = createWalker("big", 0, 0, rand, 2, 2);
    const walkers = [big, createWalker("a", 5, 5, rand), createWalker("b", 0, 5, rand)];
    expect(tileTaken(walkers, 1, 1)).toBe(true);
    expect(walkerPosition(big)).toEqual({ x: 0.5, z: 0.5 });
    for (let n = 0; n < 6000; n++) {
      for (const w of walkers) stepWalker(w, walkers, 0.05, { canStand: open, rand });
      const tiles = walkers.flatMap((w) => {
        const out: string[] = [];
        for (let a = 0; a < w.w; a++) for (let b = 0; b < w.d; b++) out.push(`${w.ti + a},${w.tj + b}`);
        return out;
      });
      expect(new Set(tiles).size).toBe(tiles.length);
      expect(fits([], big.ti, big.tj, 2, 2, open)).toBe(true);
    }
  });
});
