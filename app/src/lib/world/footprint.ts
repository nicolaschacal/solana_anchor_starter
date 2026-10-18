/**
 * How many tiles a rebyter covers on the island: `w` tiles across (its width) by `d` tiles deep (its
 * length, front to back). The world draws the model to fill that rectangle and the island counts `w × d`
 * tiles of its room.
 *
 * For now every rebyter covers 1×1 while sizes are being evaluated in Decorate (+/− on a selected rebyter).
 * A form listed in FORM_TILES covers more (e.g. `"fox": [2, 2]`).
 */
export type Footprint = { w: number; d: number };

export const ONE_TILE: Footprint = { w: 1, d: 1 };

/** Forms that cover more than one tile. Form key (as in the evolution tree, e.g. "fox") → [across, deep]. */
export const FORM_TILES: Record<string, [number, number]> = {
  // "kitsune": [1, 1],
};

const MAX_SIDE = 4;
const side = (v: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(v) || 1));
const keyOf = (form: { key?: string; name?: string }) => (form.key || form.name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The tiles a form covers: its FORM_TILES entry, else 1×1. */
export function footprintOf(form: { key?: string; name?: string; stage?: number } | null | undefined): Footprint {
  const entry = form ? FORM_TILES[keyOf(form)] : undefined;
  if (entry) return { w: side(entry[0]), d: side(entry[1]) };
  return ONE_TILE;
}

/** Tiles a footprint covers on the ground, which is also the island room it takes. */
export const tilesOf = (f: Footprint) => f.w * f.d;
