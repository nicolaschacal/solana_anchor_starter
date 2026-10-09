import { describe, expect, it } from "vitest";
import { OX, OZ } from "./tiles";
import { footprint, spanCenter, spanOf } from "./world";

describe("prop footprint", () => {
  it("single-tile props cover the tile under them", () => {
    expect(spanOf("tree")).toBe(1);
    expect(footprint("tree", OX + 5, OZ + 7, 0)).toEqual([[5, 7]]);
  });

  it("a bus stop covers two neighbouring tiles along its width at every quarter turn", () => {
    for (let q = 0; q < 4; q++) {
      const r = (q * Math.PI) / 2;
      const c = spanCenter("busStop", 10, 12, r);
      const [a, b] = footprint("busStop", c.x, c.z, r);
      expect(a).toEqual([10, 12]);
      expect(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])).toBe(1);
    }
  });

  it("the other side mirrors the pair", () => {
    const c = spanCenter("busStop", 10, 12, 0, -1);
    expect(footprint("busStop", c.x, c.z, 0)).toEqual([
      [9, 12],
      [10, 12],
    ]);
  });
});
