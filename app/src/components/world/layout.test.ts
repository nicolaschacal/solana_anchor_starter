import { describe, expect, it } from "vitest";
import { DEFAULT_SPEC, defaultLayout, freeTile, limitProps, onBoard, reconcile, specFor } from "./layout";

const BOARD = DEFAULT_SPEC.board;
const MAX_PLACED = DEFAULT_SPEC.maxPlaced;

describe("world layout", () => {
  it("is a 5x5 board", () => {
    expect(BOARD.i1 - BOARD.i0).toBe(4);
    expect(BOARD.j1 - BOARD.j0).toBe(4);
    expect(onBoard(BOARD.i0, BOARD.j0)).toBe(true);
    expect(onBoard(BOARD.i1 + 1, BOARD.j0)).toBe(false);
  });

  it("gives bigger habitats room for about one rebyter per 8 tiles", () => {
    expect([5, 10, 15].map((n) => specFor(n as 5).maxPlaced)).toEqual([3, 12, 12]);
    expect([5, 10, 15].map((n) => specFor(n as 5).maxProps)).toEqual([14, 30, 50]);
    const big = specFor(10);
    expect(big.board.i1 - big.board.i0).toBe(9);
    const layout = defaultLayout(Array.from({ length: 20 }, (_, n) => `m${n}`), big);
    expect(layout.placed).toHaveLength(12);
    expect(new Set(layout.placed.map((p) => `${p.i},${p.j}`)).size).toBe(12);
    layout.placed.forEach((p) => expect(onBoard(p.i, p.j, big)).toBe(true));
  });

  it("puts at most three rebyters in the world, each on its own tile", () => {
    const layout = defaultLayout(["a", "b", "c", "d", "e"]);
    expect(layout.placed).toHaveLength(MAX_PLACED);
    expect(new Set(layout.placed.map((p) => `${p.i},${p.j}`)).size).toBe(MAX_PLACED);
    layout.placed.forEach((p) => expect(onBoard(p.i, p.j)).toBe(true));
  });

  it("finds a free tile, skipping blocked and taken ones", () => {
    const tile = freeTile([{ i: BOARD.i0 + 2, j: BOARD.j0 + 2 }], (i, j) => i === BOARD.i1 - 1 && j === BOARD.j1 - 1);
    expect(tile).not.toBeNull();
    expect(`${tile!.i},${tile!.j}`).not.toBe(`${BOARD.i0 + 2},${BOARD.j0 + 2}`);
    expect(freeTile([], () => true)).toBeNull();
  });

  it("drops rebyters that are no longer owned", () => {
    const layout = defaultLayout(["a", "b", "c"]);
    expect(reconcile(layout, ["a", "c"]).placed.map((p) => p.mint)).toEqual(["a", "c"]);
  });

  it("shows only the objects the wallet backs and keeps the rest hidden", () => {
    const p = (key: "pine" | "tree", x: number) => ({ key, x, z: 0, h: 1, r: 0 });
    const props = [p("pine", 1), p("pine", 2), p("tree", 3), p("pine", 4)];
    const { shown, hidden } = limitProps(props, (key) => (key === "pine" ? 1 : Number.POSITIVE_INFINITY));
    expect(shown.map((x) => x.x)).toEqual([1, 3]);
    expect(hidden.map((x) => x.x)).toEqual([2, 4]);
    expect(limitProps(props, () => 0).shown).toHaveLength(0);
  });
});
