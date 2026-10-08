import { describe, expect, it } from "vitest";
import { BOARD, MAX_PLACED, defaultLayout, freeTile, onBoard, reconcile } from "./layout";

describe("world layout", () => {
  it("is a 5x5 board", () => {
    expect(BOARD.i1 - BOARD.i0).toBe(4);
    expect(BOARD.j1 - BOARD.j0).toBe(4);
    expect(onBoard(BOARD.i0, BOARD.j0)).toBe(true);
    expect(onBoard(BOARD.i1 + 1, BOARD.j0)).toBe(false);
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
});
