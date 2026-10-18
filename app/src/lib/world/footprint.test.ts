import { describe, expect, it } from "vitest";
import { FORM_TILES, footprintOf, tilesOf } from "./footprint";
import { hasRoom, makeRoom, tilesUsed } from "../../components/world/layout";

describe("footprint", () => {
  it("every rebyter covers one tile for now, whatever its stage", () => {
    expect(footprintOf({ key: "caniform", stage: 2 })).toEqual({ w: 1, d: 1 });
    expect(footprintOf({ key: "fox", stage: 3 })).toEqual({ w: 1, d: 1 });
    expect(footprintOf(undefined)).toEqual({ w: 1, d: 1 });
    expect(tilesOf({ w: 2, d: 2 })).toBe(4);
  });
  it("a form listed in FORM_TILES covers more", () => {
    FORM_TILES.__test_small_giga = [1, 1];
    expect(footprintOf({ key: "__test_small_giga", stage: 4 })).toEqual({ w: 1, d: 1 });
    delete FORM_TILES.__test_small_giga;
  });
});

describe("island room in tiles", () => {
  const spec = { maxTiles: 6, maxPlaced: 3 };
  const cost = (m: string) => (m.startsWith("big") ? 4 : 1);
  it("the 5x5 island takes one Mega at most: a second one needs the expander", () => {
    const placed = [{ mint: "big1", i: 0, j: 0 }, { mint: "a", i: 3, j: 0 }];
    expect(tilesUsed(placed, cost)).toBe(5);
    expect(hasRoom(placed, 1, spec, cost)).toBe(true);
    expect(hasRoom(placed, 4, spec, cost)).toBe(false);
    expect(hasRoom([{ mint: "big1", i: 0, j: 0 }], 4, spec, cost)).toBe(false);
    expect(hasRoom([{ mint: "big1", i: 0, j: 0 }], 4, { maxTiles: 10, maxPlaced: 5 }, cost)).toBe(true);
  });
  it("still respects the head count the program checks", () => {
    const placed = ["a", "b", "c"].map((mint, i) => ({ mint, i, j: 0 }));
    expect(hasRoom(placed, 1, spec, cost)).toBe(false);
    expect(makeRoom(placed, 1, spec, cost).length).toBe(2);
  });
});
