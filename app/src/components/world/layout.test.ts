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

  it("fixes the limits by island size, whatever the land", () => {
    expect(([5, 7, 9] as const).map((n) => specFor(n).maxPlaced)).toEqual([3, 5, 8]);
    expect(([5, 7, 9] as const).map((n) => specFor(n).maxProps)).toEqual([14, 24, 40]);
    expect(specFor(7, "cold").maxPlaced).toBe(5);
    expect(specFor(9, "volcanic").maxPlaced).toBe(8);
    // Water and cliffs still keep rebyters off those tiles.
    expect(specFor(9, "volcanic").freeTiles).toBeLessThan(specFor(9).freeTiles);
  });

  it("only starts rebyters on standable tiles of a bigger island", () => {
    const big = specFor(9, "volcanic");
    const layout = defaultLayout(Array.from({ length: 20 }, (_, n) => `m${n}`), big);
    expect(layout.placed).toHaveLength(big.maxPlaced);
    expect(new Set(layout.placed.map((p) => `${p.i},${p.j}`)).size).toBe(big.maxPlaced);
    layout.placed.forEach((p) => expect(big.free(p.i, p.j)).toBe(true));
    // The tree's corner is open land on every island.
    for (const [n, c] of [[7, "arid"], [7, "cold"], [9, "humid"], [9, "volcanic"]] as const) {
      const s = specFor(n, c);
      expect(s.free(s.tree.i, s.tree.j)).toBe(true);
    }
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
