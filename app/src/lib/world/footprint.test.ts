import { describe, expect, it } from "vitest";
import { FORM_TILES, footprintOf, tilesOf } from "./footprint";
import { hasRoom, makeRoom, tilesUsed } from "../../components/world/layout";

describe("footprint", () => {
  it("is chosen per form in code, never by stage", () => {
    FORM_TILES.__test_big = [2, 2];
    expect(footprintOf({ key: "__test_big" })).toEqual({ w: 2, d: 2 });
    expect(footprintOf({ name: "Fox" })).toEqual({ w: 1, d: 1 });
    expect(footprintOf(undefined)).toEqual({ w: 1, d: 1 });
    expect(tilesOf({ w: 2, d: 2 })).toBe(4);
    delete FORM_TILES.__test_big;
  });
});

describe("island room in tiles", () => {
  const spec = { maxTiles: 6, maxPlaced: 3 };
  const cost = (m: string) => (m.startsWith("big") ? 4 : 1);
  it("a 2x2 and two 1x1 fit the starter island, a second 2x2 does not", () => {
    const placed = [{ mint: "big1", i: 0, j: 0 }, { mint: "a", i: 3, j: 0 }];
    expect(tilesUsed(placed, cost)).toBe(5);
    expect(hasRoom(placed, 1, spec, cost)).toBe(true);
    expect(hasRoom(placed, 4, spec, cost)).toBe(false);
  });
  it("still respects the head count the program checks", () => {
    const placed = ["a", "b", "c"].map((mint, i) => ({ mint, i, j: 0 }));
    expect(hasRoom(placed, 1, spec, cost)).toBe(false);
    expect(makeRoom(placed, 1, spec, cost).length).toBe(2);
  });
});
