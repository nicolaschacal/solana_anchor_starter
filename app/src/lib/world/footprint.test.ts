import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { declaredFootprint, footprintFor, legacyFootprint, spaceOf, tilesOf } from "./footprint";

const sceneWith = (userData: Record<string, unknown>) => Object.assign(new THREE.Group(), { userData });

describe("footprint", () => {
  it("reads the tiles a GLB declares, whatever its stage", () => {
    expect(footprintFor(sceneWith({ rebyter_tiles: [2, 2] }), 0)).toEqual({ w: 2, d: 2 });
    expect(footprintFor(sceneWith({ rebyter_tiles: [1, 1] }), 5)).toEqual({ w: 1, d: 1 });
    expect(declaredFootprint(sceneWith({ rebyter: { tiles: [2, 1] } }))).toEqual({ w: 2, d: 1 });
  });
  it("keeps sides between 1 and 4 tiles", () => {
    expect(declaredFootprint(sceneWith({ rebyter_tiles: [0, 9] }))).toEqual({ w: 1, d: 4 });
  });
  it("falls back to the legacy rule for models that say nothing", () => {
    expect(declaredFootprint(sceneWith({}))).toBeNull();
    expect(footprintFor(sceneWith({}), 2)).toEqual(legacyFootprint(2));
    expect(tilesOf(legacyFootprint(2))).toBe(1);
    expect(tilesOf(legacyFootprint(3))).toBe(4);
    expect(spaceOf({ w: 1, d: 1 })).toBe(1);
    expect(spaceOf({ w: 2, d: 2 })).toBe(2);
  });
});
