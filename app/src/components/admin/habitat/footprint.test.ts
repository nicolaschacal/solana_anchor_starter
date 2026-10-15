import { describe, expect, it } from "vitest";
import { OX, OZ } from "./tiles";
import { anchorTile, footprint, spanCenter, spanOf } from "./world";

describe("prop footprint", () => {
  it("single-tile props cover the tile under them", () => {
    expect(spanOf("tree")).toBe(1);
    expect(spanOf("payphone")).toBe(1);
    expect(spanOf("crateBin")).toBe(1);
    expect(footprint("tree", OX + 5, OZ + 7, 0)).toEqual([[5, 7]]);
  });

  it("covers whole tiles: bus stop 3, vending machine 2, punching bag 2", () => {
    expect(spanOf("busStop")).toBe(3);
    expect(spanOf("vending")).toBe(2);
    expect(spanOf("punchingBag")).toBe(2);
    for (const key of ["busStop", "vending", "punchingBag"] as const)
      for (let q = 0; q < 4; q++) {
        const r = (q * Math.PI) / 2;
        const c = spanCenter(key, 10, 12, r);
        const tiles = footprint(key, c.x, c.z, r);
        expect(tiles).toHaveLength(spanOf(key));
        tiles.slice(1).forEach((t, k) => expect(Math.abs(t[0] - tiles[k][0]) + Math.abs(t[1] - tiles[k][1])).toBe(1));
      }
  });

  it("a three-tile bus stop is held by its middle tile", () => {
    for (let q = 0; q < 4; q++) {
      const r = (q * Math.PI) / 2;
      const c = spanCenter("busStop", 10, 12, r);
      expect(c).toEqual({ x: OX + 10, z: OZ + 12 });
      expect(anchorTile("busStop", c.x, c.z, r)).toEqual([10, 12]);
    }
    const c = spanCenter("busStop", 10, 12, 0);
    expect(footprint("busStop", c.x, c.z, 0)).toEqual([
      [9, 12],
      [10, 12],
      [11, 12],
    ]);
  });

  it("a two-tile prop starts on its first tile and the other side mirrors the pair", () => {
    const c = spanCenter("vending", 10, 12, 0);
    expect(footprint("vending", c.x, c.z, 0)[0]).toEqual([10, 12]);
    expect(anchorTile("vending", c.x, c.z, 0)).toEqual([10, 12]);
    const m = spanCenter("vending", 10, 12, 0, -1);
    expect(footprint("vending", m.x, m.z, 0)).toEqual([
      [9, 12],
      [10, 12],
    ]);
  });
});
