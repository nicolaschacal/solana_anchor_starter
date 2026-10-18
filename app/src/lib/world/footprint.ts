import type * as THREE from "three";

/**
 * How many tiles a rebyter covers on the island: `w` tiles across (its width, x) by `d` tiles deep
 * (its length, front to back). It is a property of each model, chosen by the designer and written into
 * the GLB when it is rigged (scene extras `rebyter_tiles: [w, d]`), never derived from the evolution stage:
 * a Giga may be smaller than a Kylo. The model is drawn to fill that rectangle and the island counts
 * `w × d` of its room.
 */
export type Footprint = { w: number; d: number };

export const ONE_TILE: Footprint = { w: 1, d: 1 };
const MAX_SIDE = 4;

const side = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_SIDE, n)) : 1;
};

/** Reads the footprint a GLB declares, or null when the model does not say (older uploads). */
export function declaredFootprint(scene: THREE.Object3D | null | undefined): Footprint | null {
  const data = scene?.userData as Record<string, unknown> | undefined;
  const raw = data?.rebyter_tiles ?? (data?.rebyter as Record<string, unknown> | undefined)?.tiles;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  return { w: side(raw[0]), d: side(raw[1]) };
}

/**
 * Models uploaded before footprints existed: one tile, and 2×2 from Mega (stage 3) up, so the island
 * does not change for them until the model is re-exported with its own `rebyter_tiles`.
 */
export const LEGACY_BIG_STAGE = 3;
export const legacyFootprint = (stage: number): Footprint => (stage >= LEGACY_BIG_STAGE ? { w: 2, d: 2 } : ONE_TILE);

export const footprintFor = (scene: THREE.Object3D | null | undefined, stage: number): Footprint =>
  declaredFootprint(scene) ?? legacyFootprint(stage);

/** Tiles a footprint covers on the ground. */
export const tilesOf = (f: Footprint) => f.w * f.d;

/**
 * Island room ("space") a rebyter takes against the 3/5/8 limit: 1 for a one-tile body, 2 for any bigger
 * body (e.g. 2×2). Kept at 2 so a big rebyter still fits on the starter 5×5 island (3 spaces).
 */
export const spaceOf = (f: Footprint) => (tilesOf(f) > 1 ? 2 : 1);

/** The tiles a footprint covers when its corner (smallest i, j) stands on `i, j`. */
export function coveredTiles(i: number, j: number, f: Footprint) {
  const out: [number, number][] = [];
  for (let a = 0; a < f.w; a++) for (let b = 0; b < f.d; b++) out.push([i + a, j + b]);
  return out;
}
